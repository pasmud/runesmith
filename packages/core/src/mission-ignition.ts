import { createCovenantTaskPlan } from "./covenant.js"
import { deriveLoopPulse, type LoopPulse } from "./loop-pulse.js"
import { selectRunicLoopTask } from "./runic-loop.js"
import type { RunesmithRuntime, RuntimeSnapshot } from "./runtime.js"
import { runtimeError } from "./errors.js"
import { err, ok, type AgentContract, type Result } from "./types.js"

export type RunicMissionIgnitionOptions = {
  goal: string
  contract: AgentContract
  holder: string
  idempotencyScope: string
  ttlMs: number
}

export type RunicMissionIgnitionValue = {
  goal: string
  missionId: string
  taskId: string
  leaseId: string
  agentId?: string
  missionCreated: boolean
  replayed: boolean
  loopPulse: LoopPulse
}

export function prepareRunicMission(
  runtime: RunesmithRuntime,
  options: RunicMissionIgnitionOptions,
): Result<RunicMissionIgnitionValue> {
  const goal = normalizeIgnitionGoal(options.goal)
  if (!goal) {
    return err(runtimeError("INVALID_TRANSITION", "Runic mission ignition requires a goal"))
  }

  runtime.registerContract(options.contract)

  const existing = findActiveMissionForGoal(runtime.snapshot(), goal)
  let missionId = existing?.mission.id
  let taskId = missionId ? selectRunicLoopTask(runtime.snapshot(), missionId)?.taskId : undefined
  let missionCreated = false

  if (!missionId || !taskId) {
    const started = runtime.startMission({
      goal,
      taskPlan: createCovenantTaskPlan(goal),
    })
    if (!started.ok) return started

    missionId = started.value.missionId
    taskId = started.value.rootTaskId
    missionCreated = true
  }

  const claimed = runtime.claimTask({
    missionId,
    taskId,
    contractId: options.contract.id,
    holder: options.holder,
    idempotencyKey: `${options.idempotencyScope}:${missionId}:${taskId}`,
    ttlMs: options.ttlMs,
  })
  if (!claimed.ok) return claimed

  return ok({
    goal,
    missionId,
    taskId,
    leaseId: claimed.value.lease.id,
    agentId: claimed.value.task.assignedAgentId,
    missionCreated,
    replayed: claimed.value.replayed,
    loopPulse: deriveLoopPulse(runtime.snapshot()),
  })
}

export function findActiveMissionForGoal(snapshot: RuntimeSnapshot, goal: string) {
  const normalizedGoal = normalizeIgnitionGoal(goal)
  if (!normalizedGoal) return undefined

  return Object.values(snapshot.graphs).find((graph) => {
    if (["complete", "failed", "cancelled"].includes(graph.mission.status)) return false
    return normalizeIgnitionGoal(graph.mission.goal) === normalizedGoal
  })
}

function normalizeIgnitionGoal(goal: string): string | undefined {
  const normalized = goal.replace(/\s+/g, " ").trim()

  return normalized.length > 0 ? normalized : undefined
}
