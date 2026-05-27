import { runtimeError } from "./errors.js"
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
} from "./types.js"

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

export type RemapMissionGraphInput = {
  taskPlan: MissionTaskPlanItem[]
  now?: Clock
  eventId?: string
  preserveRootTaskState?: boolean
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
  const plannedTaskIds = taskPlan ? buildPlannedTaskIds(taskPlan, rootTaskId) : undefined
  const tasks = taskPlan
    ? buildPlannedTasks({
        missionId,
        rootTaskId,
        now,
        defaultCapabilities: input.requiredCapabilities ?? [],
        taskPlan,
        taskIds: plannedTaskIds!,
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
      ...(taskPlan && plannedTaskIds
        ? [
            {
              id: `${eventId}_map`,
              type: "mission.mapped",
              at: now,
              targetId: missionId,
              message: "Mission mapped",
              data: {
                rootTaskId,
                taskCount: taskPlan.length,
                tasks: buildMissionMapTasks({
                  taskPlan,
                  taskIds: plannedTaskIds,
                  tasks,
                }),
              },
            },
          ]
        : []),
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

export function remapMissionGraph(graph: MissionGraph, input: RemapMissionGraphInput) {
  const valid = validateMissionTaskPlan(input.taskPlan)
  if (!valid.ok) return valid

  const now = (input.now ?? defaultClock)().toISOString()
  const taskIds = buildPlannedTaskIds(input.taskPlan, graph.mission.rootTaskId)
  let tasks = buildPlannedTasks({
    missionId: graph.mission.id,
    rootTaskId: graph.mission.rootTaskId,
    now,
    defaultCapabilities: [],
    taskPlan: input.taskPlan,
    taskIds,
  })

  if (input.preserveRootTaskState) {
    const previousRoot = graph.tasks[graph.mission.rootTaskId]
    const nextRoot = tasks[graph.mission.rootTaskId]
    if (previousRoot && nextRoot && !terminalStatuses.has(previousRoot.status)) {
      tasks = {
        ...tasks,
        [graph.mission.rootTaskId]: {
          ...nextRoot,
          status: previousRoot.status,
          assignedAgentId: previousRoot.assignedAgentId,
          createdAt: previousRoot.createdAt,
          updatedAt: now,
          lastHeartbeatAt: previousRoot.lastHeartbeatAt,
        },
      }
    }
  }

  return ok<MissionGraph>({
    mission: {
      ...graph.mission,
      updatedAt: now,
    },
    tasks,
    events: [
      ...graph.events,
      {
        id: input.eventId ?? defaultIdFactory("event"),
        type: "mission.mapped",
        at: now,
        targetId: graph.mission.id,
        message: "Mission plan refined",
        data: {
          rootTaskId: graph.mission.rootTaskId,
          taskCount: input.taskPlan.length,
          previousTaskCount: Object.keys(graph.tasks).length,
          tasks: buildMissionMapTasks({
            taskPlan: input.taskPlan,
            taskIds,
            tasks,
          }),
        },
      },
    ],
  })
}

export function taskDependenciesComplete(graph: MissionGraph, task: MissionTask): boolean {
  return (task.dependsOn ?? []).every((dependencyId) => graph.tasks[dependencyId]?.status === "complete")
}

export function validateMissionTaskPlan(taskPlan: MissionTaskPlanItem[]) {
  if (taskPlan.length === 0) {
    return err(runtimeError("INVALID_TRANSITION", "Mission task plan must contain at least one task"))
  }

  const keys = new Set<string>()
  for (const item of taskPlan) {
    const key = item.key.trim()
    if (!key) {
      return err(runtimeError("INVALID_TRANSITION", "Mission task plan contains an empty task key"))
    }
    if (keys.has(key)) {
      return err(runtimeError("INVALID_TRANSITION", "Mission task plan contains duplicate task keys", { key }))
    }
    if (!item.title.trim()) {
      return err(runtimeError("INVALID_TRANSITION", "Mission task plan contains an empty title", { key }))
    }
    if (!item.description.trim()) {
      return err(runtimeError("INVALID_TRANSITION", "Mission task plan contains an empty description", { key }))
    }
    keys.add(key)
  }

  for (const item of taskPlan) {
    for (const dependency of item.dependsOn ?? []) {
      if (dependency === item.key) {
        return err(runtimeError("INVALID_TRANSITION", "Mission task cannot depend on itself", { key: item.key }))
      }
      if (!keys.has(dependency)) {
        return err(runtimeError("INVALID_TRANSITION", "Mission task dependency does not exist", {
          key: item.key,
          dependency,
        }))
      }
    }
  }

  const cycle = findPlanCycle(taskPlan)
  if (cycle) {
    return err(runtimeError("INVALID_TRANSITION", "Mission task plan contains a dependency cycle", { cycle }))
  }

  return ok(undefined)
}

function buildPlannedTasks(input: {
  missionId: string
  rootTaskId: string
  now: string
  defaultCapabilities: string[]
  taskPlan: MissionTaskPlanItem[]
  taskIds: Map<string, string>
}): Record<string, MissionTask> {
  return Object.fromEntries(
    input.taskPlan.map((item, index) => {
      const id = input.taskIds.get(item.key)!
      const task: MissionTask = {
        id,
        missionId: input.missionId,
        parentId: index === 0 ? undefined : input.rootTaskId,
        title: item.title,
        description: item.description,
        status: "queued",
        requiredCapabilities: item.requiredCapabilities ?? input.defaultCapabilities,
        requiredEvidence: item.requiredEvidence ? [...item.requiredEvidence] : undefined,
        dependsOn: item.dependsOn?.map((dependencyKey) => input.taskIds.get(dependencyKey) ?? dependencyKey),
        createdAt: input.now,
        updatedAt: input.now,
      }

      return [id, task]
    }),
  )
}

function buildPlannedTaskIds(taskPlan: MissionTaskPlanItem[], rootTaskId: string): Map<string, string> {
  return new Map(
    taskPlan.map((item, index) => {
      return [item.key, index === 0 ? rootTaskId : `${rootTaskId}_${normalizePlanKey(item.key)}`]
    }),
  )
}

function buildMissionMapTasks(input: {
  taskPlan: MissionTaskPlanItem[]
  taskIds: Map<string, string>
  tasks: Record<string, MissionTask>
}): Array<Record<string, unknown>> {
  return input.taskPlan.map((item) => {
    const id = input.taskIds.get(item.key)!
    const task = input.tasks[id]!

    return {
      id,
      key: item.key,
      title: task.title,
      description: task.description,
      requiredCapabilities: [...task.requiredCapabilities],
      requiredEvidence: [...(task.requiredEvidence ?? [])],
      dependsOn: [...(task.dependsOn ?? [])],
    }
  })
}

function normalizePlanKey(key: string): string {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || "task"
}

function findPlanCycle(taskPlan: MissionTaskPlanItem[]): string[] | undefined {
  const dependencies = new Map(taskPlan.map((item) => [item.key, item.dependsOn ?? []]))
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const path: string[] = []

  const visit = (key: string): string[] | undefined => {
    if (visiting.has(key)) {
      return [...path.slice(path.indexOf(key)), key]
    }
    if (visited.has(key)) return undefined

    visiting.add(key)
    path.push(key)
    for (const dependency of dependencies.get(key) ?? []) {
      const cycle = visit(dependency)
      if (cycle) return cycle
    }
    path.pop()
    visiting.delete(key)
    visited.add(key)

    return undefined
  }

  for (const item of taskPlan) {
    const cycle = visit(item.key)
    if (cycle) return cycle
  }

  return undefined
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
