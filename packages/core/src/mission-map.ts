import type { RuntimeSnapshot } from "./runtime.js"
import type { EvidenceType, MissionEvent, MissionGraph, MissionTask, TaskStatus } from "./types.js"

export type MissionMapStatus = "idle" | "mapped"

export type MissionMapTask = {
  id: string
  key: string
  title: string
  description: string
  status: TaskStatus
  ready: boolean
  requiredCapabilities: string[]
  requiredEvidence: EvidenceType[]
  dependsOn: string[]
  blockedBy: string[]
  assignedAgentId?: string
}

export type MissionMap = {
  status: MissionMapStatus
  summary: string
  taskCount: number
  tasks: MissionMapTask[]
  missionId?: string
  goal?: string
  rootTaskId?: string
  nextTaskId?: string
}

type MissionMapSeed = {
  id: string
  key: string
  title?: string
  description?: string
  requiredCapabilities?: string[]
  requiredEvidence?: EvidenceType[]
  dependsOn?: string[]
}

export function deriveMissionMap(snapshot: RuntimeSnapshot): MissionMap {
  const graph = selectMissionGraph(snapshot)
  if (!graph) {
    return {
      status: "idle",
      summary: "No mission map is active in the runtime capsule.",
      taskCount: 0,
      tasks: [],
    }
  }

  const seeds = readMissionMapSeeds(graph)
  const mapTasks = (seeds.length > 0 ? seeds : buildFallbackSeeds(graph)).flatMap((seed) => {
    const task = graph.tasks[seed.id]
    if (!task) return []

    return [buildMissionMapTask(graph, task, seed)]
  })
  const nextTask = selectNextMapTask(mapTasks)

  return {
    status: "mapped",
    summary: `${graph.mission.id} maps ${mapTasks.length} tasks for ${graph.mission.goal}. Next task: ${nextTask?.id ?? "none"}.`,
    missionId: graph.mission.id,
    goal: graph.mission.goal,
    rootTaskId: graph.mission.rootTaskId,
    nextTaskId: nextTask?.id,
    taskCount: mapTasks.length,
    tasks: mapTasks,
  }
}

export function buildMissionMapPrompt(snapshot: RuntimeSnapshot): string {
  const map = deriveMissionMap(snapshot)
  const taskLines = map.tasks.length > 0
    ? map.tasks.map((task) => {
        return [
          `- ${task.status} ${task.key} ${task.id}: ${task.title}`,
          `ready: ${task.ready ? "yes" : "no"}`,
          `depends on: ${formatList(task.dependsOn)}`,
          `blocked by: ${formatList(task.blockedBy)}`,
          `required evidence: ${formatList(task.requiredEvidence)}`,
        ].join("; ")
      })
    : ["none"]

  return [
    "## Runesmith Mission Map",
    `Status: ${map.status}`,
    `Mission: ${map.missionId ?? "none"}`,
    `Goal: ${map.goal ?? "none"}`,
    `Root task: ${map.rootTaskId ?? "none"}`,
    `Next task: ${map.nextTaskId ?? "none"}`,
    `Summary: ${map.summary}`,
    "Tasks:",
    ...taskLines,
    "Directive: Use this map as the execution plan. Do not ask the user to load workflows or choose stages manually.",
  ].join("\n")
}

function selectMissionGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
  return Object.values(snapshot.graphs).sort((left, right) => {
    const leftRank = isTerminalMission(left) ? 1 : 0
    const rightRank = isTerminalMission(right) ? 1 : 0

    return leftRank - rightRank || right.mission.updatedAt.localeCompare(left.mission.updatedAt) || left.mission.id.localeCompare(right.mission.id)
  })[0]
}

function readMissionMapSeeds(graph: MissionGraph): MissionMapSeed[] {
  const event = [...graph.events].reverse().find((candidate) => candidate.type === "mission.mapped")
  const tasks = event ? readEventTasks(event) : []

  return tasks.flatMap((task) => {
    const id = stringValue(task.id)
    if (!id) return []

    return [
      {
        id,
        key: stringValue(task.key) ?? deriveFallbackKey(graph, id),
        title: stringValue(task.title),
        description: stringValue(task.description),
        requiredCapabilities: stringArray(task.requiredCapabilities),
        requiredEvidence: evidenceArray(task.requiredEvidence),
        dependsOn: stringArray(task.dependsOn),
      },
    ]
  })
}

function readEventTasks(event: MissionEvent): Array<Record<string, unknown>> {
  const tasks = event.data?.tasks
  if (!Array.isArray(tasks)) return []

  return tasks.filter(isRecord)
}

function buildFallbackSeeds(graph: MissionGraph): MissionMapSeed[] {
  return Object.values(graph.tasks)
    .sort((left, right) => {
      if (left.id === graph.mission.rootTaskId) return -1
      if (right.id === graph.mission.rootTaskId) return 1

      return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
    })
    .map((task) => ({
      id: task.id,
      key: deriveFallbackKey(graph, task.id),
    }))
}

function buildMissionMapTask(
  graph: MissionGraph,
  task: MissionTask,
  seed: MissionMapSeed,
): MissionMapTask {
  const dependsOn = seed.dependsOn ?? task.dependsOn ?? []
  const blockedBy = dependsOn.filter((dependencyId) => graph.tasks[dependencyId]?.status !== "complete")

  return {
    id: task.id,
    key: seed.key,
    title: seed.title ?? task.title,
    description: seed.description ?? task.description,
    status: task.status,
    ready: task.status === "queued" && blockedBy.length === 0,
    requiredCapabilities: seed.requiredCapabilities ?? task.requiredCapabilities,
    requiredEvidence: seed.requiredEvidence ?? task.requiredEvidence ?? [],
    dependsOn,
    blockedBy,
    assignedAgentId: task.assignedAgentId,
  }
}

function selectNextMapTask(tasks: MissionMapTask[]): MissionMapTask | undefined {
  return tasks.find((task) => ["running", "stale", "blocked", "verifying"].includes(task.status))
    ?? tasks.find((task) => task.ready)
    ?? tasks.find((task) => task.status !== "complete")
}

function deriveFallbackKey(graph: MissionGraph, taskId: string): string {
  if (taskId === graph.mission.rootTaskId) return "root"

  return taskId.startsWith(`${graph.mission.rootTaskId}_`)
    ? taskId.slice(graph.mission.rootTaskId.length + 1)
    : taskId
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined

  return value.filter((item): item is string => typeof item === "string")
}

function evidenceArray(value: unknown): EvidenceType[] | undefined {
  const values = stringArray(value)
  if (!values) return undefined

  return values.filter(isEvidenceType)
}

function isEvidenceType(value: string): value is EvidenceType {
  return ["file-change", "command-output", "test-result", "diagnostic", "decision", "risk"].includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
