import { runtimeError } from "./errors"
import { err, ok, type Clock, type IdFactory, type MissionGraph, type TaskStatus } from "./types"

export type CreateMissionGraphInput = {
  goal: string
  idFactory?: IdFactory
  now?: Clock
  requiredCapabilities?: string[]
}

export type TransitionTaskInput = {
  taskId: string
  nextStatus: TaskStatus
  now?: Clock
  reason: string
  eventId?: string
}

const terminalStatuses = new Set<TaskStatus>(["complete", "failed", "cancelled"])

const allowedTransitions: Record<TaskStatus, TaskStatus[]> = {
  queued: ["running", "blocked", "cancelled"],
  running: ["blocked", "stale", "verifying", "complete", "failed", "cancelled"],
  blocked: ["queued", "cancelled"],
  stale: ["queued", "failed", "cancelled"],
  verifying: ["running", "complete", "failed", "cancelled"],
  complete: [],
  failed: [],
  cancelled: [],
}

function defaultIdFactory(prefix: Parameters<IdFactory>[0]): string {
  return `${prefix}_${crypto.randomUUID()}`
}

function defaultClock(): Date {
  return new Date()
}

export function createMissionGraph(input: CreateMissionGraphInput) {
  const now = (input.now ?? defaultClock)().toISOString()
  const idFactory = input.idFactory ?? defaultIdFactory
  const missionId = idFactory("mission")
  const rootTaskId = idFactory("task")
  const eventId = idFactory("event")

  const graph: MissionGraph = {
    mission: {
      id: missionId,
      goal: input.goal,
      status: "running",
      rootTaskId,
      createdAt: now,
      updatedAt: now,
    },
    tasks: {
      [rootTaskId]: {
        id: rootTaskId,
        missionId,
        title: "Mission root",
        description: input.goal,
        status: "queued",
        requiredCapabilities: input.requiredCapabilities ?? [],
        createdAt: now,
        updatedAt: now,
      },
    },
    events: [
      {
        id: eventId,
        type: "mission.created",
        at: now,
        targetId: missionId,
        message: "Mission created",
        data: { rootTaskId },
      },
    ],
  }

  return ok(graph)
}

export function transitionTask(graph: MissionGraph, input: TransitionTaskInput) {
  const existing = graph.tasks[input.taskId]
  if (!existing) {
    return err(runtimeError("TASK_NOT_FOUND", "Task does not exist", { taskId: input.taskId }))
  }

  const from = existing.status
  const to = input.nextStatus
  if (!allowedTransitions[from].includes(to)) {
    return err(
      runtimeError("INVALID_TRANSITION", `Cannot transition task from ${from} to ${to}`, {
        taskId: input.taskId,
        from,
        to,
      }),
    )
  }

  const now = (input.now ?? defaultClock)().toISOString()
  const updatedTask = {
    ...existing,
    status: to,
    updatedAt: now,
    lastHeartbeatAt: to === "running" ? now : existing.lastHeartbeatAt,
  }

  const nextGraph: MissionGraph = {
    mission: {
      ...graph.mission,
      status: resolveMissionStatus(graph, input.taskId, to),
      updatedAt: now,
    },
    tasks: {
      ...graph.tasks,
      [input.taskId]: updatedTask,
    },
    events: [
      ...graph.events,
      {
        id: input.eventId ?? defaultIdFactory("event"),
        type: "task.transitioned",
        at: now,
        targetId: input.taskId,
        message: input.reason,
        data: { from, to },
      },
    ],
  }

  return ok(nextGraph)
}

function resolveMissionStatus(graph: MissionGraph, taskId: string, nextStatus: TaskStatus) {
  if (taskId !== graph.mission.rootTaskId) {
    return graph.mission.status
  }

  if (nextStatus === "complete") return "complete"
  if (nextStatus === "failed") return "failed"
  if (nextStatus === "cancelled") return "cancelled"
  if (nextStatus === "blocked") return "blocked"
  if (terminalStatuses.has(nextStatus)) return graph.mission.status

  return "running"
}
