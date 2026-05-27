import {
  createRuntime,
  type AgentContract,
  type EvidenceType,
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

  const started = runtime.startMission({ goal })
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
  const snapshot = runtime.snapshot()
  const staleMission = Object.values(snapshot.graphs).find((graph) => {
    return Object.values(graph.tasks).some((task) => task.status === "stale")
  })

  if (staleMission) {
    const recovered = runtime.recover({
      missionId: staleMission.mission.id,
      staleAfterMs: 120_000,
      now: options.now,
    })
    if (!recovered.ok) return { ok: false, error: recovered.error }

    return {
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        missionId: staleMission.mission.id,
        status: "recovered",
        snapshot: runtime.snapshot(),
      },
    }
  }

  const target = selectActiveTask(snapshot)
  if (!target) {
    return {
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        status: "idle",
        snapshot,
      },
    }
  }

  const graph = snapshot.graphs[target.missionId]
  const task = graph?.tasks[target.taskId]
  if (!graph || !task) {
    return {
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        status: "idle",
        snapshot,
      },
    }
  }

  const contractId = task.assignedAgentId ?? dashboardAtlasContract.id
  const contract = snapshot.contracts[contractId] ?? dashboardAtlasContract
  const missingEvidence = getMissingEvidence(snapshot, {
    missionId: target.missionId,
    taskId: target.taskId,
    requiredEvidence: contract.requiredEvidence,
  })

  if (missingEvidence.length > 0) {
    return {
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        missionId: target.missionId,
        taskId: target.taskId,
        status: "waiting-for-evidence",
        missingEvidence,
        snapshot,
      },
    }
  }

  const completed = runtime.completeTask({
    missionId: target.missionId,
    taskId: target.taskId,
    contractId,
  })
  if (!completed.ok) return { ok: false, error: completed.error }

  return {
    ok: true,
    value: {
      action: "run-autopilot-cycle",
      missionId: target.missionId,
      taskId: target.taskId,
      status: "completed",
      snapshot: runtime.snapshot(),
    },
  }
}

function selectActiveTask(snapshot: RuntimeSnapshot): { missionId: string; taskId: string } | undefined {
  const rank: Record<string, number> = {
    running: 0,
    verifying: 1,
    queued: 2,
    blocked: 3,
    stale: 4,
  }

  return Object.values(snapshot.graphs)
    .filter((graph) => !["complete", "failed", "cancelled"].includes(graph.mission.status))
    .flatMap((graph) => {
      return Object.values(graph.tasks)
        .filter((task) => !["complete", "failed", "cancelled"].includes(task.status))
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
      return right.updatedAt.localeCompare(left.updatedAt)
    })[0]
}

function getMissingEvidence(
  snapshot: RuntimeSnapshot,
  input: { missionId: string; taskId: string; requiredEvidence: EvidenceType[] },
): EvidenceType[] {
  const present = new Set(
    Object.values(snapshot.ledgers[input.missionId]?.evidence ?? {})
      .filter((evidence) => evidence.taskId === input.taskId)
      .map((evidence) => evidence.type),
  )

  return input.requiredEvidence.filter((type) => !present.has(type))
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
