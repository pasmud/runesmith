import { validateAgentForTask } from "./contracts"
import { addEvidence, assertRequiredEvidence, createEvidenceLedger, type EvidenceLedger } from "./evidence-ledger"
import { acquireLease, createLeaseBook, type LeaseBook } from "./lease-scheduler"
import { createMissionGraph, transitionTask } from "./mission-graph"
import { recoverStaleTasks } from "./recovery"
import {
  err,
  ok,
  type AgentContract,
  type Clock,
  type Evidence,
  type IdFactory,
  type Lease,
  type MissionGraph,
  type MissionTask,
  type Result,
} from "./types"
import { runtimeError } from "./errors"

export type RuntimeOptions = {
  idFactory?: IdFactory
  now?: Clock
  snapshot?: RuntimeSnapshot
}

export type StartMissionInput = {
  goal: string
  requiredCapabilities?: string[]
}

export type ClaimTaskInput = {
  missionId: string
  taskId: string
  contractId: string
  holder: string
  idempotencyKey: string
  ttlMs: number
}

export type ClaimTaskValue = {
  graph: MissionGraph
  task: MissionTask
  lease: Lease
}

export type AddTaskEvidenceInput = {
  missionId: string
  evidence: Evidence
}

export type CompleteTaskInput = {
  missionId: string
  taskId: string
  contractId: string
}

export type TaskMutationValue = {
  graph: MissionGraph
  task: MissionTask
}

export type RecoverMissionInput = {
  missionId: string
  now?: Clock
  staleAfterMs: number
}

export type RuntimeSnapshot = {
  graphs: Record<string, MissionGraph>
  ledgers: Record<string, EvidenceLedger>
  leases: LeaseBook
  contracts: Record<string, AgentContract>
}

export class RunesmithRuntime {
  private contracts = new Map<string, AgentContract>()
  private graphs = new Map<string, MissionGraph>()
  private ledgers = new Map<string, EvidenceLedger>()
  private leases = createLeaseBook()

  constructor(private readonly options: RuntimeOptions = {}) {
    if (options.snapshot) {
      this.contracts = new Map(Object.entries(options.snapshot.contracts))
      this.graphs = new Map(Object.entries(options.snapshot.graphs))
      this.ledgers = new Map(Object.entries(options.snapshot.ledgers))
      this.leases = options.snapshot.leases
    }
  }

  registerContract(contract: AgentContract): void {
    this.contracts.set(contract.id, contract)
  }

  startMission(input: StartMissionInput): Result<{ graph: MissionGraph; missionId: string; rootTaskId: string }> {
    const created = createMissionGraph({
      goal: input.goal,
      idFactory: this.options.idFactory,
      now: this.options.now,
      requiredCapabilities: input.requiredCapabilities,
    })

    if (!created.ok) return created

    const graph = created.value
    this.graphs.set(graph.mission.id, graph)
    this.ledgers.set(graph.mission.id, createEvidenceLedger())

    return ok({
      graph,
      missionId: graph.mission.id,
      rootTaskId: graph.mission.rootTaskId,
    })
  }

  claimTask(input: ClaimTaskInput): Result<ClaimTaskValue> {
    const graph = this.graphs.get(input.missionId)
    if (!graph) {
      return err(runtimeError("MISSION_NOT_FOUND", "Mission does not exist", { missionId: input.missionId }))
    }

    const task = graph.tasks[input.taskId]
    if (!task) {
      return err(runtimeError("TASK_NOT_FOUND", "Task does not exist", { taskId: input.taskId }))
    }

    const contract = this.contracts.get(input.contractId)
    if (!contract) {
      return err(runtimeError("CONTRACT_INVALID", "Agent contract does not exist", { contractId: input.contractId }))
    }

    const valid = validateAgentForTask(contract, task)
    if (!valid.ok) return valid

    const lease = acquireLease(this.leases, {
      targetId: input.taskId,
      purpose: "task.claim",
      holder: input.holder,
      idempotencyKey: input.idempotencyKey,
      ttlMs: input.ttlMs,
      now: this.options.now,
      idFactory: this.options.idFactory,
    })
    if (!lease.ok) return lease

    const transitioned =
      task.status === "running"
        ? ok(graph)
        : transitionTask(graph, {
            taskId: input.taskId,
            nextStatus: "running",
            now: this.options.now,
            reason: "Task claimed by agent contract",
            eventId: this.options.idFactory?.("event"),
          })
    if (!transitioned.ok) return transitioned

    const claimedTask = {
      ...transitioned.value.tasks[input.taskId]!,
      assignedAgentId: contract.id,
    }
    const nextGraph: MissionGraph = {
      ...transitioned.value,
      tasks: {
        ...transitioned.value.tasks,
        [input.taskId]: claimedTask,
      },
    }

    this.leases = lease.value.book
    this.graphs.set(input.missionId, nextGraph)

    return ok({
      graph: nextGraph,
      task: claimedTask,
      lease: lease.value.lease,
    })
  }

  addTaskEvidence(input: AddTaskEvidenceInput): Result<EvidenceLedger> {
    if (!this.graphs.has(input.missionId)) {
      return err(runtimeError("MISSION_NOT_FOUND", "Mission does not exist", { missionId: input.missionId }))
    }

    const ledger = this.ledgers.get(input.missionId) ?? createEvidenceLedger()
    const next = addEvidence(ledger, input.evidence)
    if (!next.ok) return next

    this.ledgers.set(input.missionId, next.value)
    return next
  }

  completeTask(input: CompleteTaskInput): Result<TaskMutationValue> {
    const graph = this.graphs.get(input.missionId)
    if (!graph) {
      return err(runtimeError("MISSION_NOT_FOUND", "Mission does not exist", { missionId: input.missionId }))
    }

    const task = graph.tasks[input.taskId]
    if (!task) {
      return err(runtimeError("TASK_NOT_FOUND", "Task does not exist", { taskId: input.taskId }))
    }

    const contract = this.contracts.get(input.contractId)
    if (!contract) {
      return err(runtimeError("CONTRACT_INVALID", "Agent contract does not exist", { contractId: input.contractId }))
    }

    const evidence = assertRequiredEvidence(this.ledgers.get(input.missionId) ?? createEvidenceLedger(), {
      taskId: input.taskId,
      requiredEvidence: contract.requiredEvidence,
    })
    if (!evidence.ok) return evidence

    const transitioned = transitionTask(graph, {
      taskId: input.taskId,
      nextStatus: "complete",
      now: this.options.now,
      reason: "Task completed with required evidence",
      eventId: this.options.idFactory?.("event"),
    })
    if (!transitioned.ok) return transitioned

    this.graphs.set(input.missionId, transitioned.value)

    return ok({
      graph: transitioned.value,
      task: transitioned.value.tasks[input.taskId]!,
    })
  }

  recover(input: RecoverMissionInput): Result<{ graph: MissionGraph }> {
    const graph = this.graphs.get(input.missionId)
    if (!graph) {
      return err(runtimeError("MISSION_NOT_FOUND", "Mission does not exist", { missionId: input.missionId }))
    }

    const recovered = recoverStaleTasks(graph, {
      now: input.now ?? this.options.now ?? (() => new Date()),
      staleAfterMs: input.staleAfterMs,
      eventIdFactory: (taskId) => this.options.idFactory?.("event") ?? `event_stale_${taskId}`,
    })

    this.graphs.set(input.missionId, recovered)
    return ok({ graph: recovered })
  }

  getMission(missionId: string): Result<MissionGraph> {
    const graph = this.graphs.get(missionId)
    if (!graph) {
      return err(runtimeError("MISSION_NOT_FOUND", "Mission does not exist", { missionId }))
    }

    return ok(graph)
  }

  snapshot(): RuntimeSnapshot {
    return {
      graphs: Object.fromEntries(this.graphs),
      ledgers: Object.fromEntries(this.ledgers),
      leases: this.leases,
      contracts: Object.fromEntries(this.contracts),
    }
  }
}

export function createRuntime(options?: RuntimeOptions): RunesmithRuntime {
  return new RunesmithRuntime(options)
}
