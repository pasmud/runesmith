import { deriveDispatchMatrix, selectDispatchAgentForTask, type DispatchMatrix } from "./dispatch-matrix.js"
import { deriveLoopPulse, type LoopPulse } from "./loop-pulse.js"
import { type MissionTaskPlanItem } from "./mission-graph.js"
import { derivePlanContract, type PlanContract } from "./plan-contract.js"
import { advanceRunicMissionLoop, selectRunicLoopTask, type RunicMissionLoopStatus } from "./runic-loop.js"
import type { RunesmithRuntime } from "./runtime.js"
import { runtimeError } from "./errors.js"
import { err, ok, type AgentContract, type Result } from "./types.js"

export type RunicPlanRefinementOptions = {
  missionId?: string
  taskPlan: MissionTaskPlanItem[]
  contract: AgentContract
  holder: string
  idempotencyScope: string
  ttlMs: number
  evidenceId?: string
  now?: () => Date
}

export type RunicPlanRefinementValue = {
  status: RunicMissionLoopStatus
  missionId: string
  rootTaskId: string
  taskCount: number
  evidenceId: string
  planContract: PlanContract
  dispatchMatrix: DispatchMatrix
  loopPulse: LoopPulse
}

export function createRunicPlanRefinementTaskPlan(goal: string): MissionTaskPlanItem[] {
  const normalizedGoal = normalizeGoal(goal)

  return [
    {
      key: "pathfinder-plan",
      title: `Plan: ${normalizedGoal}`,
      description: `Convert "${normalizedGoal}" into an engine-owned execution map with explicit proof obligations.`,
      requiredCapabilities: ["typescript", "testing", "repository-maintenance"],
      requiredEvidence: ["decision"],
    },
    {
      key: "runtime-forge",
      title: "Forge: orchestration runtime",
      description: `Implement the runtime, adapters, and proof gates required for "${normalizedGoal}".`,
      requiredCapabilities: ["typescript", "testing"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    },
    {
      key: "interface-forge",
      title: "Forge: operator control surface",
      description: `Implement the dashboard and install-facing controls required for "${normalizedGoal}".`,
      requiredCapabilities: ["typescript", "ui", "accessibility"],
      requiredEvidence: ["file-change", "test-result"],
      dependsOn: ["pathfinder-plan"],
    },
    {
      key: "proof-review",
      title: "Review: proof and risk gate",
      description: `Review implementation proof, residual risk, and operator handoff for "${normalizedGoal}".`,
      requiredCapabilities: ["testing", "review", "risk-analysis"],
      requiredEvidence: ["test-result", "decision"],
      dependsOn: ["runtime-forge", "interface-forge"],
    },
    {
      key: "seal-handoff",
      title: "Seal: install and handoff",
      description: `Package, document, and checkpoint the install path for "${normalizedGoal}".`,
      requiredCapabilities: ["repository-maintenance", "release", "documentation"],
      requiredEvidence: ["decision"],
      dependsOn: ["proof-review"],
    },
  ]
}

export function refineRunicMissionPlan(
  runtime: RunesmithRuntime,
  options: RunicPlanRefinementOptions,
): Result<RunicPlanRefinementValue> {
  const missionId = options.missionId ?? selectRunicLoopTask(runtime.snapshot())?.missionId
  if (!missionId) {
    return err(runtimeError("MISSION_NOT_FOUND", "No active mission is available for plan refinement"))
  }

  const valid = validateRefinementPlan(options.taskPlan)
  if (!valid.ok) return valid

  runtime.registerContract(options.contract)

  const refined = runtime.refineMissionPlan({
    missionId,
    taskPlan: options.taskPlan,
  })
  if (!refined.ok) return refined

  let snapshot = runtime.snapshot()
  let rootTask = snapshot.graphs[missionId]?.tasks[refined.value.graph.mission.rootTaskId]
  if (!rootTask) {
    return err(runtimeError("TASK_NOT_FOUND", "Refined mission root task does not exist", {
      missionId,
      rootTaskId: refined.value.graph.mission.rootTaskId,
    }))
  }

  if (rootTask.status === "queued") {
    const claimed = runtime.claimTask({
      missionId,
      taskId: rootTask.id,
      contractId: selectDispatchAgentForTask(snapshot, rootTask.id, options.contract.id),
      holder: options.holder,
      idempotencyKey: `${options.idempotencyScope}:${missionId}:${rootTask.id}:plan`,
      ttlMs: options.ttlMs,
    })
    if (!claimed.ok) return claimed
    rootTask = claimed.value.task
  }

  const evidenceId = options.evidenceId ?? `evidence_plan_refined_${crypto.randomUUID()}`
  const recorded = runtime.addTaskEvidence({
    missionId,
    evidence: {
      id: evidenceId,
      taskId: rootTask.id,
      type: "decision",
      summary: `Pathfinder refined mission into ${options.taskPlan.length} proof-backed task slices`,
      payload: {
        mode: "runesmith-plan-refinery",
        taskCount: options.taskPlan.length,
        tasks: options.taskPlan.map((task) => ({
          key: task.key,
          title: task.title,
          requiredCapabilities: task.requiredCapabilities ?? [],
          requiredEvidence: task.requiredEvidence ?? [],
          dependsOn: task.dependsOn ?? [],
        })),
      },
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
  })
  if (!recorded.ok) return recorded

  const advanced = advanceRunicMissionLoop(runtime, {
    contract: options.contract,
    holder: options.holder,
    idempotencyScope: `${options.idempotencyScope}:refined`,
    ttlMs: options.ttlMs,
    recoverStale: false,
    now: options.now,
  })
  if (!advanced.ok) return advanced

  snapshot = runtime.snapshot()
  return ok({
    status: advanced.value.status,
    missionId,
    rootTaskId: refined.value.graph.mission.rootTaskId,
    taskCount: options.taskPlan.length,
    evidenceId,
    planContract: derivePlanContract(snapshot),
    dispatchMatrix: deriveDispatchMatrix(snapshot),
    loopPulse: deriveLoopPulse(snapshot),
  })
}

function validateRefinementPlan(taskPlan: MissionTaskPlanItem[]): Result<void> {
  const root = taskPlan[0]
  if (!root?.requiredEvidence?.includes("decision")) {
    return err(runtimeError("INVALID_TRANSITION", "Plan refinement requires the first task to record decision evidence", {
      key: root?.key,
    }))
  }

  const unprovable = taskPlan.find((task) => (task.requiredEvidence ?? []).length === 0)
  if (unprovable) {
    return err(runtimeError("INVALID_TRANSITION", "Plan refinement tasks must declare required evidence", {
      key: unprovable.key,
    }))
  }

  const implementationSlices = taskPlan.slice(1).filter((task) => {
    const evidence = task.requiredEvidence ?? []
    return evidence.includes("file-change") && evidence.includes("test-result")
  })
  if (implementationSlices.length === 0) {
    return err(runtimeError("INVALID_TRANSITION", "Plan refinement requires at least one proof-backed implementation slice"))
  }

  return ok(undefined)
}

function normalizeGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ") || "Runesmith mission"
}
