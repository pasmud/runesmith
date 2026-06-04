import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, MissionGraph, MissionTask } from "./types.js"

export type ProductionReadinessStatus = "idle" | "collecting-proof" | "blocked" | "ready" | "sealed"
export type ProductionReadinessCheckStatus = "passed" | "attention" | "blocked"
export type ProductionReadinessFindingSeverity = "critical" | "warning" | "info"

export type ProductionReadinessCheckId =
  | "acceptance-criteria"
  | "proof-obligations"
  | "implementation-evidence"
  | "browser-workflow"
  | "diagnostic-clean"

export type ProductionReadinessCheck = {
  id: ProductionReadinessCheckId
  label: string
  status: ProductionReadinessCheckStatus
  detail: string
}

export type ProductionReadinessFinding = {
  severity: ProductionReadinessFindingSeverity
  summary: string
}

export type ProductionReadiness = {
  status: ProductionReadinessStatus
  summary: string
  nextAction: string
  missionId?: string
  goal?: string
  acceptanceCriteria: string[]
  proofObligations: string[]
  checks: ProductionReadinessCheck[]
  findings: ProductionReadinessFinding[]
}

export function deriveProductionReadiness(snapshot: RuntimeSnapshot): ProductionReadiness {
  const graph = selectReadinessGraph(snapshot)
  if (!graph) {
    return {
      status: "idle",
      summary: "No mission is ready for Production Seal.",
      nextAction: "Wait for a mission before checking production readiness.",
      acceptanceCriteria: [],
      proofObligations: [],
      checks: [],
      findings: [],
    }
  }

  if (graph.mission.status === "complete") {
    return {
      status: "sealed",
      missionId: graph.mission.id,
      goal: graph.mission.goal,
      summary: `${graph.mission.id} is sealed after Production Seal readiness was checked.`,
      nextAction: "No production readiness action remains.",
      acceptanceCriteria: [],
      proofObligations: [],
      checks: [
        check("acceptance-criteria", "Acceptance criteria", "passed", "Mission is already sealed."),
        check("proof-obligations", "Proof obligations", "passed", "Mission is already sealed."),
        check("implementation-evidence", "Implementation evidence", "passed", "Mission is already sealed."),
        check("browser-workflow", "Browser workflow", "passed", "Mission is already sealed."),
        check("diagnostic-clean", "Diagnostic state", "passed", "Mission is already sealed."),
      ],
      findings: [],
    }
  }

  const evidence = sortEvidenceOldest(Object.values(snapshot.ledgers[graph.mission.id]?.evidence ?? {}))
  const planningTasks = selectPlanningTasks(graph)
  const implementationTasks = selectImplementationTasks(graph)
  const planningDecision = selectPlanningDecision(evidence, planningTasks)
  const acceptanceCriteria = extractStringList(planningDecision?.payload.acceptanceCriteria)
    ?? extractStringList(planningDecision?.payload.criteria)
    ?? []
  const proofObligations = extractStringList(planningDecision?.payload.proofObligations)
    ?? extractStringList(planningDecision?.payload.proofPlan)
    ?? extractProofMap(planningDecision?.payload.proofMap)
    ?? []
  const checks = [
    buildAcceptanceCriteriaCheck(planningTasks, acceptanceCriteria),
    buildProofObligationsCheck(planningTasks, proofObligations),
    buildImplementationEvidenceCheck(evidence, implementationTasks),
    buildBrowserWorkflowCheck(graph, evidence, implementationTasks),
    buildDiagnosticCleanCheck(evidence, implementationTasks),
  ]
  const findings = buildFindings(checks)
  const status = selectStatus(checks)

  return {
    status,
    missionId: graph.mission.id,
    goal: graph.mission.goal,
    acceptanceCriteria,
    proofObligations,
    checks,
    findings,
    summary: buildSummary(graph, status),
    nextAction: selectNextAction(status, checks),
  }
}

export function buildProductionReadinessPrompt(snapshot: RuntimeSnapshot): string {
  const readiness = deriveProductionReadiness(snapshot)
  const criteria = readiness.acceptanceCriteria.length > 0
    ? readiness.acceptanceCriteria.map((criterion) => `- ${criterion}`)
    : ["- none"]
  const obligations = readiness.proofObligations.length > 0
    ? readiness.proofObligations.map((obligation) => `- ${obligation}`)
    : ["- none"]
  const checks = readiness.checks.length > 0
    ? readiness.checks.map((check) => `- ${check.id}: ${check.status} - ${check.detail}`)
    : ["- none"]
  const findings = readiness.findings.length > 0
    ? readiness.findings.map((finding) => `- ${finding.severity}: ${finding.summary}`)
    : ["- none"]

  return [
    "## Runesmith Production Seal",
    `Status: ${readiness.status}`,
    `Mission: ${readiness.missionId ?? "none"}`,
    `Goal: ${readiness.goal ?? "none"}`,
    `Summary: ${readiness.summary}`,
    `Next action: ${readiness.nextAction}`,
    "Acceptance criteria:",
    ...criteria,
    "Proof obligations:",
    ...obligations,
    "Checks:",
    ...checks,
    "Findings:",
    ...findings,
    "Directive: Do not claim production readiness until acceptance criteria, proof obligations, implementation evidence, browser workflow proof when relevant, and diagnostics are clear.",
  ].join("\n")
}

export function summarizeProductionReadiness(readiness: ProductionReadiness): Record<string, unknown> {
  return {
    status: readiness.status,
    missionId: readiness.missionId,
    acceptanceCriteria: readiness.acceptanceCriteria,
    proofObligations: readiness.proofObligations,
    findingCount: readiness.findings.length,
    criticalFindings: readiness.findings.filter((finding) => finding.severity === "critical").map((finding) => finding.summary),
    checks: readiness.checks.map((check) => ({
      id: check.id,
      status: check.status,
    })),
  }
}

function selectReadinessGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
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

function selectPlanningDecision(evidence: Evidence[], planningTasks: MissionTask[]): Evidence | undefined {
  const planningTaskIds = new Set(planningTasks.map((task) => task.id))

  return [...evidence].reverse().find((entry) => entry.type === "decision" && planningTaskIds.has(entry.taskId))
}

function buildAcceptanceCriteriaCheck(planningTasks: MissionTask[], acceptanceCriteria: string[]): ProductionReadinessCheck {
  if (planningTasks.length === 0) {
    return check("acceptance-criteria", "Acceptance criteria", "passed", "No dedicated Scout planning task is required for this mission.")
  }

  if (acceptanceCriteria.length > 0) {
    return check("acceptance-criteria", "Acceptance criteria", "passed", `${acceptanceCriteria.length} acceptance criteria recorded from Scout planning.`)
  }

  return check("acceptance-criteria", "Acceptance criteria", "attention", "Record Scout-derived acceptanceCriteria on the planning decision before implementation can be production-ready.")
}

function buildProofObligationsCheck(planningTasks: MissionTask[], proofObligations: string[]): ProductionReadinessCheck {
  if (planningTasks.length === 0) {
    return check("proof-obligations", "Proof obligations", "passed", "No dedicated Scout planning task is required for this mission.")
  }

  if (proofObligations.length > 0) {
    return check("proof-obligations", "Proof obligations", "passed", `${proofObligations.length} proof obligations map acceptance criteria to verification.`)
  }

  return check("proof-obligations", "Proof obligations", "attention", "Record proofObligations or proofMap on the planning decision before implementation can be production-ready.")
}

function buildImplementationEvidenceCheck(evidence: Evidence[], implementationTasks: MissionTask[]): ProductionReadinessCheck {
  if (implementationTasks.length === 0) {
    return check("implementation-evidence", "Implementation evidence", "attention", "No Forge implementation task is available for production readiness.")
  }

  const missing = implementationTasks.flatMap((task) => {
    const taskEvidence = evidence.filter((entry) => entry.taskId === task.id)
    const hasFileChange = taskEvidence.some((entry) => entry.type === "file-change")
    const hasPassingTest = taskEvidence.some((entry) => entry.type === "test-result" && isPassingTestResult(entry))
    const missingForTask: string[] = []
    if (!hasFileChange) missingForTask.push(`${task.id} file-change`)
    if (!hasPassingTest) missingForTask.push(`${task.id} passing test-result`)

    return missingForTask
  })

  if (missing.length > 0) {
    return check("implementation-evidence", "Implementation evidence", "attention", `Missing implementation proof: ${missing[0]}.`)
  }

  return check("implementation-evidence", "Implementation evidence", "passed", `${implementationTasks.length} Forge task${implementationTasks.length === 1 ? "" : "s"} have file-change and passing test-result evidence.`)
}

function buildBrowserWorkflowCheck(
  graph: MissionGraph,
  evidence: Evidence[],
  implementationTasks: MissionTask[],
): ProductionReadinessCheck {
  if (!requiresBrowserWorkflow(graph, evidence, implementationTasks)) {
    return check("browser-workflow", "Browser workflow", "passed", "No interactive browser workflow proof is required for this mission.")
  }

  if (hasFreshInteractiveBrowserProof(evidence, implementationTasks)) {
    return check("browser-workflow", "Browser workflow", "passed", "Browser smoke proof demonstrates a user interaction after the latest UI change.")
  }

  return check("browser-workflow", "Browser workflow", "attention", "Run node .runesmith/proof/browser-smoke.mjs and verify user interaction changes app state before production readiness.")
}

function buildDiagnosticCleanCheck(evidence: Evidence[], implementationTasks: MissionTask[]): ProductionReadinessCheck {
  const implementationTaskIds = new Set(implementationTasks.map((task) => task.id))
  const implementationEvidence = evidence.filter((entry) => implementationTaskIds.has(entry.taskId))
  const latestDiagnostic = [...implementationEvidence].reverse().find((entry) => entry.type === "diagnostic")
  if (!latestDiagnostic) {
    return check("diagnostic-clean", "Diagnostic state", "passed", "No unresolved diagnostics are attached to implementation work.")
  }

  const newerPassingProof = implementationEvidence.some((entry) =>
    entry.type === "test-result"
    && isPassingTestResult(entry)
    && entry.createdAt > latestDiagnostic.createdAt
  )
  if (newerPassingProof) {
    return check("diagnostic-clean", "Diagnostic state", "passed", "Latest diagnostic has newer passing proof.")
  }

  return check("diagnostic-clean", "Diagnostic state", "blocked", `Latest diagnostic still needs repair proof: ${latestDiagnostic.summary}.`)
}

function requiresBrowserWorkflow(graph: MissionGraph, evidence: Evidence[], implementationTasks: MissionTask[]): boolean {
  const text = [
    graph.mission.goal,
    ...implementationTasks.flatMap((task) => [task.title, task.description]),
  ].join(" ").toLowerCase()
  if (/\b(ui|browser|frontend|front-end|game|playable|interactive|web app|score|high score|click|tap|keyboard)\b/.test(text)) return true

  return evidence.some((entry) => {
    if (entry.type !== "file-change") return false

    return extractFileCandidates(entry.payload).some((file) => {
      const normalized = normalizePath(file)

      return normalized === "index.html" || /\.(html|css)$/i.test(normalized)
    })
  })
}

function hasFreshInteractiveBrowserProof(evidence: Evidence[], implementationTasks: MissionTask[]): boolean {
  const implementationTaskIds = new Set(implementationTasks.map((task) => task.id))
  const implementationEvidence = evidence.filter((entry) => implementationTaskIds.has(entry.taskId))
  const latestUiChange = [...implementationEvidence]
    .reverse()
    .find((entry) => entry.type === "file-change" && extractFileCandidates(entry.payload).some((file) => {
      const normalized = normalizePath(file)

      return normalized === "index.html" || /\.(html|css|[cm]?[jt]sx?)$/i.test(normalized)
    }))
    ?.createdAt

  return implementationEvidence.some((entry) => {
    if (entry.type !== "test-result" || !isPassingTestResult(entry)) return false
    if (latestUiChange && entry.createdAt < latestUiChange) return false
    const command = entry.payload.command
    if (typeof command !== "string" || !normalizeCommand(command).includes(".runesmith/proof/browser-smoke.mjs")) return false

    return hasInteractionAssertion(entry)
  })
}

function hasInteractionAssertion(evidence: Evidence): boolean {
  if (extractStringList(evidence.payload.interactions)?.length) return true
  if (extractStringList(evidence.payload.assertions)?.length) return true

  return /\b(interaction|input|keyboard|click|tap|changed board|board changed|state changed|score visible)\b/i.test(evidence.summary)
}

function buildFindings(checks: ProductionReadinessCheck[]): ProductionReadinessFinding[] {
  return checks
    .filter((item) => item.status !== "passed")
    .map((item) => ({
      severity: item.status === "blocked" ? "critical" : "warning",
      summary: item.detail,
    }))
}

function selectStatus(checks: ProductionReadinessCheck[]): ProductionReadinessStatus {
  if (checks.some((item) => item.status === "blocked")) return "blocked"
  if (checks.some((item) => item.status === "attention")) return "collecting-proof"

  return "ready"
}

function buildSummary(graph: MissionGraph, status: ProductionReadinessStatus): string {
  if (status === "ready") return `${graph.mission.id} satisfies the Production Seal readiness gate.`
  if (status === "blocked") return `${graph.mission.id} has blocking Production Seal findings.`
  if (status === "collecting-proof") return `${graph.mission.id} needs stronger production-readiness proof before completion.`
  if (status === "sealed") return `${graph.mission.id} is sealed after Production Seal readiness was checked.`

  return "No mission is ready for Production Seal."
}

function selectNextAction(status: ProductionReadinessStatus, checks: ProductionReadinessCheck[]): string {
  if (status === "ready") return "Continue to review and seal with Production Seal evidence clear."
  if (status === "sealed") return "No production readiness action remains."

  const blocked = checks.find((item) => item.status === "blocked")
  if (blocked) return `Resolve ${blocked.label.toLowerCase()} before production seal.`

  const attention = checks.find((item) => item.status === "attention")
  if (attention) return attention.detail

  return "Continue gathering production-readiness proof."
}

function check(
  id: ProductionReadinessCheckId,
  label: string,
  status: ProductionReadinessCheckStatus,
  detail: string,
): ProductionReadinessCheck {
  return { id, label, status, detail }
}

function extractStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.map((entry) => typeof entry === "string" ? entry.trim() : "").filter(Boolean)

  return strings.length > 0 ? strings : undefined
}

function extractProofMap(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const entries = Object.entries(value).map(([criterion, proof]) => `${criterion}: ${String(proof)}`)

  return entries.length > 0 ? entries : undefined
}

function isPassingTestResult(evidence: Evidence): boolean {
  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode === 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function extractFileCandidates(payload: Record<string, unknown>): string[] {
  const values = [
    payload.filePath,
    payload.path,
    payload.file,
    payload.files,
    payload.changedFiles,
    payload.paths,
  ]

  return values.flatMap((value) => {
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string")

    return []
  })
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\\/g, "/")
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
