import {
  advanceRunicMissionLoop,
  createCovenantTaskPlan,
  createRuntime,
  deriveLoopPulse,
  deriveProofPlan,
  resolveRunicRisk,
  runRuneweave,
  runRunebookNext,
  runProofPlan,
  type AgentContract,
  type EvidenceType,
  type ProofCommandExecution,
  type ProofPlanCommand,
  type ProofPlanOptions,
  type ProofRunCommandResult,
  type RunebookNextStatus,
  type RuneweaveStatus,
  type RunicMissionLoopStatus,
  type RiskResolutionVerdict,
  type RuntimeOptions,
  type RuntimeSnapshot,
} from "@runesmith/core"
import { spawn } from "node:child_process"

export type DashboardRuntimeAction =
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

export type DashboardRuntimeActionValue = {
  action: DashboardRuntimeAction["type"]
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

export type DashboardRuntimeActionResult =
  | {
      ok: true
      value: DashboardRuntimeActionValue
    }
  | {
      ok: false
      error: {
        code: string
        message: string
        details?: Record<string, unknown>
      }
    }

type DashboardRuntimeActionOptions = Pick<RuntimeOptions, "idFactory" | "now"> & {
  proofPlanOptions?: ProofPlanOptions
  runProofCommand?: (command: ProofPlanCommand) => Promise<ProofCommandExecution> | ProofCommandExecution
}

const dashboardAtlasContract: AgentContract = {
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

const dashboardStaleAfterMs = 120_000
const shellProofCaptureLimit = 64_000

export async function applyDashboardRuntimeAction(
  snapshot: RuntimeSnapshot,
  action: DashboardRuntimeAction,
  options: DashboardRuntimeActionOptions = {},
): Promise<DashboardRuntimeActionResult> {
  const runtime = createRuntime({
    snapshot,
    idFactory: options.idFactory,
    now: options.now,
  })
  runtime.registerContract(dashboardAtlasContract)

  if (action.type === "forge-directive") {
    return forgeDashboardDirective(runtime, action.prompt)
  }

  if (action.type === "run-proof-plan") {
    return runDashboardProofPlan(runtime, options)
  }

  if (action.type === "run-next-action") {
    return runDashboardNextAction(runtime, action, options)
  }

  if (action.type === "run-os-loop") {
    return runDashboardOsLoop(runtime, action, options)
  }

  if (action.type === "resolve-risk") {
    return resolveDashboardRisk(runtime, action, options)
  }

  return runDashboardAutopilotCycle(runtime, options)
}

function forgeDashboardDirective(
  runtime: ReturnType<typeof createRuntime>,
  prompt: string,
): DashboardRuntimeActionResult {
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
    contractId: dashboardAtlasContract.id,
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

function runDashboardAutopilotCycle(
  runtime: ReturnType<typeof createRuntime>,
  options: DashboardRuntimeActionOptions,
): DashboardRuntimeActionResult {
  const advanced = advanceRunicMissionLoop(runtime, {
    contract: dashboardAtlasContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard",
    ttlMs: 30_000,
    recoverStale: true,
    staleAfterMs: dashboardStaleAfterMs,
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
      status: mapDashboardRunicStatus(advanced.value.status),
      missingEvidence: advanced.value.missingEvidence,
      snapshot: runtime.snapshot(),
    },
  }
}

async function runDashboardNextAction(
  runtime: ReturnType<typeof createRuntime>,
  action: Extract<DashboardRuntimeAction, { type: "run-next-action" }>,
  options: DashboardRuntimeActionOptions,
): Promise<DashboardRuntimeActionResult> {
  const before = runtime.snapshot()
  const nextEvidenceId = createDashboardEvidenceIdFactory(before, options.idFactory)
  const next = await runRunebookNext(runtime, {
    contract: dashboardAtlasContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard-next",
    ttlMs: 30_000,
    staleAfterMs: dashboardStaleAfterMs,
    proofPlanOptions: options.proofPlanOptions,
    proofCommandRunner: options.runProofCommand ?? runDashboardShellCommand,
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

async function runDashboardOsLoop(
  runtime: ReturnType<typeof createRuntime>,
  action: Extract<DashboardRuntimeAction, { type: "run-os-loop" }>,
  options: DashboardRuntimeActionOptions,
): Promise<DashboardRuntimeActionResult> {
  const before = runtime.snapshot()
  const nextEvidenceId = createDashboardEvidenceIdFactory(before, options.idFactory)
  const loop = await runRuneweave(runtime, {
    contract: dashboardAtlasContract,
    holder: "runesmith-dashboard",
    idempotencyScope: "dashboard-os",
    ttlMs: 30_000,
    staleAfterMs: dashboardStaleAfterMs,
    proofPlanOptions: options.proofPlanOptions,
    proofCommandRunner: options.runProofCommand ?? runDashboardShellCommand,
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
      proofStatus: loop.value.proofStatus as DashboardRuntimeActionValue["proofStatus"],
      missingEvidence: loop.value.finalPulse.missingEvidence,
      commands: loop.value.commands,
      snapshot: runtime.snapshot(),
    },
  }
}

function resolveDashboardRisk(
  runtime: ReturnType<typeof createRuntime>,
  action: Extract<DashboardRuntimeAction, { type: "resolve-risk" }>,
  options: DashboardRuntimeActionOptions,
): DashboardRuntimeActionResult {
  const nextEvidenceId = createDashboardEvidenceIdFactory(runtime.snapshot(), options.idFactory)
  const resolved = resolveRunicRisk(runtime, {
    contract: dashboardAtlasContract,
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
      status: mapDashboardRunicStatus(resolved.value.nextStatus),
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

async function runDashboardProofPlan(
  runtime: ReturnType<typeof createRuntime>,
  options: DashboardRuntimeActionOptions,
): Promise<DashboardRuntimeActionResult> {
  const before = runtime.snapshot()
  const proofPlan = deriveProofPlan(before, options.proofPlanOptions)
  const nextEvidenceId = createDashboardEvidenceIdFactory(before, options.idFactory)
  const proofRun = await runProofPlan(runtime, proofPlan, {
    nextEvidenceId,
    now: options.now,
    runCommand: options.runProofCommand ?? runDashboardShellCommand,
  })

  let status: DashboardRuntimeActionValue["status"] =
    proofRun.status === "idle" ? "idle" : proofRun.status === "failed" ? "waiting-for-evidence" : "running"
  if (proofRun.status === "passed") {
    const advanced = advanceRunicMissionLoop(runtime, {
      contract: dashboardAtlasContract,
      holder: "runesmith-dashboard",
      idempotencyScope: "dashboard",
      ttlMs: 30_000,
      recoverStale: false,
      staleAfterMs: dashboardStaleAfterMs,
      now: options.now,
    })
    if (!advanced.ok) return { ok: false, error: advanced.error }
    status = mapDashboardRunicStatus(advanced.value.status)
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

function mapDashboardRunicStatus(status: RunicMissionLoopStatus): DashboardRuntimeActionValue["status"] {
  return status === "claimed" ? "running" : status
}

function mapRunebookNextStatus(
  status: RunebookNextStatus,
  nextStatus: RunicMissionLoopStatus | undefined,
): DashboardRuntimeActionValue["status"] {
  if (status === "proof-failed" || status === "risk-held") return "waiting-for-evidence"
  if (status === "proof-idle" || status === "idle") return "idle"
  if (nextStatus) return mapDashboardRunicStatus(nextStatus)

  return "running"
}

function mapRuneweaveStatus(status: RuneweaveStatus): DashboardRuntimeActionValue["status"] {
  if (status === "sealed") return "completed"
  if (status === "idle") return "idle"
  if (status === "needs-work") return "running"
  if (status === "risk-held" || status === "proof-failed" || status === "blocked" || status === "step-limit") {
    return "waiting-for-evidence"
  }

  return "running"
}

async function runDashboardShellCommand(command: ProofPlanCommand): Promise<ProofCommandExecution> {
  return new Promise((resolve) => {
    const child = spawn(command.command, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const settle = (execution: ProofCommandExecution) => {
      if (settled) return
      settled = true
      resolve(execution)
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk, shellProofCaptureLimit)
    })
    child.stderr?.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk, shellProofCaptureLimit)
    })
    child.on("error", (error) => {
      settle({
        exitCode: 1,
        stdout,
        stderr: appendBoundedOutput(stderr, error.message, shellProofCaptureLimit),
      })
    })
    child.on("close", (code) => {
      settle({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      })
    })
  })
}

function appendBoundedOutput(current: string, chunk: unknown, maxLength: number): string {
  if (current.length >= maxLength) return current

  const text = String(chunk)
  const remaining = maxLength - current.length

  return `${current}${text.slice(0, remaining)}`
}

function createDashboardEvidenceIdFactory(
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
