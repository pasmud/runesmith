import type { Clock, MissionGraph, MissionTask } from "./types"

export type RecoverStaleTasksInput = {
  now: Clock
  staleAfterMs: number
  eventIdFactory?: (taskId: string) => string
}

export function recoverStaleTasks(graph: MissionGraph, input: RecoverStaleTasksInput): MissionGraph {
  const now = input.now()
  const nowIso = now.toISOString()
  const eventIdFactory = input.eventIdFactory ?? ((taskId: string) => `event_${taskId}_${crypto.randomUUID()}`)
  const tasks: Record<string, MissionTask> = {}
  const events = [...graph.events]

  for (const [taskId, task] of Object.entries(graph.tasks)) {
    if (task.status !== "running") {
      tasks[taskId] = task
      continue
    }

    const heartbeatAt = task.lastHeartbeatAt ?? task.updatedAt
    const elapsedMs = now.getTime() - new Date(heartbeatAt).getTime()
    if (elapsedMs <= input.staleAfterMs) {
      tasks[taskId] = task
      continue
    }

    tasks[taskId] = {
      ...task,
      status: "stale",
      updatedAt: nowIso,
    }
    events.push({
      id: eventIdFactory(taskId),
      type: "task.stale",
      at: nowIso,
      targetId: taskId,
      message: "Task marked stale after missing heartbeat",
      data: {
        staleAfterMs: input.staleAfterMs,
      },
    })
  }

  return {
    mission: {
      ...graph.mission,
      updatedAt: events.length === graph.events.length ? graph.mission.updatedAt : nowIso,
    },
    tasks,
    events,
  }
}
