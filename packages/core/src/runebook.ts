import { createRunicCovenant, type RunicCovenant } from "./covenant.js"
import { deriveLoopPulse, type LoopPulseActionId } from "./loop-pulse.js"
import { deriveProofPlan, type ProofPlanCommand, type ProofPlanOptions } from "./proof-plan.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { EvidenceType } from "./types.js"

export type RunebookAutonomy = "auto" | "guarded" | "hold"

export type RunebookCardId =
  | "pathfinder-mission-intake"
  | "claim-ward-lease"
  | "forge-trace"
  | "proofwright-proof-gate"
  | "faultwright-repair"
  | "mirrorglass-review"
  | "mirrorglass-risk-decision"
  | "sealmark-checkpoint"
  | "recovery-loom-reclaim"
  | "recovery-loom-blocker-hold"

export type RunebookCard = {
  id: RunebookCardId
  title: string
  nextActionId: LoopPulseActionId
  autonomy: RunebookAutonomy
  trigger: string
  intent: string
  steps: string[]
  requiredEvidence: EvidenceType[]
  commands: ProofPlanCommand[]
  toolHints: string[]
  stopConditions: string[]
}

export type Runebook = {
  version: 1
  summary: string
  activeCard: RunebookCard
  cards: RunebookCard[]
}

export type RunebookOptions = {
  proofPlanOptions?: ProofPlanOptions
  covenant?: RunicCovenant
}

export function deriveRunebook(snapshot: RuntimeSnapshot, options: RunebookOptions = {}): Runebook {
  const covenant = options.covenant ?? createRunicCovenant()
  const pulse = deriveLoopPulse(snapshot, covenant)
  const proofPlan = deriveProofPlan(snapshot, options.proofPlanOptions, covenant)
  const activeCard = buildActiveRunebookCard({
    nextActionId: pulse.nextAction.id,
    reason: pulse.nextAction.reason,
    missingEvidence: pulse.missingEvidence,
    diagnostics: pulse.diagnostics,
    risks: pulse.risks,
    commands: proofPlan.commands,
  })

  return {
    version: 1,
    summary: `${pulse.nextAction.label} through ${activeCard.title}.`,
    activeCard,
    cards: [activeCard],
  }
}

export function buildRunebookPrompt(snapshot: RuntimeSnapshot, options: RunebookOptions = {}): string {
  const runebook = deriveRunebook(snapshot, options)
  const card = runebook.activeCard
  const stepLines = card.steps.length > 0 ? card.steps.map((step) => `- ${step}`) : ["none"]
  const commandLines = card.commands.length > 0
    ? card.commands.map((command, index) => `${index + 1}. ${command.label}: ${command.command} (${command.reason})`)
    : ["none"]
  const stopLines = card.stopConditions.length > 0
    ? card.stopConditions.map((condition) => `- ${condition}`)
    : ["none"]

  return [
    "## Runesmith Runebook",
    `Summary: ${runebook.summary}`,
    `Active card: ${card.title} [${card.autonomy}]`,
    `Next action id: ${card.nextActionId}`,
    `Trigger: ${card.trigger}`,
    `Intent: ${card.intent}`,
    `Required evidence: ${formatList(card.requiredEvidence)}`,
    `Tool hints: ${formatList(card.toolHints)}`,
    "Steps:",
    ...stepLines,
    "Commands:",
    ...commandLines,
    "Stop conditions:",
    ...stopLines,
  ].join("\n")
}

function buildActiveRunebookCard(input: {
  nextActionId: LoopPulseActionId
  reason: string
  missingEvidence: EvidenceType[]
  diagnostics: string[]
  risks: string[]
  commands: ProofPlanCommand[]
}): RunebookCard {
  switch (input.nextActionId) {
    case "wait-for-goal":
      return card({
        id: "pathfinder-mission-intake",
        title: "Pathfinder mission intake",
        nextActionId: input.nextActionId,
        autonomy: "auto",
        trigger: input.reason,
        intent: "Turn the next concrete coding request into a durable mission without user-managed workflow steps.",
        steps: [
          "Wait for a concrete coding goal.",
          "Prepare or resume a mission automatically before mutating files.",
          "Keep read-only exploration from creating duplicate missions.",
        ],
        requiredEvidence: [],
        commands: [],
        toolHints: ["runesmith_autopilot_prepare"],
        stopConditions: ["Do not create duplicate missions for read-only inspection."],
      })
    case "recover-stale":
      return card({
        id: "recovery-loom-reclaim",
        title: "Recovery Loom reclaim loop",
        nextActionId: input.nextActionId,
        autonomy: "auto",
        trigger: input.reason,
        intent: "Reclaim stale work before unrelated edits continue.",
        steps: [
          "Run the shared recovery sweep.",
          "Requeue dependency-ready stale work and claim a fresh lease.",
          "Resume the recovered task before starting new work.",
        ],
        requiredEvidence: ["diagnostic"],
        commands: [],
        toolHints: ["runesmith_autopilot_tick", "runesmith_recover"],
        stopConditions: ["Hold unsafe recovery when dependencies or user input are still required."],
      })
    case "resolve-blocker":
      return card({
        id: "recovery-loom-blocker-hold",
        title: "Recovery Loom blocker hold",
        nextActionId: input.nextActionId,
        autonomy: "hold",
        trigger: input.reason,
        intent: "Stop duplicate work until the blocker has explicit recovery or decision evidence.",
        steps: [
          "Read the blocker and current task evidence.",
          "Attach explicit diagnostic, risk, or decision evidence for the unblock path.",
          "Resume only when the shared loop can verify the blocker is clear.",
        ],
        requiredEvidence: input.missingEvidence,
        commands: [],
        toolHints: ["runesmith_task_evidence", "runesmith_recover"],
        stopConditions: ["Do not bypass a blocked task by starting a duplicate mission."],
      })
    case "resolve-risk": {
      const latestRisk = input.risks.at(-1) ?? "the active risk"

      return card({
        id: "mirrorglass-risk-decision",
        title: "Mirrorglass risk decision",
        nextActionId: input.nextActionId,
        autonomy: "hold",
        trigger: input.reason,
        intent: "Resolve risk through a first-class decision path instead of raw evidence plumbing.",
        steps: [
          `Inspect unresolved risk: ${latestRisk}.`,
          "Record accepted or cleared decision evidence through the first-class risk resolver.",
          "Re-enter the shared mission loop after the decision is stored.",
        ],
        requiredEvidence: ["decision"],
        commands: [],
        toolHints: ["runesmith_risk_resolve"],
        stopConditions: ["Do not complete the task while risk is newer than decision evidence."],
      })
    }
    case "claim-task":
      return card({
        id: "claim-ward-lease",
        title: "Claim Ward lease loop",
        nextActionId: input.nextActionId,
        autonomy: "auto",
        trigger: input.reason,
        intent: "Protect dependency-ready work with a contract-backed lease.",
        steps: [
          "Claim the ready task with the matching agent contract.",
          "Use a stable idempotency key so repeated preparation replays safely.",
        ],
        requiredEvidence: [],
        commands: [],
        toolHints: ["runesmith_autopilot_tick", "runesmith_task_claim"],
        stopConditions: ["Do not edit before a valid lease exists for the active task."],
      })
    case "continue-forge":
      return card({
        id: "forge-trace",
        title: "Forge Trace implementation loop",
        nextActionId: input.nextActionId,
        autonomy: "auto",
        trigger: input.reason,
        intent: "Make the smallest useful repo change and let the tool hooks capture implementation evidence.",
        steps: [
          "Inspect the smallest relevant surface.",
          "Apply a scoped implementation change.",
          "Let edit and shell hooks capture file-change or command-output evidence.",
        ],
        requiredEvidence: input.missingEvidence,
        commands: input.commands,
        toolHints: ["runesmith_autopilot_tick"],
        stopConditions: ["Do not claim completion before required evidence is attached."],
      })
    case "capture-proof":
      return card({
        id: "proofwright-proof-gate",
        title: "Proofwright proof gate",
        nextActionId: input.nextActionId,
        autonomy: "auto",
        trigger: input.reason,
        intent: "Convert current work into passing proof before completion.",
        steps: [
          "Run the active Proof Plan.",
          "Attach passing test-result evidence for each required proof command.",
          "Advance the evidence gate only after proof remains fresh.",
        ],
        requiredEvidence: input.missingEvidence.includes("test-result") ? ["test-result"] : input.missingEvidence,
        commands: input.commands,
        toolHints: ["runesmith_proof_run"],
        stopConditions: ["Hold completion until passing test-result evidence is fresh."],
      })
    case "repair-diagnostic": {
      const latestDiagnostic = input.diagnostics.at(-1) ?? "the latest diagnostic"

      return card({
        id: "faultwright-repair",
        title: "Faultwright repair loop",
        nextActionId: input.nextActionId,
        autonomy: "guarded",
        trigger: input.reason,
        intent: "Use failed verification as the active repair target, then prove the repair.",
        steps: [
          `Acknowledge active diagnostic: ${latestDiagnostic}.`,
          "Make the smallest likely fix.",
          "Rerun the exact failing command before broader verification.",
        ],
        requiredEvidence: ["test-result"],
        commands: input.commands,
        toolHints: ["runesmith_proof_run"],
        stopConditions: ["Hold completion until the rerun records passing test-result evidence."],
      })
    }
    case "seal-mission":
      return card({
        id: "sealmark-checkpoint",
        title: "Sealmark checkpoint loop",
        nextActionId: input.nextActionId,
        autonomy: "auto",
        trigger: input.reason,
        intent: "Persist a durable final checkpoint after proof and review are satisfied.",
        steps: [
          "Record the final checkpoint decision.",
          "Persist the runtime capsule after the state transition.",
          "Report verification evidence and residual risk clearly.",
        ],
        requiredEvidence: ["decision"],
        commands: [],
        toolHints: ["runesmith_autopilot_tick"],
        stopConditions: ["Do not seal when proof, review, or risk evidence is missing."],
      })
    case "review-change":
    default:
      return card({
        id: "mirrorglass-review",
        title: "Mirrorglass review loop",
        nextActionId: input.nextActionId,
        autonomy: "guarded",
        trigger: input.reason,
        intent: "Inspect the diff and runtime behavior before sealing.",
        steps: [
          "Review the diff for integration gaps and unrelated churn.",
          "Inspect user-facing behavior when the task touches UI or runtime flow.",
          "Record a decision only when no blocking gap remains.",
        ],
        requiredEvidence: input.missingEvidence.length > 0 ? input.missingEvidence : ["decision"],
        commands: input.commands,
        toolHints: ["runesmith_autopilot_tick", "runesmith_task_evidence"],
        stopConditions: ["Do not approve review while proof is stale or risk remains unresolved."],
      })
  }
}

function card(input: RunebookCard): RunebookCard {
  return {
    ...input,
    steps: [...input.steps],
    requiredEvidence: [...input.requiredEvidence],
    commands: input.commands.map((command) => ({ ...command })),
    toolHints: [...input.toolHints],
    stopConditions: [...input.stopConditions],
  }
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
