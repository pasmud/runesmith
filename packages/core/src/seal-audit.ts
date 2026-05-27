import { deriveProofPlan, type ProofPlan, type ProofPlanOptions } from "./proof-plan.js"
import { deriveRedlineProof, type RedlineProof } from "./redline-proof.js"
import { deriveReviewLens, type ReviewLens } from "./review-lens.js"
import { deriveScopeSentinel, type ScopeSentinel } from "./scope-sentinel.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, MissionGraph, MissionTask } from "./types.js"

export type SealAuditStatus = "idle" | "collecting-proof" | "blocked" | "ready" | "sealed"
export type SealAuditCheckStatus = "passed" | "attention" | "blocked"
export type SealAuditFindingSeverity = "critical" | "warning" | "info"

export type SealAuditCheckId =
  | "mission-state"
  | "proof-gate"
  | "redline-gate"
  | "scope-gate"
  | "review-gate"
  | "seal-decision"

export type SealAuditCheck = {
  id: SealAuditCheckId
  label: string
  status: SealAuditCheckStatus
  detail: string
}

export type SealAuditFinding = {
  severity: SealAuditFindingSeverity
  summary: string
}

export type SealAudit = {
  status: SealAuditStatus
  summary: string
  nextAction: string
  missionId?: string
  goal?: string
  implementationTaskId?: string
  reviewTaskId?: string
  sealTaskId?: string
  checks: SealAuditCheck[]
  findings: SealAuditFinding[]
}

export function deriveSealAudit(snapshot: RuntimeSnapshot, proofPlanOptions: ProofPlanOptions = {}): SealAudit {
  const graph = selectSealGraph(snapshot)
  if (!graph) {
    return {
      status: "idle",
      summary: "No mission is ready for seal audit.",
      nextAction: "Wait for a mission before auditing completion.",
      checks: [],
      findings: [],
    }
  }

  const implementationTask = selectImplementationTask(graph)
  const reviewTask = selectStageTask(graph, "review:")
  const sealTask = selectStageTask(graph, "seal:")
  const evidence = Object.values(snapshot.ledgers[graph.mission.id]?.evidence ?? {})
  const sealDecision = sealTask ? selectSealDecision(evidence, sealTask.id) : undefined
  const proofPlan = deriveProofPlan(snapshot, proofPlanOptions)
  const redlineProof = deriveRedlineProof(snapshot)
  const scopeSentinel = deriveScopeSentinel(snapshot)
  const reviewLens = deriveReviewLens(snapshot)
  const checks = buildChecks({
    graph,
    proofPlan,
    redlineProof,
    reviewLens,
    scopeSentinel,
    sealDecision,
    sealTask,
  })
  const findings = buildFindings({ checks, proofPlan, redlineProof, reviewLens, scopeSentinel })
  const status = selectStatus(graph, checks)

  return {
    status,
    missionId: graph.mission.id,
    goal: graph.mission.goal,
    implementationTaskId: implementationTask?.id,
    reviewTaskId: reviewTask?.id,
    sealTaskId: sealTask?.id,
    checks,
    findings,
    summary: buildSummary(graph, status),
    nextAction: selectNextAction(status, checks),
  }
}

export function buildSealAuditPrompt(snapshot: RuntimeSnapshot, proofPlanOptions: ProofPlanOptions = {}): string {
  const audit = deriveSealAudit(snapshot, proofPlanOptions)
  const checks = audit.checks.length > 0
    ? audit.checks.map((check) => `- ${check.id}: ${check.status} - ${check.detail}`)
    : ["- none"]
  const findings = audit.findings.length > 0
    ? audit.findings.map((finding) => `- ${finding.severity}: ${finding.summary}`)
    : ["- none"]

  return [
    "## Runesmith Seal Audit",
    `Status: ${audit.status}`,
    `Mission: ${audit.missionId ?? "none"}`,
    `Goal: ${audit.goal ?? "none"}`,
    `Implementation task: ${audit.implementationTaskId ?? "none"}`,
    `Review task: ${audit.reviewTaskId ?? "none"}`,
    `Seal task: ${audit.sealTaskId ?? "none"}`,
    `Summary: ${audit.summary}`,
    `Next action: ${audit.nextAction}`,
    "Checks:",
    ...checks,
    "Findings:",
    ...findings,
    "Directive: Do not claim completion or seal the mission until the Seal Audit is ready or sealed.",
  ].join("\n")
}

export function summarizeSealAudit(audit: SealAudit): Record<string, unknown> {
  return {
    status: audit.status,
    missionId: audit.missionId,
    implementationTaskId: audit.implementationTaskId,
    reviewTaskId: audit.reviewTaskId,
    sealTaskId: audit.sealTaskId,
    findingCount: audit.findings.length,
    criticalFindings: audit.findings.filter((finding) => finding.severity === "critical").map((finding) => finding.summary),
    checks: audit.checks.map((check) => ({
      id: check.id,
      status: check.status,
    })),
  }
}

function selectSealGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
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

function selectStageTask(graph: MissionGraph, prefix: "review:" | "seal:"): MissionTask | undefined {
  return Object.values(graph.tasks).find((task) => task.title.toLowerCase().startsWith(prefix))
}

function selectSealDecision(evidence: Evidence[], sealTaskId: string): Evidence | undefined {
  return evidence.find((entry) => {
    if (entry.taskId !== sealTaskId || entry.type !== "decision") return false
    return entry.payload.stage === "seal" || entry.summary.toLowerCase().includes("seal")
  })
}

function buildChecks(input: {
  graph: MissionGraph
  proofPlan: ProofPlan
  redlineProof: RedlineProof
  reviewLens: ReviewLens
  scopeSentinel: ScopeSentinel
  sealDecision: Evidence | undefined
  sealTask: MissionTask | undefined
}): SealAuditCheck[] {
  return [
    buildMissionStateCheck(input.graph),
    buildProofGateCheck(input.graph, input.proofPlan),
    buildRedlineGateCheck(input.graph, input.redlineProof),
    buildScopeGateCheck(input.graph, input.scopeSentinel),
    buildReviewGateCheck(input.graph, input.reviewLens),
    buildSealDecisionCheck(input.graph, input.reviewLens, input.sealDecision, input.sealTask),
  ]
}

function buildMissionStateCheck(graph: MissionGraph): SealAuditCheck {
  if (graph.mission.status === "complete") {
    return check("mission-state", "Mission state", "passed", `${graph.mission.id} is complete.`)
  }

  if (["failed", "cancelled", "blocked"].includes(graph.mission.status)) {
    return check("mission-state", "Mission state", "blocked", `${graph.mission.id} is ${graph.mission.status}.`)
  }

  return check("mission-state", "Mission state", "passed", `${graph.mission.id} is active for completion audit.`)
}

function buildProofGateCheck(graph: MissionGraph, proofPlan: ProofPlan): SealAuditCheck {
  if (graph.mission.status === "complete") {
    return check("proof-gate", "Proof gate", "passed", "Mission completed after proof was accepted.")
  }

  if (proofPlan.status === "needs-repair") {
    const diagnostic = proofPlan.diagnostics[0] ?? "latest diagnostic"
    return check("proof-gate", "Proof gate", "blocked", `Repair required before seal: ${diagnostic}.`)
  }

  if (proofPlan.status === "needs-proof") {
    return check("proof-gate", "Proof gate", "attention", proofPlan.handoff)
  }

  if (proofPlan.status === "not-needed") {
    return check("proof-gate", "Proof gate", "passed", proofPlan.handoff)
  }

  return check("proof-gate", "Proof gate", "attention", "No proof target is active yet.")
}

function buildRedlineGateCheck(graph: MissionGraph, redlineProof: RedlineProof): SealAuditCheck {
  if (graph.mission.status === "complete") {
    return check("redline-gate", "Redline Proof", "passed", "Mission completed after review captured Redline Proof state.")
  }

  if (redlineProof.status === "missing") {
    return check("redline-gate", "Redline Proof", "attention", redlineProof.summary)
  }

  return check("redline-gate", "Redline Proof", "passed", redlineProof.summary)
}

function buildScopeGateCheck(graph: MissionGraph, scopeSentinel: ScopeSentinel): SealAuditCheck {
  if (graph.mission.status === "complete") {
    return check("scope-gate", "Scope gate", "passed", "Mission completed with scope review satisfied.")
  }

  const finding = scopeSentinel.findings.find((item) => item.severity === "critical") ?? scopeSentinel.findings[0]
  if (scopeSentinel.status === "blocked") {
    return check("scope-gate", "Scope gate", "blocked", finding?.summary ?? scopeSentinel.summary)
  }

  if (scopeSentinel.status === "clear") {
    return check("scope-gate", "Scope gate", "passed", scopeSentinel.summary)
  }

  return check("scope-gate", "Scope gate", "attention", finding?.summary ?? scopeSentinel.summary)
}

function buildReviewGateCheck(graph: MissionGraph, reviewLens: ReviewLens): SealAuditCheck {
  if (graph.mission.status === "complete" || reviewLens.status === "sealed") {
    return check("review-gate", "Review gate", "passed", "Mission completed after review.")
  }

  if (reviewLens.status === "ready" || reviewLens.status === "approved") {
    return check("review-gate", "Review gate", "passed", reviewLens.summary)
  }

  if (reviewLens.status === "blocked") {
    return check("review-gate", "Review gate", "blocked", reviewLens.findings[0]?.summary ?? reviewLens.summary)
  }

  return check("review-gate", "Review gate", "attention", reviewLens.summary)
}

function buildSealDecisionCheck(
  graph: MissionGraph,
  reviewLens: ReviewLens,
  sealDecision: Evidence | undefined,
  sealTask: MissionTask | undefined,
): SealAuditCheck {
  if (graph.mission.status === "complete") {
    return check("seal-decision", "Seal decision", "passed", "Final seal decision is recorded.")
  }

  if (sealDecision) {
    return check("seal-decision", "Seal decision", "passed", `Seal decision recorded: ${sealDecision.summary}.`)
  }

  if (!sealTask) {
    return check("seal-decision", "Seal decision", "blocked", "No Seal task exists in the mission graph.")
  }

  if (reviewLens.status === "ready" || reviewLens.status === "approved") {
    return check("seal-decision", "Seal decision", "attention", "Sealmark can record the final checkpoint.")
  }

  return check("seal-decision", "Seal decision", "blocked", "Seal decision must wait for proof, scope, and review gates.")
}

function buildFindings(input: {
  checks: SealAuditCheck[]
  proofPlan: ProofPlan
  redlineProof: RedlineProof
  reviewLens: ReviewLens
  scopeSentinel: ScopeSentinel
}): SealAuditFinding[] {
  const findings: SealAuditFinding[] = []

  for (const check of input.checks) {
    if (check.status === "blocked" && check.id !== "seal-decision") {
      findings.push({
        severity: "critical",
        summary: check.detail,
      })
    }
  }

  if (input.proofPlan.status === "needs-proof") {
    findings.push({
      severity: "warning",
      summary: input.proofPlan.handoff,
    })
  }

  if (input.redlineProof.status === "missing") {
    findings.push({
      severity: "warning",
      summary: input.redlineProof.summary,
    })
  }

  for (const finding of input.reviewLens.findings) {
    findings.push({
      severity: finding.severity,
      summary: finding.summary,
    })
  }

  for (const finding of input.scopeSentinel.findings) {
    if (findings.some((existing) => existing.summary === finding.summary)) continue
    findings.push({
      severity: finding.severity,
      summary: finding.summary,
    })
  }

  return uniqueFindings(findings)
}

function selectStatus(graph: MissionGraph, checks: SealAuditCheck[]): SealAuditStatus {
  if (graph.mission.status === "complete") return "sealed"

  const nonSealChecks = checks.filter((check) => check.id !== "seal-decision" && check.id !== "redline-gate")
  if (nonSealChecks.some((check) => check.status === "blocked")) return "blocked"
  if (nonSealChecks.some((check) => check.status === "attention")) return "collecting-proof"

  return "ready"
}

function buildSummary(graph: MissionGraph, status: SealAuditStatus): string {
  if (status === "sealed") return `${graph.mission.id} is sealed with completion evidence.`
  if (status === "ready") return `${graph.mission.id} is ready for Sealmark checkpoint.`
  if (status === "blocked") return `${graph.mission.id} has blocking findings before seal.`
  if (status === "collecting-proof") return `${graph.mission.id} needs stronger proof before any completion claim.`

  return "No mission is ready for seal audit."
}

function selectNextAction(status: SealAuditStatus, checks: SealAuditCheck[]): string {
  if (status === "sealed") return "No completion action remains."
  if (status === "ready") return "Record the seal decision and persist the final capsule."

  const proof = checks.find((check) => check.id === "proof-gate")
  if (proof?.status === "attention") return "Run the Proof Plan before review or seal."
  if (proof?.status === "blocked") return "Repair the active diagnostic before claiming completion."

  const blocked = checks.find((check) => check.status === "blocked" && check.id !== "seal-decision")
  if (blocked) return `Resolve ${blocked.label.toLowerCase()} before seal.`

  return "Continue the mission loop until proof, scope, and review are clear."
}

function check(id: SealAuditCheckId, label: string, status: SealAuditCheckStatus, detail: string): SealAuditCheck {
  return { id, label, status, detail }
}

function uniqueFindings(findings: SealAuditFinding[]): SealAuditFinding[] {
  const seen = new Set<string>()

  return findings.filter((finding) => {
    const key = `${finding.severity}:${finding.summary}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}
