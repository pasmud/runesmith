import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, MissionGraph, MissionTask } from "./types.js"

export type LeadCriticStatus = "idle" | "waiting-for-work" | "needs-critique" | "revision-requested" | "approved" | "sealed"
export type LeadCriticCheckStatus = "passed" | "attention" | "blocked"
export type LeadCriticFindingSeverity = "critical" | "warning" | "info"

export type LeadCriticCheckId = "planning-context" | "implementation-evidence" | "critique-decision"

export type LeadCriticCheck = {
  id: LeadCriticCheckId
  label: string
  status: LeadCriticCheckStatus
  detail: string
}

export type LeadCriticFinding = {
  severity: LeadCriticFindingSeverity
  summary: string
}

export type LeadCritic = {
  status: LeadCriticStatus
  summary: string
  nextAction: string
  missionId?: string
  goal?: string
  taskId?: string
  critiqueId?: string
  checks: LeadCriticCheck[]
  findings: LeadCriticFinding[]
}

export function deriveLeadCritic(snapshot: RuntimeSnapshot): LeadCritic {
  const graph = selectCriticGraph(snapshot)
  if (!graph) {
    return {
      status: "idle",
      summary: "No mission is ready for Lead Critic.",
      nextAction: "Wait for a mission before checking subagent work.",
      checks: [],
      findings: [],
    }
  }

  if (graph.mission.status === "complete") {
    return {
      status: "sealed",
      missionId: graph.mission.id,
      goal: graph.mission.goal,
      summary: `${graph.mission.id} is sealed after Lead critique.`,
      nextAction: "No Lead critique action remains.",
      checks: [
        check("planning-context", "Planning context", "passed", "Mission is already sealed."),
        check("implementation-evidence", "Implementation evidence", "passed", "Mission is already sealed."),
        check("critique-decision", "Lead critique", "passed", "Mission is already sealed."),
      ],
      findings: [],
    }
  }

  const evidence = sortEvidenceOldest(Object.values(snapshot.ledgers[graph.mission.id]?.evidence ?? {}))
  const planningTasks = selectPlanningTasks(graph)
  if (planningTasks.length === 0) {
    return {
      status: "idle",
      missionId: graph.mission.id,
      goal: graph.mission.goal,
      summary: "Lead critique is not required for this mission map.",
      nextAction: "Continue the normal proof and review path.",
      checks: [
        check("planning-context", "Planning context", "passed", "No Scout/WBS planning task is present."),
      ],
      findings: [],
    }
  }

  const task = selectImplementationTaskWithEvidence(graph, evidence) ?? selectImplementationTasks(graph)[0]
  if (!task) {
    return {
      status: "waiting-for-work",
      missionId: graph.mission.id,
      goal: graph.mission.goal,
      summary: `${graph.mission.id} has no implementation task to critique yet.`,
      nextAction: "Wait for implementation evidence before Lead critique.",
      checks: [
        check("planning-context", "Planning context", "passed", "Scout/WBS planning context is present."),
        check("implementation-evidence", "Implementation evidence", "attention", "No implementation task is available for critique."),
      ],
      findings: [
        {
          severity: "warning",
          summary: "No implementation task is available for critique.",
        },
      ],
    }
  }

  const taskEvidence = evidence.filter((entry) => entry.taskId === task.id)
  const latestImplementationEvidence = latestEvidence(taskEvidence, ["file-change", "test-result"])
  const latestCritique = latestLeadCritique(taskEvidence)
  const checks = buildChecks({
    hasPlanningContext: true,
    task,
    latestImplementationEvidence,
    latestCritique,
  })
  const findings = buildFindings(latestCritique, checks)
  const status = selectStatus(checks, latestCritique, latestImplementationEvidence)

  return {
    status,
    missionId: graph.mission.id,
    goal: graph.mission.goal,
    taskId: task.id,
    critiqueId: latestCritique?.id,
    checks,
    findings,
    summary: buildSummary(task, status),
    nextAction: selectNextAction(status, latestCritique, checks),
  }
}

export function buildLeadCriticPrompt(snapshot: RuntimeSnapshot): string {
  const critic = deriveLeadCritic(snapshot)
  const checks = critic.checks.length > 0
    ? critic.checks.map((check) => `- ${check.id}: ${check.status} - ${check.detail}`)
    : ["- none"]
  const findings = critic.findings.length > 0
    ? critic.findings.map((finding) => `- ${finding.severity}: ${finding.summary}`)
    : ["- none"]

  return [
    "## Runesmith Lead Critic",
    `Status: ${critic.status}`,
    `Mission: ${critic.missionId ?? "none"}`,
    `Goal: ${critic.goal ?? "none"}`,
    `Task: ${critic.taskId ?? "none"}`,
    `Critique: ${critic.critiqueId ?? "none"}`,
    `Summary: ${critic.summary}`,
    `Next action: ${critic.nextAction}`,
    "Checks:",
    ...checks,
    "Findings:",
    ...findings,
    "Directive: Lead must critique subagent work against the WBS, acceptance criteria, proof obligations, and scope before Review or Seal can approve refined product work.",
  ].join("\n")
}

export function summarizeLeadCritic(critic: LeadCritic): Record<string, unknown> {
  return {
    status: critic.status,
    missionId: critic.missionId,
    taskId: critic.taskId,
    critiqueId: critic.critiqueId,
    findingCount: critic.findings.length,
    criticalFindings: critic.findings.filter((finding) => finding.severity === "critical").map((finding) => finding.summary),
    checks: critic.checks.map((check) => ({
      id: check.id,
      status: check.status,
    })),
  }
}

function selectCriticGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
  return Object.values(snapshot.graphs).sort((left, right) => {
    const leftRank = isTerminalMission(left) ? 1 : 0
    const rightRank = isTerminalMission(right) ? 1 : 0

    return leftRank - rightRank || right.mission.updatedAt.localeCompare(left.mission.updatedAt) || left.mission.id.localeCompare(right.mission.id)
  })[0]
}

function selectPlanningTasks(graph: MissionGraph): MissionTask[] {
  return Object.values(graph.tasks).filter((task) => {
    const text = `${task.title} ${task.description}`.toLowerCase()

    return text.includes("pathfinder")
      || text.startsWith("plan:")
      || text.includes("acceptance criteria")
      || text.includes("lead-blended wbs")
      || text.includes("runesmith-scout")
  })
}

function selectImplementationTasks(graph: MissionGraph): MissionTask[] {
  const tasks = Object.values(graph.tasks)
  const forgeTasks = tasks.filter((task) => task.title.toLowerCase().startsWith("forge:"))
  if (forgeTasks.length > 0) return forgeTasks

  const rootTask = graph.tasks[graph.mission.rootTaskId]
  return rootTask ? [rootTask] : tasks.slice(0, 1)
}

function selectImplementationTaskWithEvidence(graph: MissionGraph, evidence: Evidence[]): MissionTask | undefined {
  const taskIdsWithEvidence = new Set(evidence
    .filter((entry) => entry.type === "file-change" || entry.type === "test-result")
    .map((entry) => entry.taskId))

  return selectImplementationTasks(graph).find((task) => taskIdsWithEvidence.has(task.id))
}

function buildChecks(input: {
  hasPlanningContext: boolean
  task: MissionTask
  latestImplementationEvidence: Evidence | undefined
  latestCritique: Evidence | undefined
}): LeadCriticCheck[] {
  return [
    check(
      "planning-context",
      "Planning context",
      input.hasPlanningContext ? "passed" : "attention",
      input.hasPlanningContext ? "Scout/WBS planning context is present." : "No Scout/WBS planning context is present.",
    ),
    check(
      "implementation-evidence",
      "Implementation evidence",
      input.latestImplementationEvidence ? "passed" : "attention",
      input.latestImplementationEvidence
        ? `${input.task.id} has implementation evidence to critique.`
        : `${input.task.id} has no implementation evidence to critique yet.`,
    ),
    buildCritiqueDecisionCheck(input.latestImplementationEvidence, input.latestCritique),
  ]
}

function buildCritiqueDecisionCheck(
  latestImplementationEvidence: Evidence | undefined,
  latestCritique: Evidence | undefined,
): LeadCriticCheck {
  if (!latestImplementationEvidence) {
    return check("critique-decision", "Lead critique", "attention", "Lead critique must wait for implementation evidence.")
  }

  if (!latestCritique || latestCritique.createdAt < latestImplementationEvidence.createdAt) {
    return check("critique-decision", "Lead critique", "blocked", "Lead must critique the latest subagent output before review.")
  }

  const verdict = stringValue(latestCritique.payload.verdict)
  if (verdict === "approved" || verdict === "pass" || verdict === "accepted") {
    return check("critique-decision", "Lead critique", "passed", `Lead critique approved: ${latestCritique.summary}.`)
  }

  if (verdict === "revision-requested" || verdict === "revise" || verdict === "blocked") {
    return check("critique-decision", "Lead critique", "blocked", `Lead requested revision: ${latestCritique.summary}.`)
  }

  return check("critique-decision", "Lead critique", "blocked", "Lead critique decision must include verdict approved or revision-requested.")
}

function buildFindings(latestCritique: Evidence | undefined, checks: LeadCriticCheck[]): LeadCriticFinding[] {
  const findings = checks
    .filter((item) => item.status !== "passed")
    .map((item) => ({
      severity: item.status === "blocked" ? "critical" as const : "warning" as const,
      summary: item.detail,
    }))

  for (const finding of extractStringList(latestCritique?.payload.findings) ?? []) {
    if (findings.some((existing) => existing.summary === finding)) continue
    findings.push({
      severity: "critical",
      summary: finding,
    })
  }

  return findings
}

function selectStatus(
  checks: LeadCriticCheck[],
  latestCritique: Evidence | undefined,
  latestImplementationEvidence: Evidence | undefined,
): LeadCriticStatus {
  if (!latestImplementationEvidence) return "waiting-for-work"
  const critique = checks.find((item) => item.id === "critique-decision")
  if (critique?.status === "passed") return "approved"
  const verdict = stringValue(latestCritique?.payload.verdict)
  if (verdict === "revision-requested" || verdict === "revise" || verdict === "blocked") return "revision-requested"

  return "needs-critique"
}

function buildSummary(task: MissionTask, status: LeadCriticStatus): string {
  if (status === "approved") return `${task.id} passed Lead critique.`
  if (status === "revision-requested") return `${task.id} needs focused subagent revision from Lead critique.`
  if (status === "waiting-for-work") return `${task.id} is waiting for implementation evidence before Lead critique.`
  if (status === "sealed") return `${task.id} is sealed after Lead critique.`

  return `${task.id} needs Lead critique before review.`
}

function selectNextAction(status: LeadCriticStatus, latestCritique: Evidence | undefined, checks: LeadCriticCheck[]): string {
  if (status === "approved") return "Continue to proof, review, and seal."
  if (status === "revision-requested") return latestCritique?.summary ?? "Send focused revision feedback to the responsible subagent."
  if (status === "waiting-for-work") return "Wait for subagent implementation evidence before critique."

  const blocked = checks.find((item) => item.status === "blocked")
  if (blocked) return blocked.detail

  return "Record Lead critique decision evidence before review."
}

function latestLeadCritique(evidence: Evidence[]): Evidence | undefined {
  return [...evidence].reverse().find((entry) => {
    if (entry.type !== "decision") return false
    const stage = stringValue(entry.payload.stage) ?? stringValue(entry.payload.mode)

    return stage === "lead-critique" || stage === "lead_critique" || entry.summary.toLowerCase().includes("lead critique")
  })
}

function latestEvidence(evidence: Evidence[], types: string[]): Evidence | undefined {
  const typeSet = new Set(types)

  return [...evidence].reverse().find((entry) => typeSet.has(entry.type))
}

function extractStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean)

  return strings.length > 0 ? strings : undefined
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value.toLowerCase().trim() : undefined
}

function check(id: LeadCriticCheckId, label: string, status: LeadCriticCheckStatus, detail: string): LeadCriticCheck {
  return { id, label, status, detail }
}

function sortEvidenceOldest(evidence: Evidence[]): Evidence[] {
  return evidence
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const createdAtDelta = left.entry.createdAt.localeCompare(right.entry.createdAt)
      return createdAtDelta || left.index - right.index
    })
    .map(({ entry }) => entry)
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}
