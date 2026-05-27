import { deriveMissionMap, type MissionMapTask } from "./mission-map.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { EvidenceType, TaskStatus } from "./types.js"

export type PlanContractStatus = "idle" | "thin" | "ready" | "blocked"

export type PlanContractSlice = {
  id: string
  key: string
  title: string
  status: TaskStatus
  ready: boolean
  requiredEvidence: EvidenceType[]
  dependsOn: string[]
}

export type PlanContract = {
  status: PlanContractStatus
  summary: string
  taskCount: number
  implementationTaskCount: number
  executionSlices: PlanContractSlice[]
  missing: string[]
  warnings: string[]
  missionId?: string
  goal?: string
}

export function derivePlanContract(snapshot: RuntimeSnapshot): PlanContract {
  const map = deriveMissionMap(snapshot)
  if (map.status === "idle") {
    return {
      status: "idle",
      summary: "No mission map is active for a Plan Contract.",
      taskCount: 0,
      implementationTaskCount: 0,
      executionSlices: [],
      missing: [],
      warnings: [],
    }
  }

  const planTasks = map.tasks.map((task) => resolvePlanTaskEvidence(task, snapshot))
  const executionSlices = planTasks.map(toSlice)
  const implementationSlices = planTasks.filter(isImplementationSlice)
  const missing = collectMissingPlanEvidence(planTasks)

  if (missing.length > 0) {
    const count = new Set(missing.map((item) => item.replace(/^required evidence for /, ""))).size

    return {
      status: "blocked",
      missionId: map.missionId,
      goal: map.goal,
      taskCount: map.taskCount,
      implementationTaskCount: implementationSlices.length,
      executionSlices,
      missing,
      warnings: [],
      summary: `Plan contract blocked for ${map.missionId}: ${count} mapped task${count === 1 ? "" : "s"} ${count === 1 ? "lacks" : "lack"} required evidence.`,
    }
  }

  if (isStageOnlyCovenantMap(planTasks)) {
    return {
      status: "thin",
      missionId: map.missionId,
      goal: map.goal,
      taskCount: map.taskCount,
      implementationTaskCount: implementationSlices.length,
      executionSlices,
      missing: ["concrete execution slices"],
      warnings: ["Break the Forge stage into focused implementation/proof slices before broad autonomous work."],
      summary: `Plan contract thin for ${map.missionId}: Forge/Review/Seal exists, but implementation has no concrete execution slices yet.`,
    }
  }

  return {
    status: "ready",
    missionId: map.missionId,
    goal: map.goal,
    taskCount: map.taskCount,
    implementationTaskCount: implementationSlices.length,
    executionSlices,
    missing: [],
    warnings: [],
    summary: `Plan contract ready for ${map.missionId}: ${implementationSlices.length} focused implementation slice${implementationSlices.length === 1 ? "" : "s"} ${implementationSlices.length === 1 ? "is" : "are"} mapped with proof evidence.`,
  }
}

export function buildPlanContractPrompt(snapshot: RuntimeSnapshot): string {
  const contract = derivePlanContract(snapshot)
  const slices = contract.executionSlices.length > 0
    ? contract.executionSlices.map((slice) => {
        return [
          `- ${slice.key} ${slice.id}: ${slice.title}`,
          `status: ${slice.status}`,
          `ready: ${slice.ready ? "yes" : "no"}`,
          `evidence: ${formatList(slice.requiredEvidence)}`,
          `depends on: ${formatList(slice.dependsOn)}`,
        ].join("; ")
      })
    : ["none"]

  return [
    "## Runesmith Plan Contract",
    `Status: ${contract.status}`,
    `Mission: ${contract.missionId ?? "none"}`,
    `Goal: ${contract.goal ?? "none"}`,
    `Tasks: ${contract.taskCount}`,
    `Implementation slices: ${contract.implementationTaskCount}`,
    `Summary: ${contract.summary}`,
    `Missing: ${formatList(contract.missing)}`,
    `Warnings: ${formatList(contract.warnings)}`,
    "Execution slices:",
    ...slices,
    "Directive: Treat the mission map as the engine-owned plan. If it is thin, decompose Forge into concrete proof-backed slices before broad autonomous work.",
  ].join("\n")
}

function toSlice(task: MissionMapTask): PlanContractSlice {
  return {
    id: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    ready: task.ready,
    requiredEvidence: [...task.requiredEvidence],
    dependsOn: [...task.dependsOn],
  }
}

function resolvePlanTaskEvidence(task: MissionMapTask, snapshot: RuntimeSnapshot): MissionMapTask {
  if (task.requiredEvidence.length > 0) return task

  const contract = task.assignedAgentId ? snapshot.contracts[task.assignedAgentId] : undefined
  if (!contract || contract.requiredEvidence.length === 0) return task

  return {
    ...task,
    requiredEvidence: [...contract.requiredEvidence],
  }
}

function collectMissingPlanEvidence(tasks: MissionMapTask[]): string[] {
  return tasks
    .filter((task) => task.requiredEvidence.length === 0)
    .map((task) => `required evidence for ${task.key}`)
}

function isImplementationSlice(task: MissionMapTask): boolean {
  const title = task.title.toLowerCase()

  return title.startsWith("forge:")
    || task.requiredEvidence.includes("file-change")
}

function isStageOnlyCovenantMap(tasks: MissionMapTask[]): boolean {
  if (tasks.length !== 3) return false

  const keys = new Set(tasks.map((task) => task.key))
  return keys.has("forge") && keys.has("review") && keys.has("seal")
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
