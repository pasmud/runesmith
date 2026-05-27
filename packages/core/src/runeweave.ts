import { deriveLoopPulse, type LoopPulseActionId } from "./loop-pulse"
import { deriveProofPlan, type ProofPlan } from "./proof-plan"
import { deriveRunebook, type Runebook } from "./runebook"
import { runRunebookNext, type RunebookNextOptions, type RunebookNextValue } from "./runebook-next"
import type { RunesmithRuntime } from "./runtime"
import { runtimeError } from "./errors"
import { err, ok, type Result } from "./types"

export type RuneweaveStatus =
  | "sealed"
  | "idle"
  | "needs-work"
  | "blocked"
  | "risk-held"
  | "proof-failed"
  | "step-limit"

export type RuneweaveOptions = RunebookNextOptions & {
  maxSteps?: number
}

export type RuneweaveValue = {
  status: RuneweaveStatus
  stopReason: string
  stepCount: number
  steps: RunebookNextValue[]
  finalActionId: LoopPulseActionId
  missionId?: string
  taskId?: string
  proofStatus?: string
  commands: NonNullable<RunebookNextValue["commands"]>
  finalPulse: ReturnType<typeof deriveLoopPulse>
  runebook: Runebook
  proofPlan: ProofPlan
}

export async function runRuneweave(
  runtime: RunesmithRuntime,
  options: RuneweaveOptions,
): Promise<Result<RuneweaveValue>> {
  const maxSteps = options.maxSteps ?? 8
  if (!Number.isInteger(maxSteps) || maxSteps < 1) {
    return err(runtimeError("INVALID_TRANSITION", "Runeweave maxSteps must be a positive integer", {
      maxSteps,
    }))
  }

  const steps: RunebookNextValue[] = []
  for (let index = 0; index < maxSteps; index += 1) {
    const next = await runRunebookNext(runtime, {
      ...options,
      idempotencyScope: `${options.idempotencyScope}:runeweave:${index + 1}`,
    })
    if (!next.ok) return err(next.error)

    steps.push(next.value)
    const stop = classifyRuneweaveStop(next.value)
    if (stop) {
      return ok(buildRuneweaveValue(runtime, options, steps, stop))
    }
  }

  return ok(buildRuneweaveValue(runtime, options, steps, {
    status: "step-limit",
    reason: `Runeweave reached the ${maxSteps}-step safety limit before a terminal state.`,
  }))
}

function classifyRuneweaveStop(step: RunebookNextValue): { status: RuneweaveStatus; reason: string } | undefined {
  if (step.status === "proof-failed") {
    return {
      status: "proof-failed",
      reason: "Proof failed; Runeweave stopped so the active diagnostic can be repaired before another run.",
    }
  }

  if (step.status === "risk-held" || step.loopPulse.nextAction.id === "resolve-risk") {
    return {
      status: "risk-held",
      reason: "An unresolved risk requires a later decision before Runesmith can continue autonomously.",
    }
  }

  if (step.loopPulse.nextAction.id === "wait-for-goal") {
    return step.missionId
      ? {
          status: "sealed",
          reason: "No active mission remains after verified work was sealed.",
        }
      : {
          status: "idle",
          reason: "No active mission is ready for Runeweave.",
        }
  }

  if (step.loopPulse.nextAction.id === "continue-forge") {
    return {
      status: "needs-work",
      reason: "The active Runebook card requires implementation evidence before Runesmith can continue autonomously.",
    }
  }

  if (step.loopPulse.nextAction.id === "resolve-blocker") {
    return {
      status: "blocked",
      reason: "A blocker requires explicit recovery, diagnostic, risk, or decision evidence.",
    }
  }

  if (step.status === "proof-idle" || step.status === "idle") {
    return {
      status: "idle",
      reason: "Runeweave found no engine-owned action to run.",
    }
  }

  return undefined
}

function buildRuneweaveValue(
  runtime: RunesmithRuntime,
  options: Pick<RuneweaveOptions, "proofPlanOptions">,
  steps: RunebookNextValue[],
  stop: { status: RuneweaveStatus; reason: string },
): RuneweaveValue {
  const snapshot = runtime.snapshot()
  const finalPulse = deriveLoopPulse(snapshot)
  const latest = steps.at(-1)

  return {
    status: stop.status,
    stopReason: stop.reason,
    stepCount: steps.length,
    steps,
    finalActionId: finalPulse.nextAction.id,
    missionId: latest?.missionId,
    taskId: latest?.taskId,
    proofStatus: latest?.proofStatus,
    commands: steps.flatMap((step) => step.commands ?? []),
    finalPulse,
    runebook: deriveRunebook(snapshot, { proofPlanOptions: options.proofPlanOptions }),
    proofPlan: deriveProofPlan(snapshot, options.proofPlanOptions),
  }
}
