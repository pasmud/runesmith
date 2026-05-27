import { missingRequiredEvidence } from "./evidence-ledger.js"
import { getRequiredEvidenceForTask } from "./contracts.js"
import { deriveRedlineProof, type RedlineProof } from "./redline-proof.js"
import { deriveScopeSentinel, type ScopeSentinel } from "./scope-sentinel.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, EvidenceType, MissionGraph, MissionTask } from "./types.js"

export type ReviewLensStatus = "idle" | "waiting-for-proof" | "ready" | "blocked" | "approved" | "sealed"
export type ReviewLensCheckStatus = "passed" | "blocked" | "attention"
export type ReviewLensFindingSeverity = "critical" | "warning" | "info"

export type ReviewLensCheck = {
  id: "diff-scope" | "proof-freshness" | "redline-proof" | "risk-resolution" | "review-decision"
  label: string
  status: ReviewLensCheckStatus
  detail: string
}

export type ReviewLensFinding = {
  severity: ReviewLensFindingSeverity
  summary: string
}

export type ReviewLens = {
  status: ReviewLensStatus
  summary: string
  nextAction: string
  checklist: ReviewLensCheck[]
  findings: ReviewLensFinding[]
  missionId?: string
  goal?: string
  implementationTaskId?: string
  reviewTaskId?: string
}

export function deriveReviewLens(snapshot: RuntimeSnapshot): ReviewLens {
  const graph = selectReviewGraph(snapshot)
  if (!graph) {
    return {
      status: "idle",
      summary: "No mission is waiting for review.",
      nextAction: "Wait for implementation proof before review.",
      checklist: [],
      findings: [],
    }
  }

  const implementationTask = selectImplementationTask(graph)
  const reviewTask = selectReviewTask(graph)
  if (!implementationTask) {
    return {
      status: "idle",
      missionId: graph.mission.id,
      goal: graph.mission.goal,
      summary: `${graph.mission.id} has no implementation task to review.`,
      nextAction: "Wait for a Forge task before review.",
      checklist: [],
      findings: [],
    }
  }

  const evidence = Object.values(snapshot.ledgers[graph.mission.id]?.evidence ?? {})
  const taskEvidence = evidence.filter((entry) => entry.taskId === implementationTask.id)
  const reviewEvidence = reviewTask ? evidence.filter((entry) => entry.taskId === reviewTask.id) : []
  const contract = implementationTask.assignedAgentId ? snapshot.contracts[implementationTask.assignedAgentId] : undefined
  const requiredEvidence = contract ? getRequiredEvidenceForTask(implementationTask, contract) : implementationTask.requiredEvidence ?? []
  const scopeSentinel = deriveScopeSentinel(snapshot)
  const missingEvidence = missingRequiredEvidence({ evidence: Object.fromEntries(evidence.map((entry) => [entry.id, entry])) }, {
    taskId: implementationTask.id,
    requiredEvidence,
  })
  const unresolvedRisks = collectUnresolvedRiskSummaries(taskEvidence)
  const reviewDecision = reviewEvidence.find((entry) => entry.type === "decision")
  const redlineProof = deriveRedlineProof(snapshot)
  const status = selectReviewStatus(graph, missingEvidence, unresolvedRisks, reviewDecision, scopeSentinel)
  const findings = buildFindings(implementationTask, missingEvidence, unresolvedRisks, taskEvidence, scopeSentinel, redlineProof)
  const checklist = buildChecklist({
    implementationTask,
    missingEvidence,
    redlineProof,
    unresolvedRisks,
    reviewDecision,
    scopeSentinel,
    status,
    taskEvidence,
  })

  return {
    status,
    missionId: graph.mission.id,
    goal: graph.mission.goal,
    implementationTaskId: implementationTask.id,
    reviewTaskId: reviewTask?.id,
    summary: buildSummary(graph, implementationTask, status, findings),
    nextAction: selectNextAction(status),
    checklist,
    findings,
  }
}

export function buildReviewLensPrompt(snapshot: RuntimeSnapshot): string {
  const lens = deriveReviewLens(snapshot)
  const checklist = lens.checklist.length > 0
    ? lens.checklist.map((item) => `- ${item.id}: ${item.status} - ${item.detail}`)
    : ["- none"]
  const findings = lens.findings.length > 0
    ? lens.findings.map((finding) => `- ${finding.severity}: ${finding.summary}`)
    : ["- none"]

  return [
    "## Runesmith Review Lens",
    `Status: ${lens.status}`,
    `Mission: ${lens.missionId ?? "none"}`,
    `Goal: ${lens.goal ?? "none"}`,
    `Implementation task: ${lens.implementationTaskId ?? "none"}`,
    `Review task: ${lens.reviewTaskId ?? "none"}`,
    `Summary: ${lens.summary}`,
    `Next action: ${lens.nextAction}`,
    "Checklist:",
    ...checklist,
    "Findings:",
    ...findings,
    "Directive: Treat Review Lens findings as the pre-seal review surface. Lead with findings before approval, and do not seal while critical findings remain.",
  ].join("\n")
}

export function summarizeReviewLens(lens: ReviewLens): Record<string, unknown> {
  return {
    status: lens.status,
    implementationTaskId: lens.implementationTaskId,
    reviewTaskId: lens.reviewTaskId,
    findingCount: lens.findings.length,
    criticalFindings: lens.findings.filter((finding) => finding.severity === "critical").map((finding) => finding.summary),
    checklist: lens.checklist.map((item) => ({
      id: item.id,
      status: item.status,
    })),
  }
}

function selectReviewGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
  return Object.values(snapshot.graphs).sort((left, right) => {
    const leftRank = isTerminalMission(left) ? 1 : 0
    const rightRank = isTerminalMission(right) ? 1 : 0

    return leftRank - rightRank || right.mission.updatedAt.localeCompare(left.mission.updatedAt) || left.mission.id.localeCompare(right.mission.id)
  })[0]
}

function selectImplementationTask(graph: MissionGraph): MissionTask | undefined {
  const tasks = Object.values(graph.tasks)

  return tasks.find((task) => task.title.toLowerCase().startsWith("forge:"))
    ?? graph.tasks[graph.mission.rootTaskId]
    ?? tasks[0]
}

function selectReviewTask(graph: MissionGraph): MissionTask | undefined {
  return Object.values(graph.tasks).find((task) => task.title.toLowerCase().startsWith("review:"))
}

function selectReviewStatus(
  graph: MissionGraph,
  missingEvidence: EvidenceType[],
  unresolvedRisks: string[],
  reviewDecision: Evidence | undefined,
  scopeSentinel: ScopeSentinel,
): ReviewLensStatus {
  if (graph.mission.status === "complete") return "sealed"
  if (scopeSentinel.status === "blocked") return "blocked"
  if (reviewDecision) return "approved"
  if (unresolvedRisks.length > 0) return "blocked"
  if (missingEvidence.length > 0) return "waiting-for-proof"

  return "ready"
}

function buildChecklist(input: {
  implementationTask: MissionTask
  missingEvidence: EvidenceType[]
  redlineProof: RedlineProof
  unresolvedRisks: string[]
  reviewDecision: Evidence | undefined
  scopeSentinel: ScopeSentinel
  status: ReviewLensStatus
  taskEvidence: Evidence[]
}): ReviewLensCheck[] {
  const hasFileChange = input.taskEvidence.some((entry) => entry.type === "file-change")
  const proofBlocked = input.missingEvidence.includes("test-result")
  const risksBlocked = input.unresolvedRisks.length > 0
  const redlineStatus: ReviewLensCheckStatus = input.redlineProof.status === "missing" ? "attention" : "passed"
  const scopeFinding = input.scopeSentinel.findings.find((finding) => finding.severity === "critical")
    ?? input.scopeSentinel.findings[0]
  const diffScopeStatus: ReviewLensCheckStatus = input.scopeSentinel.status === "blocked"
    ? "blocked"
    : input.scopeSentinel.status === "attention" && hasFileChange
      ? "attention"
      : hasFileChange
        ? "passed"
        : "blocked"

  return [
    {
      id: "diff-scope",
      label: "Diff scope",
      status: diffScopeStatus,
      detail: scopeFinding?.summary
        ?? (hasFileChange
          ? input.scopeSentinel.summary
          : `${input.implementationTask.id} has no file-change evidence yet.`),
    },
    {
      id: "proof-freshness",
      label: "Proof freshness",
      status: proofBlocked ? "blocked" : "passed",
      detail: proofBlocked
        ? `${input.implementationTask.id} still needs passing test-result evidence.`
        : `${input.implementationTask.id} has fresh passing proof.`,
    },
    {
      id: "redline-proof",
      label: "Redline Proof",
      status: redlineStatus,
      detail: input.redlineProof.summary,
    },
    {
      id: "risk-resolution",
      label: "Risk resolution",
      status: risksBlocked ? "blocked" : "passed",
      detail: risksBlocked
        ? `Unresolved risk: ${input.unresolvedRisks[0]}.`
        : "No unresolved risk evidence is newer than the latest decision.",
    },
    {
      id: "review-decision",
      label: "Review decision",
      status: input.reviewDecision ? "passed" : input.status === "ready" ? "attention" : "blocked",
      detail: input.reviewDecision
        ? `Review decision recorded: ${input.reviewDecision.summary}.`
        : input.status === "ready"
          ? "Review can now record an approval decision."
          : "Review decision must wait until proof and risk gates are clear.",
    },
  ]
}

function buildFindings(
  task: MissionTask,
  missingEvidence: EvidenceType[],
  unresolvedRisks: string[],
  taskEvidence: Evidence[],
  scopeSentinel: ScopeSentinel,
  redlineProof: RedlineProof,
): ReviewLensFinding[] {
  const findings: ReviewLensFinding[] = []

  for (const missing of missingEvidence) {
    findings.push({
      severity: missing === "decision" || missing === "risk" ? "critical" : "warning",
      summary: `Missing ${missing} evidence for ${task.id}.`,
    })
  }

  for (const risk of unresolvedRisks) {
    findings.push({
      severity: "critical",
      summary: `Unresolved risk for ${task.id}: ${risk}.`,
    })
  }

  for (const finding of scopeSentinel.findings) {
    if (finding.severity === "info") continue
    findings.push({
      severity: finding.severity,
      summary: finding.summary,
    })
  }

  if (redlineProof.status === "missing") {
    findings.push({
      severity: "warning",
      summary: redlineProof.summary,
    })
  }

  const latestDiagnostic = [...taskEvidence].reverse().find((entry) => entry.type === "diagnostic")
  if (latestDiagnostic && missingEvidence.includes("test-result")) {
    findings.push({
      severity: "warning",
      summary: `Latest diagnostic still needs proof: ${latestDiagnostic.summary}.`,
    })
  }

  return findings
}

function buildSummary(
  graph: MissionGraph,
  task: MissionTask,
  status: ReviewLensStatus,
  findings: ReviewLensFinding[],
): string {
  if (status === "sealed") return `${graph.mission.id} is sealed after review.`
  if (status === "approved") return `${graph.mission.id} has approved review evidence.`
  if (status === "blocked") return `${graph.mission.id} review is blocked by ${findings.length} finding${findings.length === 1 ? "" : "s"}.`
  if (status === "waiting-for-proof") return `${graph.mission.id} review is waiting for proof on ${task.id}.`

  return `${graph.mission.id} is ready for Mirror Review on ${task.id}.`
}

function selectNextAction(status: ReviewLensStatus): string {
  if (status === "idle") return "Wait for implementation proof before review."
  if (status === "waiting-for-proof") return "Capture missing proof before review can approve the mission."
  if (status === "blocked") return "Resolve critical review findings before seal."
  if (status === "approved") return "Continue to Seal once the checkpoint is ready."
  if (status === "sealed") return "No review action remains."

  return "Approve review or record a risk before seal."
}

function collectUnresolvedRiskSummaries(evidence: Evidence[]): string[] {
  let latestDecisionIndex = -1
  const risks: Array<{ summary: string; index: number }> = []

  evidence.forEach((entry, index) => {
    if (entry.type === "decision") latestDecisionIndex = index
    if (entry.type === "risk") risks.push({ summary: entry.summary, index })
  })

  return risks
    .filter((risk) => risk.index > latestDecisionIndex)
    .map((risk) => risk.summary)
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}
