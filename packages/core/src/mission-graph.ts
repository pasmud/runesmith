import { runtimeError } from "./errors"
import {
  err,
  ok,
  type Clock,
  type EvidenceType,
  type IdFactory,
  type MissionGraph,
  type MissionStatus,
  type MissionTask,
  type TaskStatus,
} from "./types"

export type CreateMissionGraphInput = {
  goal: string
  idFactory?: IdFactory
  now?: Clock
  requiredCapabilities?: string[]
  taskPlan?: MissionTaskPlanItem[]
}

export type MissionTaskPlanItem = {
  key: string
  title: string
  description: string
  requiredCapabilities?: string[]
  requiredEvidence?: EvidenceType[]
  dependsOn?: string[]
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
  const taskPlan = input.taskPlan?.length ? input.taskPlan : undefined
  const tasks = taskPlan
    ? buildPlannedTasks({
        missionId,
        rootTaskId,
        now,
        defaultCapabilities: input.requiredCapabilities ?? [],
        taskPlan,
      })
    : {
        [rootTaskId]: {
          id: rootTaskId,
          missionId,
          title: "Mission root",
          description: input.goal,
          status: "queued" as const,
          requiredCapabilities: input.requiredCapabilities ?? [],
          createdAt: now,
          updatedAt: now,
        },
      }

  const graph: MissionGraph = {
    mission: {
      id: missionId,
      goal: input.goal,
      status: "running",
      rootTaskId,
      createdAt: now,
      updatedAt: now,
    },
    tasks,
    events: [
      {
        id: eventId,
        type: "mission.created",
        at: now,
        targetId: missionId,
        message: "Mission created",
        data: taskPlan ? { rootTaskId, taskCount: taskPlan.length } : { rootTaskId },
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
  const tasks = {
    ...graph.tasks,
    [input.taskId]: updatedTask,
  }

  const nextGraph: MissionGraph = {
    mission: {
      ...graph.mission,
      status: resolveMissionStatus(graph, tasks, input.taskId, to),
      updatedAt: now,
    },
    tasks,
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

export function taskDependenciesComplete(graph: MissionGraph, task: MissionTask): boolean {
  return (task.dependsOn ?? []).every((dependencyId) => graph.tasks[dependencyId]?.status === "complete")
}

function buildPlannedTasks(input: {
  missionId: string
  rootTaskId: string
  now: string
  defaultCapabilities: string[]
  taskPlan: MissionTaskPlanItem[]
}): Record<string, MissionTask> {
  const taskIds = new Map(
    input.taskPlan.map((item, index) => {
      return [item.key, index === 0 ? input.rootTaskId : `${input.rootTaskId}_${normalizePlanKey(item.key)}`]
    }),
  )

  return Object.fromEntries(
    input.taskPlan.map((item, index) => {
      const id = taskIds.get(item.key)!
      const task: MissionTask = {
        id,
        missionId: input.missionId,
        parentId: index === 0 ? undefined : input.rootTaskId,
        title: item.title,
        description: item.description,
        status: "queued",
        requiredCapabilities: item.requiredCapabilities ?? input.defaultCapabilities,
        requiredEvidence: item.requiredEvidence ? [...item.requiredEvidence] : undefined,
        dependsOn: item.dependsOn?.map((dependencyKey) => taskIds.get(dependencyKey) ?? dependencyKey),
        createdAt: input.now,
        updatedAt: input.now,
      }

      return [id, task]
    }),
  )
}

function normalizePlanKey(key: string): string {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || "task"
}

function resolveMissionStatus(
  graph: MissionGraph,
  tasks: Record<string, MissionTask>,
  taskId: string,
  nextStatus: TaskStatus,
): MissionStatus {
  if (taskId === graph.mission.rootTaskId) {
    if (nextStatus === "failed") return "failed"
    if (nextStatus === "cancelled") return "cancelled"
  }

  const taskList = Object.values(tasks)
  if (taskList.length > 0 && taskList.every((task) => task.status === "complete")) return "complete"
  if (taskList.some((task) => task.status === "blocked")) return "blocked"
  if (terminalStatuses.has(nextStatus)) return graph.mission.status

  return "running"
}
