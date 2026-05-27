import {
  createRunicCovenant,
  deriveCovenantControlBrief,
  type CovenantRune,
  type CovenantStage,
  type RunicCovenant,
} from "./covenant.js"
import { derivePlanContract } from "./plan-contract.js"
import { deriveReviewLens } from "./review-lens.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { EvidenceType } from "./types.js"

export type LoopPulseStatus = "idle" | "active"
export type LoopPulseHealth = "clear" | "attention" | "critical"
export type LoopPulsePriority = "low" | "medium" | "high" | "critical"
export type LoopPulseActionId =
  | "wait-for-goal"
  | "recover-stale"
  | "resolve-blocker"
  | "resolve-risk"
  | "refine-plan"
  | "claim-task"
  | "continue-forge"
  | "capture-proof"
  | "repair-diagnostic"
  | "review-faultline"
  | "review-change"
  | "seal-mission"

export type LoopPulseAction = {
  id: LoopPulseActionId
  label: string
  priority: LoopPulsePriority
  reason: string
}

type DecisionGuardSignal = {
  stage: "review" | "seal"
  label: string
  reason: string
  findings: string[]
}

export type LoopPulsePlanStepStatus = "active" | "queued" | "blocked"

export type LoopPulsePlanStep = {
  id: string
  label: string
  status: LoopPulsePlanStepStatus
  instruction: string
  evidence: EvidenceType[]
  runes: string[]
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
  risks: string[]
  runes: CovenantRune[]
  blockers: string[]
  nextAction: LoopPulseAction
  executionPlan: LoopPulsePlanStep[]
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
      risks: [],
      runes: brief.runes,
      blockers: [],
      nextAction: {
        id: "wait-for-goal",
        label: "Wait for goal",
        priority: "low",
        reason: "Runesmith has no active mission in the runtime capsule.",
      },
      executionPlan: [
        {
          id: "wait-for-user-goal",
          label: "Wait for user goal",
          status: "active",
          instruction: "Wait for a concrete coding goal, then prepare or resume a mission before mutating files.",
          evidence: [],
          runes: runeNames(brief.runes),
        },
      ],
    }
  }

  const decisionGuard = deriveDecisionGuardSignal(brief, snapshot)
  const blockers = buildBlockers(brief.taskId, brief.taskStatus, brief.missingEvidence, brief.diagnostics, brief.risks, decisionGuard)
  const nextAction = selectNextAction(brief, snapshot, decisionGuard)

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
    risks: brief.risks,
    runes: brief.runes,
    blockers,
    nextAction,
    executionPlan: buildExecutionPlan(brief, nextAction),
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
  const risks = pulse.risks.length > 0 ? pulse.risks.join("; ") : "none"
  const blockers = pulse.blockers.length > 0 ? pulse.blockers.join("; ") : "none"
  const runes = pulse.runes.length > 0 ? pulse.runes.map((rune) => rune.name).join(", ") : "none"
  const missionLine = pulse.missionId ? `Mission: ${pulse.missionId}` : "Mission: none"
  const taskLine = pulse.taskId ? `Task: ${pulse.taskId} (${pulse.taskStatus ?? "unknown"})` : "Task: none"
  const planLines = pulse.executionPlan.length > 0
    ? pulse.executionPlan.map((step, index) => {
        const evidence = step.evidence.length > 0 ? step.evidence.join(", ") : "none"
        const stepRunes = step.runes.length > 0 ? step.runes.join(", ") : "none"
        return `${index + 1}. ${step.status} - ${step.label}: ${step.instruction} Evidence: ${evidence}. Runes: ${stepRunes}.`
      })
    : ["none"]

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
    `Risks: ${risks}`,
    `Blockers: ${blockers}`,
    `Active runes: ${runes}`,
    "Execution plan:",
    ...planLines,
  ].join("\n")
}

function buildBlockers(
  taskId: string | undefined,
  taskStatus: string | undefined,
  missingEvidence: EvidenceType[],
  diagnostics: string[],
  risks: string[],
  decisionGuard: DecisionGuardSignal | undefined,
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

  for (const risk of risks) {
    blockers.push(`risk: ${risk}`)
  }

  if (decisionGuard) {
    for (const finding of decisionGuard.findings) {
      blockers.push(`${decisionGuard.stage} guard: ${finding}`)
    }
  }

  if (missingEvidence.length > 0) {
    blockers.push(`missing evidence: ${missingEvidence.join(", ")}`)
  }

  return uniqueStrings(blockers)
}

function selectNextAction(
  brief: ReturnType<typeof deriveCovenantControlBrief>,
  snapshot: RuntimeSnapshot,
  decisionGuard: DecisionGuardSignal | undefined,
): LoopPulseAction {
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

  if (brief.risks.length > 0 && brief.missingEvidence.includes("decision")) {
    return {
      id: "resolve-risk",
      label: "Resolve risk",
      priority: "critical",
      reason: "Unresolved risk evidence requires an explicit later decision before completion.",
    }
  }

  if (decisionGuard) {
    return {
      id: "resolve-blocker",
      label: decisionGuard.label,
      priority: "critical",
      reason: decisionGuard.reason,
    }
  }

  if (shouldRefineThinPlan(brief, snapshot)) {
    return {
      id: "refine-plan",
      label: "Refine plan",
      priority: "high",
      reason: "Plan Contract is thin; convert Forge/Review/Seal into goal-aware proof-backed slices before broad implementation.",
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

  if (brief.stage.id === "faultline") {
    return {
      id: "review-faultline",
      label: "Review faultline",
      priority: "critical",
      reason: "Repeated failed proof attempts require architecture review before another repair.",
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

function buildExecutionPlan(
  brief: ReturnType<typeof deriveCovenantControlBrief>,
  nextAction: LoopPulseAction,
): LoopPulsePlanStep[] {
  if (nextAction.id === "recover-stale") {
    return [
      {
        id: "reclaim-stale-task",
        label: "Reclaim stale task",
        status: "active",
        instruction: "Run recovery, requeue dependency-ready stale work, and claim a fresh lease.",
        evidence: ["diagnostic"],
        runes: selectPlanRunes(brief.runes, ["Recovery Loom"]),
      },
      {
        id: "resume-recovered-work",
        label: "Resume recovered work",
        status: "queued",
        instruction: "Continue the recovered task under the new lease before unrelated edits.",
        evidence: brief.missingEvidence,
        runes: selectPlanRunes(brief.runes, ["Forge Trace", "Proofwright"]),
      },
    ]
  }

  if (nextAction.id === "resolve-blocker") {
    return [
      {
        id: "identify-blocker",
        label: "Identify blocker",
        status: "active",
        instruction: "Read the blocker and existing evidence before taking new action.",
        evidence: ["diagnostic", "risk"],
        runes: runeNames(brief.runes),
      },
      {
        id: "clear-or-hold-blocker",
        label: "Clear or hold blocker",
        status: "blocked",
        instruction: "Attach explicit evidence for the unblock path, or hold for user input when recovery is unsafe.",
        evidence: brief.missingEvidence,
        runes: selectPlanRunes(brief.runes, ["Recovery Loom", "Proofwright"]),
      },
    ]
  }

  if (nextAction.id === "resolve-risk") {
    const latestRisk = brief.risks[brief.risks.length - 1] ?? "the latest risk"

    return [
      {
        id: "inspect-risk",
        label: "Inspect risk",
        status: "active",
        instruction: `Review this unresolved risk before completion: ${latestRisk}.`,
        evidence: ["risk"],
        runes: selectPlanRunes(brief.runes, ["Mirrorglass"]),
      },
      {
        id: "clear-or-hold-risk",
        label: "Clear or hold risk",
        status: "blocked",
        instruction: "Attach a decision that explicitly clears, accepts, or holds the risk before completion.",
        evidence: ["decision"],
        runes: selectPlanRunes(brief.runes, ["Mirrorglass", "Sealmark"]),
      },
    ]
  }

  if (nextAction.id === "refine-plan") {
    return [
      {
        id: "refine-thin-plan",
        label: "Refine thin Plan Contract",
        status: "active",
        instruction: "Replace the thin Forge/Review/Seal map with goal-aware proof-backed execution slices.",
        evidence: ["decision"],
        runes: ["Pathfinder", "Proofwright"],
      },
      {
        id: "dispatch-implementation-slices",
        label: "Dispatch implementation slices",
        status: "queued",
        instruction: "Claim independent goal-matched Forge slices through Dispatch Matrix.",
        evidence: ["file-change", "test-result"],
        runes: ["Claim Ward", "Forge Trace"],
      },
      {
        id: "review-refined-contract",
        label: "Review refined contract",
        status: "blocked",
        instruction: "Review proof, risk, and install handoff after implementation slices attach evidence.",
        evidence: ["decision"],
        runes: ["Mirrorglass", "Sealmark"],
      },
    ]
  }

  if (nextAction.id === "claim-task") {
    return [
      {
        id: "claim-ready-task",
        label: "Claim ready task",
        status: "active",
        instruction: "Claim dependency-ready work with the matching contract and stable idempotency key.",
        evidence: [],
        runes: selectPlanRunes(brief.runes, ["Claim Ward"]),
      },
    ]
  }

  if (nextAction.id === "continue-forge") {
    return [
      {
        id: "inspect-scoped-surface",
        label: "Inspect scoped surface",
        status: "active",
        instruction: "Read the smallest relevant repo surface for the active task before editing.",
        evidence: ["command-output"],
        runes: selectPlanRunes(brief.runes, ["Pathfinder", "Forge Trace"]),
      },
      {
        id: "make-scoped-change",
        label: "Make scoped change",
        status: "queued",
        instruction: "Apply the smallest useful change and let tool hooks capture file-change evidence.",
        evidence: ["file-change"],
        runes: selectPlanRunes(brief.runes, ["Forge Trace"]),
      },
      {
        id: "run-targeted-verification",
        label: "Run targeted verification",
        status: "blocked",
        instruction: "Run targeted verification once the implementation change exists.",
        evidence: ["test-result"],
        runes: selectPlanRunes(brief.runes, ["Proofwright"]),
      },
    ]
  }

  if (nextAction.id === "capture-proof") {
    return [
      {
        id: "run-targeted-verification",
        label: "Run targeted verification",
        status: "active",
        instruction: "Run the strongest practical verification for the active change and capture passing proof.",
        evidence: ["test-result"],
        runes: selectPlanRunes(brief.runes, ["Proofwright"]),
      },
      {
        id: "advance-evidence-gate",
        label: "Advance evidence gate",
        status: "queued",
        instruction: "Let the autopilot tick complete the task once required evidence is attached.",
        evidence: [],
        runes: selectPlanRunes(brief.runes, ["Proofwright"]),
      },
    ]
  }

  if (nextAction.id === "repair-diagnostic") {
    const latestDiagnostic = brief.diagnostics[brief.diagnostics.length - 1] ?? "the latest diagnostic"

    return [
      {
        id: "acknowledge-diagnostic",
        label: "Acknowledge diagnostic",
        status: "active",
        instruction: `Treat this diagnostic as the active repair target: ${latestDiagnostic}.`,
        evidence: ["diagnostic"],
        runes: selectPlanRunes(brief.runes, ["Faultwright"]),
      },
      {
        id: "repair-smallest-cause",
        label: "Hypothesis repair",
        status: "queued",
        instruction: "State a falsifiable repair hypothesis, change one repair variable, and link the edit to the active diagnostic.",
        evidence: ["file-change"],
        runes: selectPlanRunes(brief.runes, ["Faultwright"]),
      },
      {
        id: "rerun-failing-command",
        label: "Rerun failing command",
        status: "blocked",
        instruction: "Rerun the exact failing verification command and attach passing test-result evidence.",
        evidence: ["test-result"],
        runes: selectPlanRunes(brief.runes, ["Proofwright"]),
      },
    ]
  }

  if (nextAction.id === "review-faultline") {
    return [
      {
        id: "summarize-failed-repairs",
        label: "Summarize failed repairs",
        status: "active",
        instruction: "Compare the last three diagnostics and the repair edits between them before another patch.",
        evidence: ["diagnostic"],
        runes: selectPlanRunes(brief.runes, ["Faultline"]),
      },
      {
        id: "question-architecture",
        label: "Question architecture",
        status: "queued",
        instruction: "Name the assumption, interface, dependency, or test contract that could make local patches ineffective.",
        evidence: ["risk"],
        runes: selectPlanRunes(brief.runes, ["Faultline", "Mirrorglass"]),
      },
      {
        id: "choose-breakthrough-path",
        label: "Choose breakthrough path",
        status: "blocked",
        instruction: "Choose a redesign, revert, scope split, or new falsifiable hypothesis before proof is retried.",
        evidence: ["decision"],
        runes: selectPlanRunes(brief.runes, ["Faultline", "Proofwright"]),
      },
    ]
  }

  if (nextAction.id === "seal-mission") {
    return [
      {
        id: "seal-checkpoint",
        label: "Seal checkpoint",
        status: "active",
        instruction: "Record a final checkpoint decision and keep the runtime capsule current.",
        evidence: ["decision"],
        runes: selectPlanRunes(brief.runes, ["Sealmark"]),
      },
    ]
  }

  return [
    {
      id: "review-diff-and-behavior",
      label: "Review diff and behavior",
      status: "active",
      instruction: "Inspect the diff and runtime behavior for gaps before completion.",
      evidence: ["decision"],
      runes: selectPlanRunes(brief.runes, ["Mirrorglass"]),
    },
    {
      id: "seal-after-review",
      label: "Seal after review",
      status: "queued",
      instruction: "Seal a checkpoint after review finds no blocking gap.",
      evidence: ["decision"],
      runes: selectPlanRunes(brief.runes, ["Sealmark"]),
    },
  ]
}

function selectPlanRunes(runes: CovenantRune[], names: string[]): string[] {
  const selected = runes.map((rune) => rune.name).filter((name) => names.includes(name))
  return selected.length > 0 ? selected : names
}

function runeNames(runes: CovenantRune[]): string[] {
  return runes.map((rune) => rune.name)
}

function shouldRefineThinPlan(
  brief: ReturnType<typeof deriveCovenantControlBrief>,
  snapshot: RuntimeSnapshot,
): boolean {
  if (!brief.missionId) return false
  if (missionHasEvidence(snapshot, brief.missionId)) return false

  const contract = derivePlanContract(snapshot)
  return contract.status === "thin" && contract.missionId === brief.missionId
}

function missionHasEvidence(snapshot: RuntimeSnapshot, missionId: string): boolean {
  return Object.keys(snapshot.ledgers[missionId]?.evidence ?? {}).length > 0
}

function deriveDecisionGuardSignal(
  brief: ReturnType<typeof deriveCovenantControlBrief>,
  snapshot: RuntimeSnapshot,
): DecisionGuardSignal | undefined {
  if (!brief.missingEvidence.includes("decision")) return undefined

  const taskTitle = brief.taskTitle?.toLowerCase() ?? ""
  if (taskTitle.startsWith("review:")) {
    const lens = deriveReviewLens(snapshot)
    const blockingChecks = lens.checklist.filter((check) => check.status === "blocked" && check.id !== "review-decision")
    const criticalFindings = lens.findings.filter((finding) => finding.severity === "critical")
    if (lens.status === "ready" && blockingChecks.length === 0 && criticalFindings.length === 0) return undefined

    const findings = uniqueStrings([
      ...criticalFindings.map((finding) => finding.summary),
      ...blockingChecks.map((check) => check.detail),
    ])

    return {
      stage: "review",
      label: "Resolve review guard",
      reason: `Review Lens blocked: ${lens.nextAction}`,
      findings: findings.length > 0 ? findings : [lens.summary],
    }
  }

  if (taskTitle.startsWith("seal:") || brief.stage.id === "seal") {
    const lens = deriveReviewLens(snapshot)
    const blockingChecks = lens.checklist.filter((check) => check.status === "blocked" && check.id !== "review-decision")
    const criticalFindings = lens.findings.filter((finding) => finding.severity === "critical")
    if ((lens.status === "ready" || lens.status === "approved") && blockingChecks.length === 0 && criticalFindings.length === 0) return undefined

    const findings = uniqueStrings([
      ...criticalFindings.map((finding) => finding.summary),
      ...blockingChecks.map((check) => check.detail),
    ])

    return {
      stage: "seal",
      label: "Resolve seal guard",
      reason: `Seal Audit blocked: ${lens.nextAction}`,
      findings: findings.length > 0 ? findings : [lens.summary],
    }
  }

  return undefined
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))]
}
