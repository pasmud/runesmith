import { createCovenantTaskPlan } from "./covenant.js"
import { deriveLoopPulse } from "./loop-pulse.js"
import { deriveProofPlan, type ProofPlanCommand, type ProofPlanOptions } from "./proof-plan.js"
import { runProofPlan, type ProofCommandExecution, type ProofRunCommandResult } from "./proof-runner.js"
import { createRuntime, type RuntimeOptions, type RuntimeSnapshot } from "./runtime.js"
import { runRunebookNext, type RunebookNextStatus } from "./runebook-next.js"
import { runRuneweave, type RuneweaveStatus } from "./runeweave.js"
import {
  advanceRunicMissionLoop,
  resolveRunicRisk,
  type RiskResolutionVerdict,
  type RunicMissionLoopStatus,
} from "./runic-loop.js"
import type { AgentContract, EvidenceType } from "./types.js"

export type RuntimeControlAction =
  | {
      type: "forge-directive"
      prompt: string
    }
  | {
      type: "run-autopilot-cycle"
    }
  | {
      type: "run-next-action"
      verdict?: RiskResolutionVerdict
      summary?: string
    }
  | {
      type: "run-os-loop"
      maxSteps?: number
      verdict?: RiskResolutionVerdict
      summary?: string
    }
  | {
      type: "run-proof-plan"
    }
  | {
      type: "resolve-risk"
      verdict?: RiskResolutionVerdict
      summary?: string
    }

export type RuntimeControlActionValue = {
  action: RuntimeControlAction["type"]
  missionId?: string
  taskId?: string
  nextTaskId?: string
  nextTaskStatus?: string
  status: "running" | "waiting-for-evidence" | "completed" | "idle" | "recovered"
  loopStatus?: RuneweaveStatus
  missingEvidence?: EvidenceType[]
  proofStatus?: "idle" | "passed" | "failed"
  commands?: ProofRunCommandResult[]
  riskResolution?: {
    evidenceId: string
    verdict: RiskResolutionVerdict
    nextStatus: RunicMissionLoopStatus
    risks: string[]
  }
  snapshot: RuntimeSnapshot
}

export type RuntimeControlActionResult =
  | {
      ok: true
      value: RuntimeControlActionValue
    }
  | {
      ok: false
      error: {
        code: string
        message: string
        details?: Record<string, unknown>
      }
    }

export type RuntimeControlActionOptions = Pick<RuntimeOptions, "idFactory" | "now"> & {
  proofPlanOptions?: ProofPlanOptions
  runProofCommand?: (command: ProofPlanCommand) => Promise<ProofCommandExecution> | ProofCommandExecution
}

export const defaultRuntimeControlContract: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent for TypeScript, tests, and repository edits.",
  capabilities: ["typescript", "testing", "repository-maintenance"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "anthropic/claude-sonnet-4.5",
    fallbacks: ["openai/gpt-5.1-codex"],
  },
  fileScope: ["packages/**", "docs/**", "examples/**"],
  completionCriteria: ["Relevant files changed", "Verification command recorded"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: ["agent_oracle"],
}

const runtimeControlStaleAfterMs = 120_000

export async function applyRuntimeControlAction(
  snapshot: RuntimeSnapshot,
  action: RuntimeControlAction,
  options: RuntimeControlActionOptions = {},
): Promise<RuntimeControlActionResult> {
  const runtime = createRuntime({
    snapshot,
    idFactory: options.idFactory,
    now: options.now,
  })
  runtime.registerContract(defaultRuntimeControlContract)

  if (action.type === "forge-directive") {
    return forgeRuntimeDirective(runtime, action.prompt)
  }

  if (action.type === "run-proof-plan") {
    return runRuntimeProofPlan(runtime, options)
  }

  if (action.type === "run-next-action") {
    return runRuntimeNextAction(runtime, action, options)
  }

  if (action.type === "run-os-loop") {
    return runRuntimeOsLoop(runtime, action, options)
  }

  if (action.type === "resolve-risk") {
    return resolveRuntimeRisk(runtime, action, options)
  }

  return runRuntimeAutopilotCycle(runtime, options)
}

function forgeRuntimeDirective(
  runtime: ReturnType<typeof createRuntime>,
  prompt: string,
): RuntimeControlActionResult {
  const goal = normalizeDirective(prompt)
  if (!goal) {
    return {
      ok: false,
      error: {
        code: "DIRECTIVE_REQUIRED",
        message: "A mission directive is required before Runesmith can forge runtime work.",
      },
    }
  }

  const started = runtime.startMission({
    goal,
    taskPlan: createCovenantTaskPlan(goal),
  })
  if (!started.ok) return { ok: false, error: started.error }

  const claimed = runtime.claimTask({
    missionId: started.value.missionId,
    taskId: started.value.rootTaskId,
    contractId: defaultRuntimeControlContract.id,
    holder: "runesmith-dashboard",
    idempotencyKey: `dashboard:${fingerprint(goal)}`,
    ttlMs: 30_000,
  })
  if (!claimed.ok) return { ok: false, error: claimed.error }

  return {
    ok: true,
    value: {
      action: "forge-directive",
      missionId: started.value.missionId,
      taskId: started.value.rootTaskId,
      status: "running",
      snapshot: runtime.snapshot(),
    },
  }
}

function runRuntimeAutopilotCycle(
  runtime: ReturnType<typeof createRuntime>,
  options: RuntimeControlActionOptions,
): RuntimeControlActionResult {
  const advanced = advanceRunicMissionLoop(runtime, {
    contract: defaultRuntimeControlContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard",
    ttlMs: 30_000,
    recoverStale: true,
    staleAfterMs: runtimeControlStaleAfterMs,
    now: options.now,
  })
  if (!advanced.ok) return { ok: false, error: advanced.error }

  return {
    ok: true,
    value: {
      action: "run-autopilot-cycle",
      missionId: advanced.value.missionId,
      taskId: advanced.value.taskId,
      nextTaskStatus: advanced.value.nextTaskStatus,
      status: mapRuntimeControlRunicStatus(advanced.value.status),
      missingEvidence: advanced.value.missingEvidence,
      snapshot: runtime.snapshot(),
    },
  }
}

async function runRuntimeNextAction(
  runtime: ReturnType<typeof createRuntime>,
  action: Extract<RuntimeControlAction, { type: "run-next-action" }>,
  options: RuntimeControlActionOptions,
): Promise<RuntimeControlActionResult> {
  const before = runtime.snapshot()
  const nextEvidenceId = createRuntimeControlEvidenceIdFactory(before, options.idFactory)
  const next = await runRunebookNext(runtime, {
    contract: defaultRuntimeControlContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard-next",
    ttlMs: 30_000,
    staleAfterMs: runtimeControlStaleAfterMs,
    proofPlanOptions: options.proofPlanOptions,
    proofCommandRunner: options.runProofCommand,
    nextEvidenceId,
    now: options.now,
    risk: {
      verdict: action.verdict ?? "accepted",
      summary: action.summary,
      evidenceIdFactory: () => nextEvidenceId(),
    },
  })
  if (!next.ok) return { ok: false, error: next.error }

  return {
    ok: true,
    value: {
      action: "run-next-action",
      missionId: next.value.missionId,
      taskId: next.value.taskId,
      status: mapRunebookNextStatus(next.value.status, next.value.nextStatus),
      proofStatus: next.value.proofStatus,
      missingEvidence: next.value.loopPulse.missingEvidence,
      commands: next.value.commands,
      riskResolution: next.value.riskResolution,
      snapshot: runtime.snapshot(),
    },
  }
}

async function runRuntimeOsLoop(
  runtime: ReturnType<typeof createRuntime>,
  action: Extract<RuntimeControlAction, { type: "run-os-loop" }>,
  options: RuntimeControlActionOptions,
): Promise<RuntimeControlActionResult> {
  const before = runtime.snapshot()
  const nextEvidenceId = createRuntimeControlEvidenceIdFactory(before, options.idFactory)
  const loop = await runRuneweave(runtime, {
    contract: defaultRuntimeControlContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard-os",
    ttlMs: 30_000,
    staleAfterMs: runtimeControlStaleAfterMs,
    proofPlanOptions: options.proofPlanOptions,
    proofCommandRunner: options.runProofCommand,
    nextEvidenceId,
    now: options.now,
    maxSteps: action.maxSteps,
    risk: {
      verdict: action.verdict ?? "accepted",
      summary: action.summary,
      evidenceIdFactory: () => nextEvidenceId(),
    },
  })
  if (!loop.ok) return { ok: false, error: loop.error }

  return {
    ok: true,
    value: {
      action: "run-os-loop",
      missionId: loop.value.missionId,
      taskId: loop.value.taskId,
      status: mapRuneweaveStatus(loop.value.status),
      loopStatus: loop.value.status,
      proofStatus: loop.value.proofStatus as RuntimeControlActionValue["proofStatus"],
      missingEvidence: loop.value.finalPulse.missingEvidence,
      commands: loop.value.commands,
      snapshot: runtime.snapshot(),
    },
  }
}

function resolveRuntimeRisk(
  runtime: ReturnType<typeof createRuntime>,
  action: Extract<RuntimeControlAction, { type: "resolve-risk" }>,
  options: RuntimeControlActionOptions,
): RuntimeControlActionResult {
  const nextEvidenceId = createRuntimeControlEvidenceIdFactory(runtime.snapshot(), options.idFactory)
  const resolved = resolveRunicRisk(runtime, {
    contract: defaultRuntimeControlContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard",
    ttlMs: 30_000,
    verdict: action.verdict ?? "accepted",
    summary: action.summary,
    now: options.now,
    evidenceIdFactory: () => nextEvidenceId(),
  })
  if (!resolved.ok) return { ok: false, error: resolved.error }

  return {
    ok: true,
    value: {
      action: "resolve-risk",
      missionId: resolved.value.missionId,
      taskId: resolved.value.taskId,
      status: mapRuntimeControlRunicStatus(resolved.value.nextStatus),
      missingEvidence: resolved.value.missingEvidence,
      riskResolution: {
        evidenceId: resolved.value.evidenceId,
        verdict: resolved.value.verdict,
        nextStatus: resolved.value.nextStatus,
        risks: resolved.value.risks,
      },
      snapshot: runtime.snapshot(),
    },
  }
}

async function runRuntimeProofPlan(
  runtime: ReturnType<typeof createRuntime>,
  options: RuntimeControlActionOptions,
): Promise<RuntimeControlActionResult> {
  if (!options.runProofCommand) {
    return {
      ok: false,
      error: {
        code: "PROOF_RUNNER_REQUIRED",
        message: "Runtime control proof actions require a proof command runner.",
      },
    }
  }

  const before = runtime.snapshot()
  const proofPlan = deriveProofPlan(before, options.proofPlanOptions)
  const nextEvidenceId = createRuntimeControlEvidenceIdFactory(before, options.idFactory)
  const proofRun = await runProofPlan(runtime, proofPlan, {
    nextEvidenceId,
    now: options.now,
    runCommand: options.runProofCommand,
  })

  let status: RuntimeControlActionValue["status"] =
    proofRun.status === "idle" ? "idle" : proofRun.status === "failed" ? "waiting-for-evidence" : "running"
  if (proofRun.status === "passed") {
    const advanced = advanceRunicMissionLoop(runtime, {
      contract: defaultRuntimeControlContract,
      holder: "runesmith-dashboard",
      idempotencyScope: "dashboard",
      ttlMs: 30_000,
      recoverStale: false,
      staleAfterMs: runtimeControlStaleAfterMs,
      now: options.now,
    })
    if (!advanced.ok) return { ok: false, error: advanced.error }
    status = mapRuntimeControlRunicStatus(advanced.value.status)
  }

  const snapshot = runtime.snapshot()
  const pulse = deriveLoopPulse(snapshot)

  return {
    ok: true,
    value: {
      action: "run-proof-plan",
      missionId: proofRun.missionId,
      taskId: proofRun.taskId,
      status,
      proofStatus: proofRun.status,
      missingEvidence: pulse.missingEvidence,
      commands: proofRun.commands,
      snapshot,
    },
  }
}

function mapRuntimeControlRunicStatus(status: RunicMissionLoopStatus): RuntimeControlActionValue["status"] {
  return status === "claimed" ? "running" : status
}

function mapRunebookNextStatus(
  status: RunebookNextStatus,
  nextStatus: RunicMissionLoopStatus | undefined,
): RuntimeControlActionValue["status"] {
  if (status === "proof-failed" || status === "risk-held") return "waiting-for-evidence"
  if (status === "proof-idle" || status === "idle") return "idle"
  if (nextStatus) return mapRuntimeControlRunicStatus(nextStatus)

  return "running"
}

function mapRuneweaveStatus(status: RuneweaveStatus): RuntimeControlActionValue["status"] {
  if (status === "sealed") return "completed"
  if (status === "idle") return "idle"
  if (status === "needs-work") return "running"
  if (status === "risk-held" || status === "proof-failed" || status === "blocked" || status === "step-limit") {
    return "waiting-for-evidence"
  }

  return "running"
}

function createRuntimeControlEvidenceIdFactory(
  snapshot: RuntimeSnapshot,
  idFactory: RuntimeOptions["idFactory"] | undefined,
): () => string {
  const used = new Set(Object.values(snapshot.ledgers).flatMap((ledger) => Object.keys(ledger.evidence)))
  let index = 0

  return () => {
    index += 1
    const base = idFactory?.("evidence") ?? `evidence_dashboard_${index}`
    const id = used.has(base) ? `${base}_${index}` : base
    used.add(id)

    return id
  }
}

function normalizeDirective(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ")
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}
