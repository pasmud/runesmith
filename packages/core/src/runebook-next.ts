import {
  advanceRunicMissionLoop,
  resolveRunicFaultline,
  resolveRunicRisk,
  type RiskResolutionVerdict,
  type RunicMissionLoopStatus,
} from "./runic-loop.js"
import { deriveLoopPulse, type LoopPulseActionId } from "./loop-pulse.js"
import { createRunicPlanRefinementTaskPlan, refineRunicMissionPlan } from "./plan-refinery.js"
import { deriveProofPlan, type ProofPlan, type ProofPlanOptions } from "./proof-plan.js"
import { runProofPlan, type ProofCommandRunner, type ProofRunCommandResult, type ProofRunStatus } from "./proof-runner.js"
import { deriveRunebook, type Runebook, type RunebookCard } from "./runebook.js"
import type { RunesmithRuntime } from "./runtime.js"
import { err, ok, type AgentContract, type EvidenceType, type MissionTask, type Result } from "./types.js"
import { runtimeError } from "./errors.js"

export type RunebookNextStatus =
  | "idle"
  | "advanced"
  | "proof-passed"
  | "proof-failed"
  | "proof-idle"
  | "plan-refined"
  | "faultline-resolved"
  | "faultline-held"
  | "risk-resolved"
  | "risk-held"

export type RunebookNextRiskOptions = {
  verdict?: RiskResolutionVerdict
  summary?: string
  evidenceIdFactory?: (input: {
    missionId: string
    task: MissionTask
    verdict: RiskResolutionVerdict
    risks: string[]
  }) => string
}

export type RunebookNextFaultlineOptions = {
  summary?: string
  evidenceIdFactory?: (input: {
    missionId: string
    task: MissionTask
    diagnostics: string[]
    summary: string
  }) => string
}

export type RunebookNextOptions = {
  contract: AgentContract
  holder: string
  idempotencyScope: string
  ttlMs: number
  staleAfterMs?: number
  recoverStale?: boolean
  proofPlanOptions?: ProofPlanOptions
  proofCommandRunner?: ProofCommandRunner
  nextEvidenceId?: () => string
  now?: () => Date
  risk?: RunebookNextRiskOptions
  faultline?: RunebookNextFaultlineOptions
}

export type RunebookNextValue = {
  status: RunebookNextStatus
  actionId: LoopPulseActionId
  card: RunebookCard
  missionId?: string
  taskId?: string
  nextStatus?: RunicMissionLoopStatus
  missingEvidence?: EvidenceType[]
  proofStatus?: ProofRunStatus
  commands?: ProofRunCommandResult[]
  riskResolution?: {
    evidenceId: string
    verdict: RiskResolutionVerdict
    nextStatus: RunicMissionLoopStatus
    risks: string[]
  }
  faultlineResolution?: {
    evidenceId: string
    nextStatus: RunicMissionLoopStatus
    diagnostics: string[]
  }
  planRefinement?: {
    evidenceId: string
    rootTaskId: string
    taskCount: number
    implementationTaskCount: number
    activeSlotCount: number
  }
  loopPulse: ReturnType<typeof deriveLoopPulse>
  runebook: Runebook
  proofPlan: ProofPlan
}

export async function runRunebookNext(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
): Promise<Result<RunebookNextValue>> {
  const before = runtime.snapshot()
  const beforePulse = deriveLoopPulse(before)
  const beforeRunebook = deriveRunebook(before, { proofPlanOptions: options.proofPlanOptions })
  const actionId = beforePulse.nextAction.id
  const card = beforeRunebook.activeCard

  if (actionId === "refine-plan") {
    return refinePlanNext(runtime, options, actionId, card)
  }

  if (actionId === "capture-proof" || actionId === "repair-diagnostic") {
    return runProofNext(runtime, options, actionId, card)
  }

  if (actionId === "resolve-risk") {
    return resolveRiskNext(runtime, options, actionId, card)
  }

  if (actionId === "review-faultline") {
    return resolveFaultlineNext(runtime, options, actionId, card)
  }

  const advanced = advanceRunicMissionLoop(runtime, {
    contract: options.contract,
    holder: options.holder,
    idempotencyScope: options.idempotencyScope,
    ttlMs: options.ttlMs,
    staleAfterMs: options.staleAfterMs,
    recoverStale: options.recoverStale ?? true,
    now: options.now,
  })
  if (!advanced.ok) return advanced

  return ok(buildValue(runtime, options, {
    status: advanced.value.status === "idle" ? "idle" : "advanced",
    actionId,
    card,
    missionId: advanced.value.missionId,
    taskId: advanced.value.taskId,
    nextStatus: advanced.value.status,
    missingEvidence: advanced.value.missingEvidence,
  }))
}

function refinePlanNext(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
  actionId: LoopPulseActionId,
  card: RunebookCard,
): Result<RunebookNextValue> {
  const snapshot = runtime.snapshot()
  const pulse = deriveLoopPulse(snapshot)
  const missionId = pulse.missionId
  const graph = missionId ? snapshot.graphs[missionId] : undefined
  if (!missionId || !graph) {
    return err(runtimeError("MISSION_NOT_FOUND", "No active mission is available for Runebook plan refinement", {
      actionId,
    }))
  }

  const recovered = recoverStaleBeforePlanRefinement(runtime, options, {
    missionId,
    card,
  })
  if (!recovered.ok) return recovered
  if (recovered.value) return ok(recovered.value)

  const refined = refineRunicMissionPlan(runtime, {
    missionId,
    taskPlan: createRunicPlanRefinementTaskPlan(graph.mission.goal),
    contract: options.contract,
    holder: options.holder,
    idempotencyScope: `${options.idempotencyScope}:plan-refine`,
    ttlMs: options.ttlMs,
    evidenceId: options.nextEvidenceId?.(),
    now: options.now,
  })
  if (!refined.ok) return refined

  return ok(buildValue(runtime, options, {
    status: "plan-refined",
    actionId,
    card,
    missionId: refined.value.missionId,
    taskId: refined.value.rootTaskId,
    nextStatus: refined.value.status,
    missingEvidence: refined.value.loopPulse.missingEvidence,
    planRefinement: {
      evidenceId: refined.value.evidenceId,
      rootTaskId: refined.value.rootTaskId,
      taskCount: refined.value.taskCount,
      implementationTaskCount: refined.value.planContract.implementationTaskCount,
      activeSlotCount: refined.value.dispatchMatrix.activeSlotCount,
    },
  }))
}

function recoverStaleBeforePlanRefinement(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
  input: {
    missionId: string
    card: RunebookCard
  },
): Result<RunebookNextValue | undefined> {
  if (options.recoverStale === false) return ok(undefined)

  const before = runtime.snapshot().graphs[input.missionId]
  if (!before) return ok(undefined)

  const recovered = runtime.recover({
    missionId: input.missionId,
    staleAfterMs: options.staleAfterMs ?? 120_000,
    requeueStale: true,
    now: options.now,
  })
  if (!recovered.ok) return recovered

  const changedTaskIds = Object.values(recovered.value.graph.tasks)
    .filter((task) => {
      const previous = before.tasks[task.id]
      return previous && previous.status !== task.status && ["running", "stale"].includes(previous.status)
    })
    .map((task) => task.id)
  const hasRecoveryEvent = recovered.value.graph.events.length > before.events.length
  if (changedTaskIds.length === 0 && !hasRecoveryEvent) return ok(undefined)

  const snapshot = runtime.snapshot()
  const recoveryContract = snapshot.contracts[options.contract.id] ?? options.contract
  const advanced = advanceRunicMissionLoop(runtime, {
    contract: recoveryContract,
    holder: options.holder,
    idempotencyScope: `${options.idempotencyScope}:plan-recover`,
    ttlMs: options.ttlMs,
    staleAfterMs: options.staleAfterMs,
    recoverStale: false,
    now: options.now,
  })
  if (!advanced.ok) return advanced

  const pulse = deriveLoopPulse(runtime.snapshot())
  return ok(buildValue(runtime, options, {
    status: "advanced",
    actionId: "recover-stale",
    card: input.card,
    missionId: advanced.value.missionId ?? input.missionId,
    taskId: advanced.value.taskId ?? pulse.taskId,
    nextStatus: "recovered",
    missingEvidence: pulse.missingEvidence,
  }))
}

async function runProofNext(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
  actionId: LoopPulseActionId,
  card: RunebookCard,
): Promise<Result<RunebookNextValue>> {
  if (!options.proofCommandRunner) {
    return err(runtimeError("INVALID_TRANSITION", "Runebook next proof action requires a proof command runner", {
      actionId,
      cardId: card.id,
    }))
  }

  const proofPlan = deriveProofPlan(runtime.snapshot(), options.proofPlanOptions)
  const proofRun = await runProofPlan(runtime, proofPlan, {
    nextEvidenceId: options.nextEvidenceId ?? (() => `evidence_next_${crypto.randomUUID()}`),
    now: options.now,
    runCommand: options.proofCommandRunner,
  })

  if (proofRun.status !== "passed") {
    return ok(buildValue(runtime, options, {
      status: proofRun.status === "idle" ? "proof-idle" : "proof-failed",
      actionId,
      card,
      missionId: proofRun.missionId,
      taskId: proofRun.taskId,
      proofStatus: proofRun.status,
      commands: proofRun.commands,
    }))
  }

  const advanced = advanceRunicMissionLoop(runtime, {
    contract: options.contract,
    holder: options.holder,
    idempotencyScope: options.idempotencyScope,
    ttlMs: options.ttlMs,
    staleAfterMs: options.staleAfterMs,
    recoverStale: false,
    now: options.now,
  })
  if (!advanced.ok) return advanced

  return ok(buildValue(runtime, options, {
    status: "proof-passed",
    actionId,
    card,
    missionId: proofRun.missionId,
    taskId: proofRun.taskId,
    nextStatus: advanced.value.status,
    missingEvidence: advanced.value.missingEvidence,
    proofStatus: proofRun.status,
    commands: proofRun.commands,
  }))
}

function resolveFaultlineNext(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
  actionId: LoopPulseActionId,
  card: RunebookCard,
): Result<RunebookNextValue> {
  const summary = options.faultline?.summary?.trim()
  if (!summary) {
    const pulse = deriveLoopPulse(runtime.snapshot())

    return ok(buildValue(runtime, options, {
      status: "faultline-held",
      actionId,
      card,
      missionId: pulse.missionId,
      taskId: pulse.taskId,
      missingEvidence: pulse.missingEvidence,
    }))
  }

  const resolved = resolveRunicFaultline(runtime, {
    contract: options.contract,
    holder: options.holder,
    idempotencyScope: `${options.idempotencyScope}:faultline`,
    ttlMs: options.ttlMs,
    staleAfterMs: options.staleAfterMs,
    recoverStale: options.recoverStale,
    now: options.now,
    summary,
    evidenceIdFactory: options.faultline?.evidenceIdFactory,
  })
  if (!resolved.ok) return resolved

  return ok(buildValue(runtime, options, {
    status: "faultline-resolved",
    actionId,
    card,
    missionId: resolved.value.missionId,
    taskId: resolved.value.taskId,
    nextStatus: resolved.value.nextStatus,
    missingEvidence: resolved.value.missingEvidence,
    faultlineResolution: {
      evidenceId: resolved.value.evidenceId,
      nextStatus: resolved.value.nextStatus,
      diagnostics: resolved.value.diagnostics,
    },
  }))
}

function resolveRiskNext(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
  actionId: LoopPulseActionId,
  card: RunebookCard,
): Result<RunebookNextValue> {
  const summary = options.risk?.summary?.trim()
  if (!summary) {
    const pulse = deriveLoopPulse(runtime.snapshot())

    return ok(buildValue(runtime, options, {
      status: "risk-held",
      actionId,
      card,
      missionId: pulse.missionId,
      taskId: pulse.taskId,
      missingEvidence: pulse.missingEvidence,
    }))
  }

  const resolved = resolveRunicRisk(runtime, {
    contract: options.contract,
    holder: options.holder,
    idempotencyScope: `${options.idempotencyScope}:risk`,
    ttlMs: options.ttlMs,
    verdict: options.risk?.verdict ?? "accepted",
    summary,
    now: options.now,
    evidenceIdFactory: options.risk?.evidenceIdFactory,
  })
  if (!resolved.ok) return resolved

  return ok(buildValue(runtime, options, {
    status: "risk-resolved",
    actionId,
    card,
    missionId: resolved.value.missionId,
    taskId: resolved.value.taskId,
    nextStatus: resolved.value.nextStatus,
    missingEvidence: resolved.value.missingEvidence,
    riskResolution: {
      evidenceId: resolved.value.evidenceId,
      verdict: resolved.value.verdict,
      nextStatus: resolved.value.nextStatus,
      risks: resolved.value.risks,
    },
  }))
}

function buildValue(
  runtime: RunesmithRuntime,
  options: RunebookNextOptions,
  input: Omit<RunebookNextValue, "loopPulse" | "runebook" | "proofPlan">,
): RunebookNextValue {
  const snapshot = runtime.snapshot()

  return {
    ...input,
    loopPulse: deriveLoopPulse(snapshot),
    runebook: deriveRunebook(snapshot, { proofPlanOptions: options.proofPlanOptions }),
    proofPlan: deriveProofPlan(snapshot, options.proofPlanOptions),
  }
}
