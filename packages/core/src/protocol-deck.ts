import { createRunicCovenant, type RunicCovenant } from "./covenant.js"
import { deriveLoopPulse, type LoopPulseActionId } from "./loop-pulse.js"
import { deriveProofPlan, type ProofPlanCommand, type ProofPlanOptions } from "./proof-plan.js"
import { deriveRunebook } from "./runebook.js"
import type { RuntimeSnapshot } from "./runtime.js"

export type RunicProtocolMode = "auto" | "guarded" | "hold"

export type RunicProtocolId =
  | "pathfinder-intake-protocol"
  | "claim-ward-lease-protocol"
  | "forge-trace-protocol"
  | "proofwright-proof-protocol"
  | "faultwright-repair-protocol"
  | "faultline-breakpoint-protocol"
  | "mirrorglass-review-protocol"
  | "mirrorglass-risk-protocol"
  | "sealmark-checkpoint-protocol"
  | "recovery-loom-protocol"
  | "blocker-hold-protocol"

export type RunicProtocol = {
  id: RunicProtocolId
  name: string
  mode: RunicProtocolMode
  trigger: string
  objective: string
  procedure: string[]
  verification: string[]
  forbiddenMoves: string[]
  toolHints: string[]
}

export type RunicProtocolDeck = {
  version: 1
  summary: string
  active: RunicProtocol
  protocols: RunicProtocol[]
}

export type RunicProtocolDeckOptions = {
  proofPlanOptions?: ProofPlanOptions
  covenant?: RunicCovenant
}

export function deriveRunicProtocolDeck(
  snapshot: RuntimeSnapshot,
  options: RunicProtocolDeckOptions = {},
): RunicProtocolDeck {
  const covenant = options.covenant ?? createRunicCovenant()
  const pulse = deriveLoopPulse(snapshot, covenant)
  const proofPlan = deriveProofPlan(snapshot, options.proofPlanOptions, covenant)
  const runebook = deriveRunebook(snapshot, {
    proofPlanOptions: options.proofPlanOptions,
    covenant,
  })
  const active = buildProtocol({
    actionId: pulse.nextAction.id,
    trigger: pulse.nextAction.reason,
    diagnostics: pulse.diagnostics,
    risks: pulse.risks,
    commands: proofPlan.commands,
    runebookSteps: runebook.activeCard.steps,
    runebookToolHints: runebook.activeCard.toolHints,
  })

  return {
    version: 1,
    summary: `${pulse.nextAction.label} through ${active.name}.`,
    active,
    protocols: [active],
  }
}

export function buildRunicProtocolPrompt(
  snapshot: RuntimeSnapshot,
  options: RunicProtocolDeckOptions = {},
): string {
  const deck = deriveRunicProtocolDeck(snapshot, options)
  const active = deck.active

  return [
    "## Runesmith Protocol Deck",
    "Engine-selected protocol; do not ask the user to invoke a workflow by name.",
    `Summary: ${deck.summary}`,
    `Active protocol: ${active.name} [${active.mode}]`,
    `Trigger: ${active.trigger}`,
    `Objective: ${active.objective}`,
    `Tool hints: ${formatList(active.toolHints)}`,
    "Procedure:",
    ...formatLines(active.procedure),
    "Verification:",
    ...formatLines(active.verification),
    "Forbidden moves:",
    ...formatLines(active.forbiddenMoves),
  ].join("\n")
}

function buildProtocol(input: {
  actionId: LoopPulseActionId
  trigger: string
  diagnostics: string[]
  risks: string[]
  commands: ProofPlanCommand[]
  runebookSteps: string[]
  runebookToolHints: string[]
}): RunicProtocol {
  switch (input.actionId) {
    case "wait-for-goal":
      return protocol({
        id: "pathfinder-intake-protocol",
        name: "Pathfinder Intake Protocol",
        mode: "auto",
        trigger: input.trigger,
        objective: "Turn the next concrete coding request into a durable mission without user-managed setup.",
        procedure: [
          "Wait for a concrete coding goal in chat context.",
          "Prepare or resume the matching mission before mutating files.",
          "Ignore read-only exploration when deciding whether to create work.",
        ],
        verification: ["Mission is created only after a concrete coding goal exists."],
        forbiddenMoves: ["Do not create duplicate missions for browsing, search, or status checks."],
        toolHints: ["runesmith_autopilot_prepare"],
      })
    case "claim-task":
      return protocol({
        id: "claim-ward-lease-protocol",
        name: "Claim Ward Lease Protocol",
        mode: "auto",
        trigger: input.trigger,
        objective: "Protect dependency-ready work with a contract-backed lease before edits start.",
        procedure: [
          "Claim the ready task with the matching agent contract.",
          "Use a stable idempotency key so repeated preparation replays safely.",
        ],
        verification: ["Active task has an assigned agent and active lease."],
        forbiddenMoves: ["Do not edit before the active task has a valid lease."],
        toolHints: input.runebookToolHints,
      })
    case "continue-forge":
      return protocol({
        id: "forge-trace-protocol",
        name: "Forge Trace Protocol",
        mode: "auto",
        trigger: input.trigger,
        objective: "Make the smallest useful implementation change through a focused proof-first loop while leaving evidence the OS can verify.",
        procedure: input.runebookSteps,
        verification: commandLines(input.commands),
        forbiddenMoves: [
          "Do not skip the focused proof-first loop for behavior that can be tested.",
          "Do not broaden the task into unrelated refactors.",
          "Do not mark completion before file-change and proof evidence are fresh.",
        ],
        toolHints: input.runebookToolHints,
      })
    case "capture-proof":
      return protocol({
        id: "proofwright-proof-protocol",
        name: "Proofwright Proof Protocol",
        mode: "auto",
        trigger: input.trigger,
        objective: "Convert implementation evidence into passing, fresh completion proof.",
        procedure: [
          "Run the active Proof Plan in order.",
          "Record passing test-result evidence for every required command.",
          "Advance through the shared evidence gate only after proof remains fresh.",
        ],
        verification: commandLines(input.commands),
        forbiddenMoves: [
          "Do not mark completion from transcript confidence alone.",
          "Do not reuse proof that is older than the latest file-change or diagnostic.",
        ],
        toolHints: ["runesmith_proof_run"],
      })
    case "repair-diagnostic": {
      const latestDiagnostic = input.diagnostics.at(-1) ?? "the latest diagnostic"

      return protocol({
        id: "faultwright-repair-protocol",
        name: "Faultwright Repair Protocol",
        mode: "guarded",
        trigger: input.trigger,
        objective: "Turn failed proof into a focused repair target before another completion attempt.",
        procedure: [
          `Acknowledge active diagnostic: ${latestDiagnostic}.`,
          "State a falsifiable repair hypothesis from the latest diagnostic before editing.",
          "Change one repair variable at a time and explain why it should change the failing output.",
          "Rerun the exact failing command before broader proof.",
        ],
        verification: commandLines(input.commands),
        forbiddenMoves: [
          "Do not rerun the same failing proof before a repair edit is captured.",
          "Do not patch symptoms without linking the edit to the active diagnostic.",
          "Do not start unrelated work while the diagnostic is the active task target.",
        ],
        toolHints: ["runesmith_proof_run"],
      })
    }
    case "review-faultline":
      return protocol({
        id: "faultline-breakpoint-protocol",
        name: "Faultline Breakpoint Protocol",
        mode: "guarded",
        trigger: input.trigger,
        objective: "Stop repeated failed repairs and inspect architecture before another proof attempt.",
        procedure: input.runebookSteps,
        verification: commandLines(input.commands),
        forbiddenMoves: [
          "Do not stack another patch on the same hypothesis.",
          "Do not rerun failing proof until the architecture question has a new answer.",
          "Do not hide repeated diagnostics behind a generic repair summary.",
        ],
        toolHints: input.runebookToolHints,
      })
    case "resolve-risk": {
      const latestRisk = input.risks.at(-1) ?? "the active risk"

      return protocol({
        id: "mirrorglass-risk-protocol",
        name: "Mirrorglass Risk Protocol",
        mode: "hold",
        trigger: input.trigger,
        objective: "Resolve risk through a first-class decision path before completion can continue.",
        procedure: [
          `Inspect unresolved risk: ${latestRisk}.`,
          "Record a clear accepted or cleared decision through the risk resolver.",
          "Re-enter the shared mission loop after the decision is stored.",
        ],
        verification: ["Risk evidence is older than the recorded decision evidence."],
        forbiddenMoves: ["Do not complete the task while risk is newer than decision evidence."],
        toolHints: ["runesmith_risk_resolve"],
      })
    }
    case "recover-stale":
      return protocol({
        id: "recovery-loom-protocol",
        name: "Recovery Loom Protocol",
        mode: "auto",
        trigger: input.trigger,
        objective: "Reclaim stale dependency-ready work before unrelated edits continue.",
        procedure: [
          "Run the shared recovery sweep.",
          "Requeue dependency-ready stale work and clear stale ownership.",
          "Claim a fresh lease before resuming the task.",
        ],
        verification: ["Recovered task is queued or running under a fresh lease."],
        forbiddenMoves: ["Do not continue work under an expired lease."],
        toolHints: ["runesmith_autopilot_tick", "runesmith_recover"],
      })
    case "resolve-blocker":
      return protocol({
        id: "blocker-hold-protocol",
        name: "Blocker Hold Protocol",
        mode: "hold",
        trigger: input.trigger,
        objective: "Stop duplicate work until a blocker has explicit recovery, diagnostic, risk, or decision evidence.",
        procedure: input.runebookSteps,
        verification: ["The blocker has explicit evidence for the unblock path."],
        forbiddenMoves: ["Do not bypass a blocked task by starting a duplicate mission."],
        toolHints: input.runebookToolHints,
      })
    case "seal-mission":
      return protocol({
        id: "sealmark-checkpoint-protocol",
        name: "Sealmark Checkpoint Protocol",
        mode: "auto",
        trigger: input.trigger,
        objective: "Persist a durable final checkpoint after proof and review are satisfied.",
        procedure: input.runebookSteps,
        verification: ["Runtime capsule is current after the final state transition."],
        forbiddenMoves: ["Do not seal when proof, review, or risk evidence is missing."],
        toolHints: input.runebookToolHints,
      })
    case "review-change":
    default:
      return protocol({
        id: "mirrorglass-review-protocol",
        name: "Mirrorglass Review Protocol",
        mode: "guarded",
        trigger: input.trigger,
        objective: "Inspect the diff and runtime behavior with findings-first review discipline before sealing a checkpoint.",
        procedure: input.runebookSteps,
        verification: commandLines(input.commands),
        forbiddenMoves: [
          "Do not bury critical findings below a summary or approval.",
          "Do not approve review while proof is stale or unresolved risk remains.",
        ],
        toolHints: input.runebookToolHints,
      })
  }
}

function protocol(input: RunicProtocol): RunicProtocol {
  return {
    ...input,
    procedure: [...input.procedure],
    verification: [...input.verification],
    forbiddenMoves: [...input.forbiddenMoves],
    toolHints: [...input.toolHints],
  }
}

function commandLines(commands: ProofPlanCommand[]): string[] {
  return commands.length > 0
    ? commands.map((command) => `${command.label}: ${command.command}`)
    : ["No command is required for the active protocol."]
}

function formatLines(lines: string[]): string[] {
  return lines.length > 0 ? lines.map((line) => `- ${line}`) : ["- none"]
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
