import { getRequiredEvidenceForTask } from "./contracts"
import { createCovenantDecisionDraft } from "./covenant"
import { missingRequiredEvidence } from "./evidence-ledger"
import { runtimeError } from "./errors"
import { deriveLoopPulse } from "./loop-pulse"
import { taskDependenciesComplete } from "./mission-graph"
import { deriveReviewLens, summarizeReviewLens } from "./review-lens"
import { deriveSealAudit, summarizeSealAudit } from "./seal-audit"
import type { RunesmithRuntime, RuntimeSnapshot } from "./runtime"
import {
  err,
  ok,
  type AgentContract,
  type Clock,
  type EvidenceType,
  type MissionTask,
  type Result,
} from "./types"

export type RunicMissionLoopStatus =
  | "idle"
  | "waiting-for-evidence"
  | "claimed"
  | "completed"
  | "recovered"

export type AdvanceRunicMissionLoopOptions = {
  contract: AgentContract
  holder: string
  idempotencyScope: string
  ttlMs?: number
  recoverStale?: boolean
  staleAfterMs?: number
  now?: Clock
  maxDepth?: number
  evidenceIdFactory?: (input: { missionId: string; task: MissionTask; stage: "review" | "seal" }) => string
}

export type RiskResolutionVerdict = "accepted" | "cleared"

export type ResolveRunicRiskOptions = Omit<AdvanceRunicMissionLoopOptions, "evidenceIdFactory"> & {
  verdict: RiskResolutionVerdict
  summary?: string
  evidenceIdFactory?: (input: {
    missionId: string
    task: MissionTask
    verdict: RiskResolutionVerdict
    risks: string[]
  }) => string
}

export type AdvanceRunicMissionLoopValue = {
  status: RunicMissionLoopStatus
  missionId?: string
  taskId?: string
  missionStatus?: string
  missingEvidence?: EvidenceType[]
  nextTaskStatus?: string
}

export type ResolveRunicRiskValue = {
  status: "resolved"
  missionId: string
  taskId: string
  evidenceId: string
  verdict: RiskResolutionVerdict
  risks: string[]
  nextStatus: RunicMissionLoopStatus
  missionStatus?: string
  missingEvidence?: EvidenceType[]
}

export function advanceRunicMissionLoop(
  runtime: RunesmithRuntime,
  options: AdvanceRunicMissionLoopOptions,
  depth = 0,
): Result<AdvanceRunicMissionLoopValue> {
  if (depth > (options.maxDepth ?? 12)) {
    return err(runtimeError("INVALID_TRANSITION", "Runic mission loop exceeded the maximum advance depth"))
  }

  runtime.registerContract(options.contract)

  if (depth === 0 && options.recoverStale) {
    const recovered = recoverRunicStaleWork(runtime, options)
    if (!recovered.ok) return recovered
    if (recovered.value.status === "recovered") return recovered
  }

  const snapshot = runtime.snapshot()
  const target = selectRunicLoopTask(snapshot)
  if (!target) return ok({ status: "idle" })

  const graph = snapshot.graphs[target.missionId]
  const task = graph?.tasks[target.taskId]
  if (!graph || !task) return ok({ status: "idle" })

  const contractId = task.assignedAgentId ?? options.contract.id
  const contract = snapshot.contracts[contractId] ?? options.contract

  if (task.status === "queued") {
    const claimed = claimRunicTask(runtime, options, {
      missionId: target.missionId,
      task,
      contractId,
    })
    if (!claimed.ok) return claimed

    return ok({
      status: "claimed",
      missionId: target.missionId,
      taskId: target.taskId,
      nextTaskStatus: claimed.value.status,
    })
  }

  const requiredEvidence = getRequiredEvidenceForTask(task, contract)
  const missingEvidence = getMissingEvidence(snapshot, {
    missionId: target.missionId,
    taskId: target.taskId,
    requiredEvidence,
  })
  const decisionDraft = createCovenantDecisionDraft(task)
  if (decisionDraft && missingEvidence.length === 1 && missingEvidence[0] === "decision") {
    const reviewLens = decisionDraft.stage === "review" ? summarizeReviewLens(deriveReviewLens(snapshot)) : undefined
    const sealAudit = decisionDraft.stage === "seal" ? summarizeSealAudit(deriveSealAudit(snapshot)) : undefined
    const recorded = runtime.addTaskEvidence({
      missionId: target.missionId,
      evidence: {
        id: buildDecisionEvidenceId(options, {
          missionId: target.missionId,
          task,
          stage: decisionDraft.stage,
        }),
        taskId: target.taskId,
        type: "decision",
        summary: decisionDraft.summary,
        payload: {
          ...decisionDraft.payload,
          ...(reviewLens ? { reviewLens } : {}),
          ...(sealAudit ? { sealAudit } : {}),
        },
        createdAt: (options.now ?? (() => new Date()))().toISOString(),
      },
    })
    if (!recorded.ok) return recorded

    return advanceRunicMissionLoop(runtime, options, depth + 1)
  }

  if (missingEvidence.length > 0) {
    return ok({
      status: "waiting-for-evidence",
      missionId: target.missionId,
      taskId: target.taskId,
      missionStatus: graph.mission.status,
      missingEvidence,
    })
  }

  const completed = runtime.completeTask({
    missionId: target.missionId,
    taskId: target.taskId,
    contractId,
  })
  if (!completed.ok) return completed

  const nextSnapshot = runtime.snapshot()
  const nextTarget = selectRunicLoopTask(nextSnapshot, target.missionId)
  const nextTask = nextTarget ? nextSnapshot.graphs[nextTarget.missionId]?.tasks[nextTarget.taskId] : undefined
  if (nextTask?.status === "queued") {
    const claimed = claimRunicTask(runtime, options, {
      missionId: target.missionId,
      task: nextTask,
      contractId: options.contract.id,
    })
    if (!claimed.ok) return claimed

    return advanceRunicMissionLoop(runtime, options, depth + 1)
  }

  const finalGraph = runtime.snapshot().graphs[target.missionId]
  return ok({
    status: "completed",
    missionId: target.missionId,
    taskId: target.taskId,
    missionStatus: finalGraph?.mission.status ?? completed.value.graph.mission.status,
  })
}

export function resolveRunicRisk(
  runtime: RunesmithRuntime,
  options: ResolveRunicRiskOptions,
): Result<ResolveRunicRiskValue> {
  runtime.registerContract(options.contract)

  const snapshot = runtime.snapshot()
  const pulse = deriveLoopPulse(snapshot)
  if (pulse.nextAction.id !== "resolve-risk" || !pulse.missionId || !pulse.taskId) {
    return err(
      runtimeError("INVALID_TRANSITION", "No active unresolved risk is waiting for a decision", {
        nextAction: pulse.nextAction.id,
        missionId: pulse.missionId,
        taskId: pulse.taskId,
      }),
    )
  }

  const graph = snapshot.graphs[pulse.missionId]
  const task = graph?.tasks[pulse.taskId]
  if (!graph || !task) {
    return err(runtimeError("TASK_NOT_FOUND", "Active risk task does not exist", {
      missionId: pulse.missionId,
      taskId: pulse.taskId,
    }))
  }

  const evidenceId = buildRiskDecisionEvidenceId(options, {
    missionId: pulse.missionId,
    task,
    risks: pulse.risks,
  })
  const recorded = runtime.addTaskEvidence({
    missionId: pulse.missionId,
    evidence: {
      id: evidenceId,
      taskId: pulse.taskId,
      type: "decision",
      summary: formatRiskDecisionSummary(options.verdict, options.summary, pulse.risks),
      payload: {
        mode: "runesmith-risk-resolution",
        verdict: options.verdict,
        risks: pulse.risks,
      },
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
  })
  if (!recorded.ok) return recorded

  const advanced = advanceRunicMissionLoop(runtime, {
    ...options,
    recoverStale: false,
    evidenceIdFactory: undefined,
  })
  if (!advanced.ok) return advanced

  return ok({
    status: "resolved",
    missionId: pulse.missionId,
    taskId: pulse.taskId,
    evidenceId,
    verdict: options.verdict,
    risks: pulse.risks,
    nextStatus: advanced.value.status,
    missionStatus: advanced.value.missionStatus,
    missingEvidence: advanced.value.missingEvidence,
  })
}

export function selectRunicLoopTask(
  snapshot: RuntimeSnapshot,
  missionId?: string,
): { missionId: string; taskId: string } | undefined {
  const rank: Record<string, number> = {
    running: 0,
    verifying: 1,
    queued: 2,
    blocked: 3,
    stale: 4,
  }

  return Object.values(snapshot.graphs)
    .filter((graph) => !missionId || graph.mission.id === missionId)
    .filter((graph) => !["complete", "failed", "cancelled"].includes(graph.mission.status))
    .flatMap((graph) => {
      return Object.values(graph.tasks)
        .filter((task) => {
          return !["complete", "failed", "cancelled"].includes(task.status)
            && (task.status !== "queued" || taskDependenciesComplete(graph, task))
        })
        .map((task) => ({
          missionId: graph.mission.id,
          taskId: task.id,
          status: task.status,
          updatedAt: task.updatedAt,
        }))
    })
    .sort((left, right) => {
      const rankDelta = (rank[left.status] ?? 99) - (rank[right.status] ?? 99)
      if (rankDelta !== 0) return rankDelta

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    })[0]
}

function recoverRunicStaleWork(
  runtime: RunesmithRuntime,
  options: AdvanceRunicMissionLoopOptions,
): Result<AdvanceRunicMissionLoopValue> {
  const snapshot = runtime.snapshot()

  for (const graph of Object.values(snapshot.graphs)) {
    if (["complete", "failed", "cancelled"].includes(graph.mission.status)) continue

    const recovered = runtime.recover({
      missionId: graph.mission.id,
      staleAfterMs: options.staleAfterMs ?? 120_000,
      requeueStale: true,
      now: options.now,
    })
    if (!recovered.ok) return recovered

    const changedTaskIds = Object.values(recovered.value.graph.tasks)
      .filter((task) => {
        const previous = graph.tasks[task.id]
        return previous && previous.status !== task.status && ["running", "stale"].includes(previous.status)
      })
      .map((task) => task.id)
    const hasRecoveryEvent = recovered.value.graph.events.length > graph.events.length
    if (changedTaskIds.length === 0 && !hasRecoveryEvent) continue

    const recoveredSnapshot = runtime.snapshot()
    const target = selectRunicLoopTask(recoveredSnapshot, graph.mission.id)
    const task = target ? recoveredSnapshot.graphs[target.missionId]?.tasks[target.taskId] : undefined
    const claimed = task?.status === "queued"
      ? claimRunicTask(runtime, options, {
          missionId: target!.missionId,
          task,
          contractId: options.contract.id,
        })
      : undefined
    if (claimed && !claimed.ok) return claimed

    return ok({
      status: "recovered",
      missionId: graph.mission.id,
      taskId: claimed?.ok ? claimed.value.id : target?.taskId,
      nextTaskStatus: claimed?.ok ? claimed.value.status : task?.status,
    })
  }

  return ok({ status: "idle" })
}

function claimRunicTask(
  runtime: RunesmithRuntime,
  options: AdvanceRunicMissionLoopOptions,
  input: { missionId: string; task: MissionTask; contractId: string },
) {
  const claimed = runtime.claimTask({
    missionId: input.missionId,
    taskId: input.task.id,
    contractId: input.contractId,
    holder: options.holder,
    idempotencyKey: `${options.idempotencyScope}:${input.missionId}:${input.task.id}`,
    ttlMs: options.ttlMs ?? 30_000,
  })

  if (!claimed.ok) return claimed
  return ok(claimed.value.task)
}

function getMissingEvidence(
  snapshot: RuntimeSnapshot,
  input: { missionId: string; taskId: string; requiredEvidence: EvidenceType[] },
): EvidenceType[] {
  const ledger = snapshot.ledgers[input.missionId]
  if (!ledger) return input.requiredEvidence

  return missingRequiredEvidence(ledger, input)
}

function buildDecisionEvidenceId(
  options: AdvanceRunicMissionLoopOptions,
  input: { missionId: string; task: MissionTask; stage: "review" | "seal" },
): string {
  return options.evidenceIdFactory?.(input)
    ?? `evidence_auto_decision_${fingerprint(`${input.missionId}:${input.task.id}:${input.stage}`)}`
}

function buildRiskDecisionEvidenceId(
  options: ResolveRunicRiskOptions,
  input: { missionId: string; task: MissionTask; risks: string[] },
): string {
  return options.evidenceIdFactory?.({
    ...input,
    verdict: options.verdict,
  }) ?? `evidence_risk_decision_${fingerprint(`${input.missionId}:${input.task.id}:${options.verdict}:${input.risks.join("|")}`)}`
}

function formatRiskDecisionSummary(verdict: RiskResolutionVerdict, summary: string | undefined, risks: string[]): string {
  const fallback = risks.length > 0 ? risks.join("; ") : "active risk"
  const detail = summary?.trim() || fallback
  const label = verdict === "accepted" ? "accepted" : "cleared"

  return `Risk ${label}: ${detail}`
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}
