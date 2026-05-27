export type CovenantStageId =
  | "frame"
  | "map"
  | "claim"
  | "forge"
  | "prove"
  | "review"
  | "seal"
  | "recover"

export type CovenantInstallMode = "automatic"

export type CovenantStage = {
  id: CovenantStageId
  name: string
  purpose: string
  trigger: string
  behavior: string
  gates: string[]
  evidence: string[]
}

export type RunicCovenant = {
  id: "runic-covenant"
  name: "Runic Covenant"
  version: 1
  installMode: CovenantInstallMode
  thesis: string
  operatingRules: string[]
  stages: CovenantStage[]
}

const covenantStages: CovenantStage[] = [
  {
    id: "frame",
    name: "Mission Frame",
    purpose: "Translate the user's request into a clear mission without making the user run a workflow manually.",
    trigger: "A new user goal, continuation, bug report, or repo task appears.",
    behavior: "Identify the goal, constraints, affected surfaces, and the smallest useful next move.",
    gates: ["Goal is concrete", "Repo context has been inspected", "No unnecessary clarification blocks progress"],
    evidence: ["mission-intent", "context-read"],
  },
  {
    id: "map",
    name: "Mission Map",
    purpose: "Turn the mission into an ordered graph of work that can be leased, verified, and recovered.",
    trigger: "The mission frame is understood well enough to act.",
    behavior: "Create a plan with independent tasks, sequencing, risks, and verification gates.",
    gates: ["Plan has explicit verification", "Tasks are scoped", "Risky operations are marked"],
    evidence: ["task-graph", "risk-note"],
  },
  {
    id: "claim",
    name: "Lease Claim",
    purpose: "Assign work through the scheduler so duplicate loops cannot advance the same target.",
    trigger: "A task is ready to execute.",
    behavior: "Claim the task with an agent contract, idempotency key, tool scope, and time-bound lease.",
    gates: ["Contract matches capabilities", "Tool scope is minimal", "Lease is active"],
    evidence: ["lease-record", "contract-check"],
  },
  {
    id: "forge",
    name: "Forge",
    purpose: "Do the implementation work directly while keeping changes narrow and recoverable.",
    trigger: "A valid lease exists.",
    behavior: "Edit the repo, run targeted checks, and keep state transitions tied to the mission graph.",
    gates: ["Changes are scoped", "Files are not reverted unexpectedly", "Runtime state is updated"],
    evidence: ["file-change", "command-output"],
  },
  {
    id: "prove",
    name: "Proof Gate",
    purpose: "Prevent false completion by requiring evidence before a task can be marked done.",
    trigger: "The implementation appears ready.",
    behavior: "Run the strongest practical verification and attach required evidence to the task ledger.",
    gates: ["Required evidence exists", "Failures are surfaced", "Checks match the task scope"],
    evidence: ["test-result", "diagnostic"],
  },
  {
    id: "review",
    name: "Mirror Review",
    purpose: "Catch integration gaps, user-facing issues, and missing proof before sealing work.",
    trigger: "Proof exists for the current task.",
    behavior: "Review the diff and rendered behavior, then either fix issues or record a clean review.",
    gates: ["Diff reviewed", "UI/runtime behavior inspected when relevant", "Residual risk is explicit"],
    evidence: ["review-note", "risk-note"],
  },
  {
    id: "seal",
    name: "Seal",
    purpose: "Capture the finished state so the mission can be resumed, audited, or released.",
    trigger: "Review finds no blocking gaps.",
    behavior: "Create a snapshot with status, evidence, commands, and next recommended action.",
    gates: ["Snapshot written", "Mission status is current", "Next step is clear"],
    evidence: ["snapshot", "handoff"],
  },
  {
    id: "recover",
    name: "Recovery Sweep",
    purpose: "Recover stale or blocked work automatically instead of letting the harness drift.",
    trigger: "A lease expires, a task stalls, verification fails, or a continuation resumes old work.",
    behavior: "Detect stale state, requeue safe work, hold unsafe work, and loop back to a fresh frame.",
    gates: ["Stale targets identified", "Unsafe recovery is held", "Safe work is requeued"],
    evidence: ["recovery-action", "diagnostic"],
  },
]

export function createRunicCovenant(): RunicCovenant {
  return {
    id: "runic-covenant",
    name: "Runic Covenant",
    version: 1,
    installMode: "automatic",
    thesis:
      "Runesmith should operate end to end by default: understand the mission, map the graph, claim leases, do the work, prove it, review it, seal it, and recover stale or blocked work.",
    operatingRules: [
      "Do not ask the user to invoke a workflow by name when the engine can infer the next stage.",
      "Do not mark work complete until required evidence is attached.",
      "Use the smallest useful tool scope for the active lease.",
      "Recover stale or blocked work before starting unrelated new loops.",
      "Keep the user-facing flow simple: install once, then let Runesmith orchestrate.",
    ],
    stages: covenantStages.map((stage) => ({
      ...stage,
      gates: [...stage.gates],
      evidence: [...stage.evidence],
    })),
  }
}

export function buildCovenantPrompt(covenant: RunicCovenant = createRunicCovenant()): string {
  const stageLines = covenant.stages.map((stage, index) => {
    return `${index + 1}. ${stage.name}: ${stage.behavior} Gates: ${stage.gates.join("; ")}. Evidence: ${stage.evidence.join(", ")}.`
  })

  return [
    "## Runic Covenant",
    covenant.thesis,
    "",
    "Operating rules:",
    ...covenant.operatingRules.map((rule) => `- ${rule}`),
    "",
    "Autonomous loop:",
    ...stageLines,
    "",
    "Always prefer direct useful progress, but preserve leases, tool scope, and required evidence. If a task stalls, recover stale or blocked work before declaring it complete.",
  ].join("\n")
}

export function getNextCovenantStage(
  covenant: RunicCovenant,
  currentStageId: CovenantStageId,
): CovenantStage | undefined {
  const index = covenant.stages.findIndex((stage) => stage.id === currentStageId)
  if (index < 0) return undefined

  return covenant.stages[(index + 1) % covenant.stages.length]
}
