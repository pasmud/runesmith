import { createEvidenceLedger, missingRequiredEvidence } from "./evidence-ledger"
import { getRequiredEvidenceForTask } from "./contracts"
import { taskDependenciesComplete, type MissionTaskPlanItem } from "./mission-graph"
import type { RuntimeSnapshot } from "./runtime"
import type { EvidenceType, MissionGraph, MissionTask } from "./types"

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

export type CovenantControlBrief = {
  status: "idle" | "active"
  stage: CovenantStage
  missionId?: string
  taskId?: string
  missionGoal?: string
  taskTitle?: string
  taskStatus?: string
  assignedAgentId?: string
  requiredEvidence: EvidenceType[]
  missingEvidence: EvidenceType[]
  directives: string[]
}

export type CovenantDecisionDraft = {
  stage: "review" | "seal"
  verdict: "approved" | "sealed"
  summary: string
  payload: Record<string, unknown>
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

export function createCovenantTaskPlan(goal: string): MissionTaskPlanItem[] {
  const normalizedGoal = normalizeGoalForTaskTitle(goal)

  return [
    {
      key: "forge",
      title: `Forge: ${normalizedGoal}`,
      description: `Implement the smallest useful change for: ${normalizedGoal}`,
      requiredCapabilities: ["typescript", "testing"],
      requiredEvidence: ["file-change", "test-result"],
    },
    {
      key: "review",
      title: `Review: ${normalizedGoal}`,
      description: `Review the diff, behavior, and residual risk for: ${normalizedGoal}`,
      requiredCapabilities: ["testing"],
      requiredEvidence: ["decision"],
      dependsOn: ["forge"],
    },
    {
      key: "seal",
      title: `Seal: ${normalizedGoal}`,
      description: `Capture the final checkpoint and handoff for: ${normalizedGoal}`,
      requiredCapabilities: ["repository-maintenance"],
      requiredEvidence: ["decision"],
      dependsOn: ["review"],
    },
  ]
}

export function deriveCovenantControlBrief(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant = createRunicCovenant(),
): CovenantControlBrief {
  const active = selectCovenantTask(snapshot)
  if (!active) {
    return {
      status: "idle",
      stage: covenant.stages.find((stage) => stage.id === "frame") ?? covenant.stages[0]!,
      requiredEvidence: [],
      missingEvidence: [],
      directives: [
        "Wait for a concrete user goal before creating work.",
        "When coding work appears, prepare or resume a mission automatically before mutating files.",
      ],
    }
  }

  const contract = active.task.assignedAgentId ? snapshot.contracts[active.task.assignedAgentId] : undefined
  const requiredEvidence = contract ? getRequiredEvidenceForTask(active.task, contract) : active.task.requiredEvidence ?? []
  const ledger = snapshot.ledgers[active.graph.mission.id] ?? createEvidenceLedger()
  const missingEvidence = missingRequiredEvidence(ledger, {
    taskId: active.task.id,
    requiredEvidence,
  })
  const stageId = selectStageId(active.graph, active.task, missingEvidence)
  const stage = covenant.stages.find((candidate) => candidate.id === stageId) ?? covenant.stages[0]!

  return {
    status: "active",
    stage,
    missionId: active.graph.mission.id,
    taskId: active.task.id,
    missionGoal: active.graph.mission.goal,
    taskTitle: active.task.title,
    taskStatus: active.task.status,
    assignedAgentId: active.task.assignedAgentId,
    requiredEvidence,
    missingEvidence,
    directives: buildControlDirectives(stage.id, missingEvidence),
  }
}

export function buildCovenantControlBrief(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant = createRunicCovenant(),
): string {
  const brief = deriveCovenantControlBrief(snapshot, covenant)
  const requiredEvidence = brief.requiredEvidence.length > 0 ? brief.requiredEvidence.join(", ") : "none"
  const missingEvidence = brief.missingEvidence.length > 0 ? brief.missingEvidence.join(", ") : "none"

  const missionLines = brief.status === "active"
    ? [
        `Active mission: ${brief.missionId} - ${brief.missionGoal}`,
        `Active task: ${brief.taskId} - ${brief.taskTitle}`,
        `Task status: ${brief.taskStatus}${brief.assignedAgentId ? `; agent: ${brief.assignedAgentId}` : ""}`,
      ]
    : ["Active mission: none"]

  return [
    "## Runesmith Control Brief",
    `Next stage: ${brief.stage.name}`,
    ...missionLines,
    `required evidence: ${requiredEvidence}`,
    `missing evidence: ${missingEvidence}`,
    "Directives:",
    ...brief.directives.map((directive) => `- ${directive}`),
  ].join("\n")
}

export function createCovenantDecisionDraft(task: MissionTask): CovenantDecisionDraft | undefined {
  const title = task.title.toLowerCase()
  const dependencyTaskIds = task.dependsOn ?? []

  if (title.startsWith("review:")) {
    return {
      stage: "review",
      verdict: "approved",
      summary: "Autonomous review approved verified Forge evidence",
      payload: {
        mode: "runesmith-autopilot",
        stage: "review",
        verdict: "approved",
        taskTitle: task.title,
        dependencyTaskIds,
      },
    }
  }

  if (title.startsWith("seal:")) {
    return {
      stage: "seal",
      verdict: "sealed",
      summary: "Autonomous seal captured mission checkpoint",
      payload: {
        mode: "runesmith-autopilot",
        stage: "seal",
        verdict: "sealed",
        taskTitle: task.title,
        dependencyTaskIds,
      },
    }
  }

  return undefined
}

export function getNextCovenantStage(
  covenant: RunicCovenant,
  currentStageId: CovenantStageId,
): CovenantStage | undefined {
  const index = covenant.stages.findIndex((stage) => stage.id === currentStageId)
  if (index < 0) return undefined

  return covenant.stages[(index + 1) % covenant.stages.length]
}

function selectCovenantTask(snapshot: RuntimeSnapshot): { graph: MissionGraph; task: MissionTask } | undefined {
  const terminalMissionStatuses = new Set(["complete", "failed", "cancelled"])
  const terminalTaskStatuses = new Set(["complete", "failed", "cancelled"])
  const statusRank: Record<string, number> = {
    blocked: 0,
    stale: 1,
    running: 2,
    verifying: 3,
    queued: 4,
  }

  return Object.values(snapshot.graphs)
    .filter((graph) => !terminalMissionStatuses.has(graph.mission.status))
    .flatMap((graph) => {
      return Object.values(graph.tasks)
        .filter((task) => {
          return !terminalTaskStatuses.has(task.status) && (task.status !== "queued" || taskDependenciesComplete(graph, task))
        })
        .map((task) => ({ graph, task }))
    })
    .sort((left, right) => {
      const statusDelta = (statusRank[left.task.status] ?? 99) - (statusRank[right.task.status] ?? 99)
      if (statusDelta !== 0) return statusDelta

      return new Date(right.task.updatedAt).getTime() - new Date(left.task.updatedAt).getTime()
    })[0]
}

function selectStageId(
  graph: MissionGraph,
  task: MissionTask,
  missingEvidence: EvidenceType[],
): CovenantStageId {
  if (graph.mission.status === "blocked" || task.status === "blocked" || task.status === "stale") {
    return "recover"
  }

  if (task.status === "queued") return "claim"
  if (task.status === "verifying") return "review"
  if (missingEvidence.length === 0) return "review"
  if (missingEvidence.includes("file-change")) return "forge"
  if (isSealTask(task)) return "seal"
  if (missingEvidence.some((type) => type === "decision" || type === "risk" || type === "diagnostic")) return "review"

  return "prove"
}

function buildControlDirectives(stageId: CovenantStageId, missingEvidence: EvidenceType[]): string[] {
  if (stageId === "forge") {
    return [
      "Continue the active task before starting duplicate work.",
      "Make the smallest useful repo change, then run targeted verification.",
    ]
  }

  if (stageId === "prove") {
    return [
      "Run the strongest practical verification for the current change.",
      "Failed or unknown test runs do not satisfy completion proof.",
      `Attach or capture missing evidence before completion: ${missingEvidence.join(", ")}.`,
    ]
  }

  if (stageId === "review") {
    return [
      "Review the diff and runtime behavior before sealing the task.",
      "Use the runtime completion gate only after proof remains satisfied.",
    ]
  }

  if (stageId === "seal") {
    return [
      "Record the final checkpoint decision for this mission stage.",
      "Keep the mission capsule current before reporting handoff status.",
    ]
  }

  if (stageId === "recover") {
    return [
      "Recover stale or blocked work before making unrelated edits.",
      "Reclaim safe work with a lease; hold unsafe work for explicit evidence or user input.",
    ]
  }

  if (stageId === "claim") {
    return [
      "Claim the task with the matching agent contract and idempotency key.",
      "Keep tool scope minimal for the current task.",
    ]
  }

  return [
    "Frame the goal, inspect relevant repo context, and avoid unnecessary clarification blocks.",
    "Map the work into the mission graph before execution.",
  ]
}

function normalizeGoalForTaskTitle(goal: string): string {
  const normalized = goal.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : "Mission"
}

function isSealTask(task: MissionTask): boolean {
  return task.title.toLowerCase().startsWith("seal:")
}
