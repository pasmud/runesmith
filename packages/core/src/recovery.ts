import { taskDependenciesComplete } from "./mission-graph"
import type { Clock, MissionGraph, MissionTask } from "./types"

type RecoveryEventType = "task.stale" | "task.requeued"

export type RecoverStaleTasksInput = {
  now: Clock
  staleAfterMs: number
  requeueStale?: boolean
  eventIdFactory?: (taskId: string, type: RecoveryEventType) => string
}

export function recoverStaleTasks(graph: MissionGraph, input: RecoverStaleTasksInput): MissionGraph {
  const now = input.now()
  const nowIso = now.toISOString()
  const eventIdFactory = input.eventIdFactory ?? ((taskId: string) => `event_${taskId}_${crypto.randomUUID()}`)
  const tasks: Record<string, MissionTask> = {}
  const events = [...graph.events]

  for (const [taskId, task] of Object.entries(graph.tasks)) {
    let nextTask = task

    if (task.status === "running") {
      const heartbeatAt = task.lastHeartbeatAt ?? task.updatedAt
      const elapsedMs = now.getTime() - new Date(heartbeatAt).getTime()
      if (elapsedMs > input.staleAfterMs) {
        nextTask = {
          ...task,
          status: "stale",
          updatedAt: nowIso,
        }
        events.push({
          id: eventIdFactory(taskId, "task.stale"),
          type: "task.stale",
          at: nowIso,
          targetId: taskId,
          message: "Task marked stale after missing heartbeat",
          data: {
            staleAfterMs: input.staleAfterMs,
          },
        })
      }
    }

    const dependencyGraph = {
      ...graph,
      tasks: {
        ...graph.tasks,
        ...tasks,
        [taskId]: nextTask,
      },
    }
    if (input.requeueStale && nextTask.status === "stale" && taskDependenciesComplete(dependencyGraph, nextTask)) {
      const { assignedAgentId: _assignedAgentId, lastHeartbeatAt: _lastHeartbeatAt, ...requeuedTask } = nextTask
      nextTask = {
        ...requeuedTask,
        status: "queued",
        updatedAt: nowIso,
      }
      events.push({
        id: eventIdFactory(taskId, "task.requeued"),
        type: "task.requeued",
        at: nowIso,
        targetId: taskId,
        message: "Stale task requeued for reassignment",
        data: {
          staleAfterMs: input.staleAfterMs,
        },
      })
    }

    tasks[taskId] = nextTask
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
