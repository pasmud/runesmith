import {
  createRunicCovenant,
  deriveCovenantControlBrief,
  type CovenantRune,
  type CovenantStage,
  type RunicCovenant,
} from "./covenant"
import type { RuntimeSnapshot } from "./runtime"
import type { EvidenceType } from "./types"

export type LoopPulseStatus = "idle" | "active"
export type LoopPulseHealth = "clear" | "attention" | "critical"
export type LoopPulsePriority = "low" | "medium" | "high" | "critical"
export type LoopPulseActionId =
  | "wait-for-goal"
  | "recover-stale"
  | "resolve-blocker"
  | "claim-task"
  | "continue-forge"
  | "capture-proof"
  | "repair-diagnostic"
  | "review-change"
  | "seal-mission"

export type LoopPulseAction = {
  id: LoopPulseActionId
  label: string
  priority: LoopPulsePriority
  reason: string
}

export type LoopPulse = {
  status: LoopPulseStatus
  health: LoopPulseHealth
  summary: string
  stage: CovenantStage
  missionId?: string
  taskId?: string
  taskStatus?: string
  requiredEvidence: EvidenceType[]
  missingEvidence: EvidenceType[]
  diagnostics: string[]
  runes: CovenantRune[]
  blockers: string[]
  nextAction: LoopPulseAction
}

export function deriveLoopPulse(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant = createRunicCovenant(),
): LoopPulse {
  const brief = deriveCovenantControlBrief(snapshot, covenant)

  if (brief.status === "idle") {
    return {
      status: "idle",
      health: "clear",
      summary: "No active mission is waiting for orchestration.",
      stage: brief.stage,
      requiredEvidence: [],
      missingEvidence: [],
      diagnostics: [],
      runes: brief.runes,
      blockers: [],
      nextAction: {
        id: "wait-for-goal",
        label: "Wait for goal",
        priority: "low",
        reason: "Runesmith has no active mission in the runtime capsule.",
      },
    }
  }

  const blockers = buildBlockers(brief.taskId, brief.taskStatus, brief.missingEvidence, brief.diagnostics)
  const nextAction = selectNextAction(brief)

  return {
    status: "active",
    health: selectHealth(nextAction, blockers, brief.missingEvidence),
    summary: `${nextAction.label} for ${brief.taskId ?? "the active task"}.`,
    stage: brief.stage,
    missionId: brief.missionId,
    taskId: brief.taskId,
    taskStatus: brief.taskStatus,
    requiredEvidence: brief.requiredEvidence,
    missingEvidence: brief.missingEvidence,
    diagnostics: brief.diagnostics,
    runes: brief.runes,
    blockers,
    nextAction,
  }
}

export function buildLoopPulsePrompt(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant = createRunicCovenant(),
): string {
  const pulse = deriveLoopPulse(snapshot, covenant)
  const requiredEvidence = pulse.requiredEvidence.length > 0 ? pulse.requiredEvidence.join(", ") : "none"
  const missingEvidence = pulse.missingEvidence.length > 0 ? pulse.missingEvidence.join(", ") : "none"
  const diagnostics = pulse.diagnostics.length > 0 ? pulse.diagnostics.join("; ") : "none"
  const blockers = pulse.blockers.length > 0 ? pulse.blockers.join("; ") : "none"
  const runes = pulse.runes.length > 0 ? pulse.runes.map((rune) => rune.name).join(", ") : "none"
  const missionLine = pulse.missionId ? `Mission: ${pulse.missionId}` : "Mission: none"
  const taskLine = pulse.taskId ? `Task: ${pulse.taskId} (${pulse.taskStatus ?? "unknown"})` : "Task: none"

  return [
    "## Runesmith Loop Pulse",
    `Status: ${pulse.status}`,
    `Health: ${pulse.health}`,
    `Next action: ${pulse.nextAction.label}`,
    `Priority: ${pulse.nextAction.priority}`,
    `Reason: ${pulse.nextAction.reason}`,
    missionLine,
    taskLine,
    `Required evidence: ${requiredEvidence}`,
    `Missing evidence: ${missingEvidence}`,
    `Diagnostics: ${diagnostics}`,
    `Blockers: ${blockers}`,
    `Active runes: ${runes}`,
  ].join("\n")
}

function buildBlockers(
  taskId: string | undefined,
  taskStatus: string | undefined,
  missingEvidence: EvidenceType[],
  diagnostics: string[],
): string[] {
  const blockers: string[] = []

  if (taskId && taskStatus === "stale") {
    blockers.push(`${taskId} is stale`)
  }

  if (taskId && taskStatus === "blocked") {
    blockers.push(`${taskId} is blocked`)
  }

  for (const diagnostic of diagnostics) {
    blockers.push(`diagnostic: ${diagnostic}`)
  }

  if (missingEvidence.length > 0) {
    blockers.push(`missing evidence: ${missingEvidence.join(", ")}`)
  }

  return blockers
}

function selectNextAction(brief: ReturnType<typeof deriveCovenantControlBrief>): LoopPulseAction {
  if (brief.taskStatus === "stale") {
    return {
      id: "recover-stale",
      label: "Recover stale work",
      priority: "critical",
      reason: "The active task missed its heartbeat and must be reclaimed before unrelated work continues.",
    }
  }

  if (brief.taskStatus === "blocked") {
    return {
      id: "resolve-blocker",
      label: "Resolve blocker",
      priority: "critical",
      reason: "The active task is blocked and needs explicit evidence, recovery, or user input.",
    }
  }

  if (brief.stage.id === "claim") {
    return {
      id: "claim-task",
      label: "Claim task",
      priority: "high",
      reason: "Dependency-ready work needs a contract-backed lease before execution.",
    }
  }

  if (brief.stage.id === "forge") {
    return {
      id: "continue-forge",
      label: "Continue forge",
      priority: "high",
      reason: "Implementation evidence is still missing for the active task.",
    }
  }

  if (brief.stage.id === "prove") {
    return {
      id: "capture-proof",
      label: "Capture proof",
      priority: "high",
      reason: "The active task cannot complete until missing verification evidence is captured.",
    }
  }

  if (brief.stage.id === "repair") {
    return {
      id: "repair-diagnostic",
      label: "Repair diagnostic",
      priority: "high",
      reason: "Failed verification must be repaired before proof can satisfy the active task.",
    }
  }

  if (brief.stage.id === "seal" || brief.taskTitle?.toLowerCase().startsWith("seal:")) {
    return {
      id: "seal-mission",
      label: "Seal mission",
      priority: "medium",
      reason: "Proof and review are ready for a durable checkpoint.",
    }
  }

  return {
    id: "review-change",
    label: "Review change",
    priority: "medium",
    reason: "Required evidence is present; review the diff and runtime behavior before sealing.",
  }
}

function selectHealth(
  nextAction: LoopPulseAction,
  blockers: string[],
  missingEvidence: EvidenceType[],
): LoopPulseHealth {
  if (nextAction.priority === "critical") return "critical"
  if (blockers.length > 0 || missingEvidence.length > 0) return "attention"

  return "clear"
}
