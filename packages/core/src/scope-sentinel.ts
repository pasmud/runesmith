import type { RuntimeSnapshot } from "./runtime"
import type { Evidence, MissionGraph, MissionTask } from "./types"

export type ScopeSentinelStatus = "idle" | "clear" | "attention" | "blocked"
export type ScopeSentinelFindingSeverity = "critical" | "warning" | "info"
export type ScopeSentinelChangeStatus = "in-scope" | "out-of-scope" | "unknown"

export type ScopeSentinelFinding = {
  severity: ScopeSentinelFindingSeverity
  summary: string
  path?: string
}

export type ScopeSentinelChange = {
  evidenceId: string
  path: string
  status: ScopeSentinelChangeStatus
}

export type ScopeSentinel = {
  status: ScopeSentinelStatus
  summary: string
  missionId?: string
  taskId?: string
  agentId?: string
  allowedScopes: string[]
  changes: ScopeSentinelChange[]
  findings: ScopeSentinelFinding[]
}

export function deriveScopeSentinel(snapshot: RuntimeSnapshot): ScopeSentinel {
  const selected = selectScopeTarget(snapshot)
  if (!selected) {
    return {
      status: "idle",
      summary: "No active task is available for scope review.",
      allowedScopes: [],
      changes: [],
      findings: [],
    }
  }

  const contract = selected.task.assignedAgentId ? snapshot.contracts[selected.task.assignedAgentId] : undefined
  const allowedScopes = contract?.fileScope ?? []
  const evidence = Object.values(snapshot.ledgers[selected.graph.mission.id]?.evidence ?? {})
    .filter((entry) => entry.taskId === selected.task.id && entry.type === "file-change")
    .sort(compareEvidenceOldest)
  const changes = extractScopeChanges(evidence, allowedScopes)
  const findings = buildFindings(selected.task, contract?.id, allowedScopes, changes)
  const status = selectStatus(contract?.id, allowedScopes, changes, findings)

  return {
    status,
    missionId: selected.graph.mission.id,
    taskId: selected.task.id,
    agentId: contract?.id ?? selected.task.assignedAgentId,
    allowedScopes: [...allowedScopes],
    changes,
    findings,
    summary: buildSummary(selected.task, status, changes, findings),
  }
}

export function buildScopeSentinelPrompt(snapshot: RuntimeSnapshot): string {
  const sentinel = deriveScopeSentinel(snapshot)
  const allowedScopes = sentinel.allowedScopes.length > 0 ? sentinel.allowedScopes.join(", ") : "none"
  const changes = sentinel.changes.length > 0
    ? sentinel.changes.map((change) => `- ${change.path}: ${change.status} (${change.evidenceId})`)
    : ["- none"]
  const findings = sentinel.findings.length > 0
    ? sentinel.findings.map((finding) => `- ${finding.severity}: ${finding.summary}`)
    : ["- none"]

  return [
    "## Runesmith Scope Sentinel",
    `Status: ${sentinel.status}`,
    `Mission: ${sentinel.missionId ?? "none"}`,
    `Task: ${sentinel.taskId ?? "none"}`,
    `Agent: ${sentinel.agentId ?? "none"}`,
    `Allowed scopes: ${allowedScopes}`,
    `Summary: ${sentinel.summary}`,
    "Changes:",
    ...changes,
    "Findings:",
    ...findings,
    "Directive: Treat out-of-scope changes as review blockers until they are reverted, justified, or the contract scope is updated.",
  ].join("\n")
}

function selectScopeTarget(snapshot: RuntimeSnapshot): { graph: MissionGraph; task: MissionTask } | undefined {
  return Object.values(snapshot.graphs)
    .filter((graph) => !["complete", "failed", "cancelled"].includes(graph.mission.status))
    .flatMap((graph) => {
      const implementation = selectImplementationTask(graph)
      return implementation ? [{ graph, task: implementation }] : []
    })
    .sort((left, right) => {
      return right.graph.mission.updatedAt.localeCompare(left.graph.mission.updatedAt)
        || left.graph.mission.id.localeCompare(right.graph.mission.id)
    })[0]
}

function selectImplementationTask(graph: MissionGraph): MissionTask | undefined {
  const tasks = Object.values(graph.tasks)

  return tasks.find((task) => task.title.toLowerCase().startsWith("forge:"))
    ?? graph.tasks[graph.mission.rootTaskId]
    ?? tasks[0]
}

function extractScopeChanges(evidence: Evidence[], allowedScopes: string[]): ScopeSentinelChange[] {
  const seen = new Set<string>()
  const changes: ScopeSentinelChange[] = []

  for (const entry of evidence) {
    for (const path of extractChangedPaths(entry.payload)) {
      const normalized = normalizePath(path)
      if (!normalized || seen.has(normalized)) continue
      seen.add(normalized)
      changes.push({
        evidenceId: entry.id,
        path: normalized,
        status: classifyPath(normalized, allowedScopes),
      })
    }
  }

  return changes
}

function extractChangedPaths(payload: Record<string, unknown>): string[] {
  const paths = [
    payload.filePath,
    payload.file,
    payload.path,
    payload.target,
    payload.files,
    payload.paths,
    payload.changedFiles,
  ]

  return paths.flatMap(extractStringValues)
}

function extractStringValues(value: unknown): string[] {
  if (typeof value === "string") return [value]
  if (Array.isArray(value)) return value.flatMap(extractStringValues)

  return []
}

function classifyPath(path: string, allowedScopes: string[]): ScopeSentinelChangeStatus {
  if (allowedScopes.length === 0) return "unknown"
  return allowedScopes.some((scope) => pathMatchesScope(path, scope)) ? "in-scope" : "out-of-scope"
}

function pathMatchesScope(path: string, scope: string): boolean {
  const normalizedScope = normalizePath(scope)
  if (!normalizedScope || normalizedScope === "*" || normalizedScope === "**") return true

  if (normalizedScope.endsWith("/**")) {
    const base = normalizedScope.slice(0, -3)
    return path === base || path.startsWith(`${base}/`) || path.includes(`/${base}/`)
  }

  if (!normalizedScope.includes("*")) {
    return path === normalizedScope || path.endsWith(`/${normalizedScope}`)
  }

  const wildcard = normalizedScope
    .split("*")
    .map(escapeRegExp)
    .join(".*")
  const expression = new RegExp(`(^|/)${wildcard}$`)

  return expression.test(path)
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").trim()
}

function buildFindings(
  task: MissionTask,
  agentId: string | undefined,
  allowedScopes: string[],
  changes: ScopeSentinelChange[],
): ScopeSentinelFinding[] {
  const findings: ScopeSentinelFinding[] = []
  const agent = agentId ?? task.assignedAgentId ?? "unassigned agent"

  if (!agentId) {
    findings.push({
      severity: "warning",
      summary: `${task.id} has no assigned contract, so file scope cannot be enforced.`,
    })
  } else if (allowedScopes.length === 0) {
    findings.push({
      severity: "warning",
      summary: `${agent} has no file scope configured.`,
    })
  }

  for (const change of changes) {
    if (change.status === "out-of-scope") {
      findings.push({
        severity: "critical",
        summary: `${change.path} is outside ${agent} file scope.`,
        path: change.path,
      })
    } else if (change.status === "unknown") {
      findings.push({
        severity: "warning",
        summary: `${change.path} cannot be checked because no file scope is configured.`,
        path: change.path,
      })
    }
  }

  return findings
}

function selectStatus(
  agentId: string | undefined,
  allowedScopes: string[],
  changes: ScopeSentinelChange[],
  findings: ScopeSentinelFinding[],
): ScopeSentinelStatus {
  if (findings.some((finding) => finding.severity === "critical")) return "blocked"
  if (!agentId || allowedScopes.length === 0 || changes.length === 0) return "attention"
  if (changes.some((change) => change.status === "unknown")) return "attention"

  return "clear"
}

function buildSummary(
  task: MissionTask,
  status: ScopeSentinelStatus,
  changes: ScopeSentinelChange[],
  findings: ScopeSentinelFinding[],
): string {
  if (status === "blocked") {
    const criticalCount = findings.filter((finding) => finding.severity === "critical").length
    return `${task.id} has ${criticalCount} out-of-scope change${criticalCount === 1 ? "" : "s"}.`
  }

  if (changes.length === 0) {
    return `${task.id} has no file-change evidence to scope yet.`
  }

  if (status === "attention") {
    return `${task.id} changed ${changes.length} file${changes.length === 1 ? "" : "s"} with incomplete scope coverage.`
  }

  return `${task.id} changed ${changes.length} file${changes.length === 1 ? "" : "s"} inside scope.`
}

function compareEvidenceOldest(left: Evidence, right: Evidence): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
