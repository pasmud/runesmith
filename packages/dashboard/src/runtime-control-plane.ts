import {
  createCovenantDecisionDraft,
  createCovenantTaskPlan,
  createRuntime,
  getRequiredEvidenceForTask,
  missingRequiredEvidence,
  taskDependenciesComplete,
  type AgentContract,
  type EvidenceType,
  type MissionTask,
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

type DashboardRecoveryResult =
  | {
      ok: true
      value: {
        recovered: boolean
        missionId?: string
        taskIds: string[]
      }
    }
  | {
      ok: false
      error: {
        code: string
        message: string
        details?: Record<string, unknown>
      }
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
  const recovered = recoverDashboardStaleWork(runtime, options)
  if (!recovered.ok) return { ok: false, error: recovered.error }
  if (recovered.value.recovered) {
    const recoveredSnapshot = runtime.snapshot()
    const target = selectActiveTask(recoveredSnapshot, recovered.value.missionId)
    const task = target ? recoveredSnapshot.graphs[target.missionId]?.tasks[target.taskId] : undefined
    const claimed = task?.status === "queued"
      ? claimDashboardTask(runtime, {
          missionId: target!.missionId,
          task,
        })
      : undefined
    if (claimed && !claimed.ok) return { ok: false, error: claimed.error }

    const taskId = claimed?.ok ? claimed.value.task.id : target?.taskId
    const nextTaskStatus = claimed?.ok ? claimed.value.task.status : task?.status
    return {
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        missionId: recovered.value.missionId,
        taskId,
        nextTaskStatus,
        status: "recovered",
        snapshot: runtime.snapshot(),
      },
    }
  }

  const snapshot = runtime.snapshot()
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
    requiredEvidence: getRequiredEvidenceForTask(task, contract),
  })
  const decisionDraft = createCovenantDecisionDraft(task)
  if (decisionDraft && missingEvidence.length === 1 && missingEvidence[0] === "decision") {
    const recorded = runtime.addTaskEvidence({
      missionId: target.missionId,
      evidence: {
        id: `evidence_auto_decision_${fingerprint(`${target.missionId}:${target.taskId}:${decisionDraft.stage}`)}`,
        taskId: target.taskId,
        type: "decision",
        summary: decisionDraft.summary,
        payload: decisionDraft.payload,
        createdAt: new Date().toISOString(),
      },
    })
    if (!recorded.ok) return { ok: false, error: recorded.error }

    return runDashboardAutopilotCycle(runtime, options)
  }

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

  const nextTarget = selectActiveTask(runtime.snapshot(), target.missionId)
  const nextTask = nextTarget ? runtime.snapshot().graphs[nextTarget.missionId]?.tasks[nextTarget.taskId] : undefined
  const nextClaimed = nextTask?.status === "queued"
    ? claimDashboardTask(runtime, {
        missionId: target.missionId,
        task: nextTask,
      })
    : undefined
  if (nextClaimed && !nextClaimed.ok) return { ok: false, error: nextClaimed.error }

  if (nextClaimed?.ok) {
    return runDashboardAutopilotCycle(runtime, options)
  }

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

function recoverDashboardStaleWork(
  runtime: ReturnType<typeof createRuntime>,
  options: DashboardRuntimeActionOptions,
): DashboardRecoveryResult {
  const terminalMissionStatuses = new Set(["complete", "failed", "cancelled"])
  const snapshot = runtime.snapshot()

  for (const graph of Object.values(snapshot.graphs)) {
    if (terminalMissionStatuses.has(graph.mission.status)) continue

    const recovered = runtime.recover({
      missionId: graph.mission.id,
      staleAfterMs: dashboardStaleAfterMs,
      requeueStale: true,
      now: options.now,
    })
    if (!recovered.ok) return { ok: false, error: recovered.error }

    const taskIds = Object.values(recovered.value.graph.tasks)
      .filter((task) => {
        const previous = graph.tasks[task.id]
        return previous && previous.status !== task.status && ["running", "stale"].includes(previous.status)
      })
      .map((task) => task.id)

    if (taskIds.length > 0 || recovered.value.graph.events.length > graph.events.length) {
      return {
        ok: true,
        value: {
          recovered: true,
          missionId: graph.mission.id,
          taskIds,
        },
      }
    }
  }

  return {
    ok: true,
    value: {
      recovered: false,
      taskIds: [],
    },
  }
}

function claimDashboardTask(
  runtime: ReturnType<typeof createRuntime>,
  input: { missionId: string; task: MissionTask },
) {
  return runtime.claimTask({
    missionId: input.missionId,
    taskId: input.task.id,
    contractId: dashboardAtlasContract.id,
    holder: "runesmith-dashboard",
    idempotencyKey: `dashboard:${input.missionId}:${input.task.id}`,
    ttlMs: 30_000,
  })
}

function selectActiveTask(snapshot: RuntimeSnapshot, missionId?: string): { missionId: string; taskId: string } | undefined {
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
      return right.updatedAt.localeCompare(left.updatedAt)
    })[0]
}

function getMissingEvidence(
  snapshot: RuntimeSnapshot,
  input: { missionId: string; taskId: string; requiredEvidence: EvidenceType[] },
): EvidenceType[] {
  const ledger = snapshot.ledgers[input.missionId]
  if (!ledger) return input.requiredEvidence

  return missingRequiredEvidence(ledger, input)
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
