import {
  advanceRunicMissionLoop,
  createCovenantTaskPlan,
  createRuntime,
  type AgentContract,
  type EvidenceType,
  type RunicMissionLoopStatus,
  type RuntimeOptions,
  type RuntimeSnapshot,
} from "@runesmith/core"

export type DashboardRuntimeAction =
  | {
      type: "forge-directive"
      prompt: string
    }
  | {
      type: "run-autopilot-cycle"
    }

export type DashboardRuntimeActionValue = {
  action: DashboardRuntimeAction["type"]
  missionId?: string
  taskId?: string
  nextTaskId?: string
  nextTaskStatus?: string
  status: "running" | "waiting-for-evidence" | "completed" | "idle" | "recovered"
  missingEvidence?: EvidenceType[]
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

type DashboardRuntimeActionOptions = Pick<RuntimeOptions, "idFactory" | "now">

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

function mapDashboardRunicStatus(status: RunicMissionLoopStatus): DashboardRuntimeActionValue["status"] {
  return status === "claimed" ? "running" : status
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
