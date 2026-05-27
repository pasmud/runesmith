import { createRunicCovenant, type RunicCovenant } from "./covenant.js"
import { getRequiredEvidenceForTask } from "./contracts.js"
import { missingRequiredEvidence } from "./evidence-ledger.js"
import { deriveLoopPulse, type LoopPulse, type LoopPulseAction, type LoopPulsePlanStep } from "./loop-pulse.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, EvidenceType, MissionGraph, MissionTask, TaskStatus } from "./types.js"

export type MissionMemoryStatus =
  | "idle"
  | "active"
  | "blocked"
  | "needs-proof"
  | "needs-repair"
  | "needs-recovery"
  | "sealed"

export type MissionMemoryProofStatus = "clear" | "missing" | "present"

export type MissionMemoryTask = {
  id: string
  title: string
  status: TaskStatus
}

export type MissionMemoryProof = {
  status: MissionMemoryProofStatus
  required: EvidenceType[]
  missing: EvidenceType[]
  passing: string[]
}

export type MissionMemory = {
  status: MissionMemoryStatus
  summary: string
  handoff: string
  missionId?: string
  goal?: string
  activeTask?: MissionMemoryTask
  openTasks: number
  completedTasks: number
  proof: MissionMemoryProof
  latestChanges: string[]
  latestDiagnostics: string[]
  latestDecisions: string[]
  nextAction: LoopPulseAction
  executionPlan: LoopPulsePlanStep[]
  runes: string[]
}

export function deriveMissionMemory(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant = createRunicCovenant(),
): MissionMemory {
  const pulse = deriveLoopPulse(snapshot, covenant)
  const selected = selectMemoryTarget(snapshot, pulse)

  if (!selected) {
    return {
      status: "idle",
      summary: "No mission is active in the runtime capsule.",
      handoff: "No active mission is waiting. Start a mission from the next coding goal.",
      openTasks: 0,
      completedTasks: 0,
      proof: {
        status: "clear",
        required: [],
        missing: [],
        passing: [],
      },
      latestChanges: [],
      latestDiagnostics: [],
      latestDecisions: [],
      nextAction: pulse.nextAction,
      executionPlan: pulse.executionPlan,
      runes: pulse.runes.map((rune) => rune.name),
    }
  }

  const ledger = snapshot.ledgers[selected.graph.mission.id] ?? { evidence: {} }
  const allEvidence = sortEvidenceNewest(Object.values(ledger.evidence))
  const taskEvidence = selected.task
    ? sortEvidenceNewest(allEvidence.filter((entry) => entry.taskId === selected.task?.id))
    : allEvidence
  const required = getRequiredEvidence(snapshot, selected.task, pulse, selected.graph.mission.id)
  const missing = getMissingEvidence(ledger, selected.task, pulse, selected.graph.mission.id, required)
  const passing = allEvidence.filter(isPassingTestResultEvidence).map((entry) => entry.summary).slice(0, 3)
  const proof = {
    status: selectProofStatus(required, missing),
    required,
    missing,
    passing,
  } satisfies MissionMemoryProof
  const latestChanges = evidenceSummaries(taskEvidence, "file-change")
  const latestDiagnostics = evidenceSummaries(taskEvidence, "diagnostic")
  const latestDecisions = evidenceSummaries(allEvidence, "decision")
  const status = selectMemoryStatus(selected.graph, pulse, missing)
  const activeTask = selected.task
    ? {
        id: selected.task.id,
        title: selected.task.title,
        status: selected.task.status,
      }
    : undefined

  return {
    status,
    summary: buildSummary(status, selected.graph, selected.task),
    handoff: buildHandoff({
      status,
      graph: selected.graph,
      task: selected.task,
      pulse,
      missing,
      latestDiagnostics,
      latestDecisions,
    }),
    missionId: selected.graph.mission.id,
    goal: selected.graph.mission.goal,
    activeTask,
    openTasks: Object.values(selected.graph.tasks).filter((task) => task.status !== "complete").length,
    completedTasks: Object.values(selected.graph.tasks).filter((task) => task.status === "complete").length,
    proof,
    latestChanges,
    latestDiagnostics,
    latestDecisions,
    nextAction: pulse.nextAction,
    executionPlan: pulse.executionPlan,
    runes: pulse.runes.map((rune) => rune.name),
  }
}

export function buildMissionMemoryPrompt(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant = createRunicCovenant(),
): string {
  const memory = deriveMissionMemory(snapshot, covenant)
  const proofLine = memory.proof.status === "missing"
    ? `missing ${formatList(memory.proof.missing)}`
    : memory.proof.status
  const activeTask = memory.activeTask
    ? `${memory.activeTask.id} ${memory.activeTask.title} (${memory.activeTask.status})`
    : "none"
  const planLines = memory.executionPlan.length > 0
    ? memory.executionPlan.map((step, index) => `${index + 1}. ${step.status} - ${step.label}: ${step.instruction}`)
    : ["none"]

  return [
    "## Runesmith Mission Memory",
    `Status: ${memory.status}`,
    `Mission: ${memory.missionId ?? "none"}`,
    `Goal: ${memory.goal ?? "none"}`,
    `Active task: ${activeTask}`,
    `Handoff: ${memory.handoff}`,
    `Proof: ${proofLine}`,
    `Required evidence: ${formatList(memory.proof.required)}`,
    `Missing evidence: ${formatList(memory.proof.missing)}`,
    `Passing proof: ${formatList(memory.proof.passing)}`,
    `Latest changes: ${formatList(memory.latestChanges)}`,
    `Latest diagnostics: ${formatList(memory.latestDiagnostics)}`,
    `Latest decisions: ${formatList(memory.latestDecisions)}`,
    "Execution plan:",
    ...planLines,
  ].join("\n")
}

function selectMemoryTarget(
  snapshot: RuntimeSnapshot,
  pulse: LoopPulse,
): { graph: MissionGraph; task?: MissionTask } | undefined {
  const graph = pulse.missionId
    ? snapshot.graphs[pulse.missionId]
    : selectLatestGraph(snapshot)
  if (!graph) return undefined

  const task = pulse.taskId && graph.tasks[pulse.taskId]
    ? graph.tasks[pulse.taskId]
    : selectMemoryTask(graph)

  return { graph, task }
}

function selectLatestGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
  return Object.values(snapshot.graphs).sort((left, right) => {
    const leftRank = isTerminalMission(left) ? 1 : 0
    const rightRank = isTerminalMission(right) ? 1 : 0

    return leftRank - rightRank || right.mission.updatedAt.localeCompare(left.mission.updatedAt) || left.mission.id.localeCompare(right.mission.id)
  })[0]
}

function selectMemoryTask(graph: MissionGraph): MissionTask | undefined {
  const tasks = Object.values(graph.tasks)
  return tasks.find((task) => ["running", "stale", "blocked", "verifying"].includes(task.status))
    ?? tasks.find((task) => task.status === "queued")
    ?? graph.tasks[graph.mission.rootTaskId]
    ?? tasks[0]
}

function getRequiredEvidence(
  snapshot: RuntimeSnapshot,
  task: MissionTask | undefined,
  pulse: LoopPulse,
  missionId: string,
): EvidenceType[] {
  if (pulse.missionId === missionId && pulse.requiredEvidence.length > 0) return pulse.requiredEvidence
  if (!task) return []

  const contract = task.assignedAgentId ? snapshot.contracts[task.assignedAgentId] : undefined
  if (contract) return getRequiredEvidenceForTask(task, contract)

  return task.requiredEvidence ?? []
}

function getMissingEvidence(
  ledger: { evidence: Record<string, Evidence> },
  task: MissionTask | undefined,
  pulse: LoopPulse,
  missionId: string,
  required: EvidenceType[],
): EvidenceType[] {
  if (pulse.missionId === missionId) return pulse.missingEvidence
  if (!task || required.length === 0) return []

  return missingRequiredEvidence(ledger, {
    taskId: task.id,
    requiredEvidence: required,
  })
}

function selectMemoryStatus(
  graph: MissionGraph,
  pulse: LoopPulse,
  missing: EvidenceType[],
): MissionMemoryStatus {
  if (graph.mission.status === "complete") return "sealed"
  if (pulse.nextAction.id === "recover-stale") return "needs-recovery"
  if (pulse.nextAction.id === "resolve-blocker") return "blocked"
  if (pulse.nextAction.id === "resolve-risk") return "blocked"
  if (pulse.nextAction.id === "repair-diagnostic") return "needs-repair"
  if (missing.length > 0) return "needs-proof"

  return "active"
}

function selectProofStatus(required: EvidenceType[], missing: EvidenceType[]): MissionMemoryProofStatus {
  if (required.length === 0) return "clear"
  if (missing.length > 0) return "missing"

  return "present"
}

function buildSummary(
  status: MissionMemoryStatus,
  graph: MissionGraph,
  task: MissionTask | undefined,
): string {
  if (status === "sealed") return `${graph.mission.id} is sealed.`
  if (!task) return `${graph.mission.id} has no selected task.`

  return `${status} on ${task.id}: ${task.title}.`
}

function buildHandoff(input: {
  status: MissionMemoryStatus
  graph: MissionGraph
  task: MissionTask | undefined
  pulse: LoopPulse
  missing: EvidenceType[]
  latestDiagnostics: string[]
  latestDecisions: string[]
}): string {
  const taskId = input.task?.id ?? input.graph.mission.rootTaskId

  if (input.status === "sealed") {
    const decisionCount = input.latestDecisions.length
    const decisionRecord = decisionCount === 1 ? "decision record" : "decision records"

    return `Mission ${input.graph.mission.id} is sealed with passing proof and ${decisionCount} ${decisionRecord}.`
  }

  if (input.status === "needs-repair") {
    const diagnostic = input.latestDiagnostics[0] ?? input.pulse.diagnostics[0] ?? input.pulse.nextAction.reason

    return `Repair ${taskId}: ${diagnostic}. State a falsifiable hypothesis, change one repair variable, then rerun proof.`
  }

  if (input.status === "needs-recovery") {
    return `Recover ${taskId}: ${input.pulse.nextAction.reason}`
  }

  if (input.status === "blocked") {
    const label = input.pulse.nextAction.id === "resolve-risk" ? "Resolve risk" : "Resolve blocker"

    return `${label} for ${taskId}: ${input.pulse.nextAction.reason}`
  }

  if (input.status === "needs-proof") {
    return `Capture proof for ${taskId}: record ${formatList(input.missing)} evidence before completion.`
  }

  return `Continue ${taskId} with ${input.pulse.nextAction.label}: ${input.pulse.nextAction.reason}`
}

function evidenceSummaries(evidence: Evidence[], type: EvidenceType): string[] {
  return evidence.filter((entry) => entry.type === type).map((entry) => entry.summary).slice(0, 3)
}

function sortEvidenceNewest(evidence: Evidence[]): Evidence[] {
  return [...evidence].sort((left, right) => {
    return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
  })
}

function isPassingTestResultEvidence(evidence: Evidence): boolean {
  if (evidence.type !== "test-result") return false

  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode === 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
