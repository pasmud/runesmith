import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, MissionGraph, MissionTask } from "./types.js"

export type RedlineProofStatus = "idle" | "not-applicable" | "satisfied" | "missing"

export type RedlineProof = {
  status: RedlineProofStatus
  summary: string
  missionId?: string
  taskId?: string
  implementationChanges: string[]
  proofSignals: string[]
  earliestImplementationAt?: string
  earliestProofAt?: string
}

export function deriveRedlineProof(snapshot: RuntimeSnapshot): RedlineProof {
  const graph = selectGraph(snapshot)
  if (!graph) {
    return {
      status: "idle",
      summary: "No mission is active for Redline Proof.",
      implementationChanges: [],
      proofSignals: [],
    }
  }

  const task = selectImplementationTask(graph)
  if (!task) {
    return {
      status: "idle",
      missionId: graph.mission.id,
      summary: `${graph.mission.id} has no implementation task for Redline Proof.`,
      implementationChanges: [],
      proofSignals: [],
    }
  }

  const evidence = sortEvidence(
    Object.values(snapshot.ledgers[graph.mission.id]?.evidence ?? {})
      .filter((entry) => entry.taskId === task.id),
  )
  const implementationChanges = collectImplementationChanges(evidence)
  if (implementationChanges.length === 0) {
    return {
      status: "not-applicable",
      missionId: graph.mission.id,
      taskId: task.id,
      summary: `Redline Proof not required for ${task.id}: no implementation file changes are captured.`,
      implementationChanges: [],
      proofSignals: collectProofSignals(evidence).map((signal) => signal.summary),
    }
  }

  const firstImplementation = implementationChanges[0]!
  const proofSignals = collectProofSignals(evidence)
  const qualifyingProof = proofSignals.find((signal) => signal.createdAt <= firstImplementation.createdAt)
  if (qualifyingProof) {
    const summary = qualifyingProof.kind === "test-file"
      ? `Redline Proof satisfied for ${task.id}: focused proof file changed before implementation.`
      : `Redline Proof satisfied for ${task.id}: focused failing proof preceded implementation changes.`

    return {
      status: "satisfied",
      missionId: graph.mission.id,
      taskId: task.id,
      summary,
      implementationChanges: implementationChanges.map((change) => change.path),
      proofSignals: proofSignals.map((signal) => signal.summary),
      earliestImplementationAt: firstImplementation.createdAt,
      earliestProofAt: qualifyingProof.createdAt,
    }
  }

  return {
    status: "missing",
    missionId: graph.mission.id,
    taskId: task.id,
    summary: `Redline Proof missing for ${task.id}: implementation changed before focused failing proof was captured.`,
    implementationChanges: implementationChanges.map((change) => change.path),
    proofSignals: proofSignals.map((signal) => signal.summary),
    earliestImplementationAt: firstImplementation.createdAt,
    earliestProofAt: proofSignals[0]?.createdAt,
  }
}

export function buildRedlineProofPrompt(snapshot: RuntimeSnapshot): string {
  const redline = deriveRedlineProof(snapshot)

  return [
    "## Runesmith Redline Proof",
    `Status: ${redline.status}`,
    `Mission: ${redline.missionId ?? "none"}`,
    `Task: ${redline.taskId ?? "none"}`,
    `Summary: ${redline.summary}`,
    `Implementation changes: ${formatList(redline.implementationChanges)}`,
    `Proof signals: ${formatList(redline.proofSignals)}`,
    "Directive: Prefer a focused failing proof or proof-file edit before implementation changes. Treat missing Redline Proof as a review finding, not transcript trivia.",
  ].join("\n")
}

function selectGraph(snapshot: RuntimeSnapshot): MissionGraph | undefined {
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

function collectImplementationChanges(evidence: Evidence[]): Array<{ path: string; createdAt: string }> {
  const changes: Array<{ path: string; createdAt: string }> = []

  for (const entry of evidence) {
    if (entry.type !== "file-change") continue

    for (const filePath of extractFilePaths(entry.payload)) {
      if (!isImplementationFile(filePath)) continue
      changes.push({ path: filePath, createdAt: entry.createdAt })
    }
  }

  return uniquePathSignals(changes)
}

function collectProofSignals(evidence: Evidence[]): Array<{ summary: string; createdAt: string; kind: "diagnostic" | "test-file" }> {
  const signals: Array<{ summary: string; createdAt: string; kind: "diagnostic" | "test-file" }> = []

  for (const entry of evidence) {
    if (entry.type === "diagnostic" && isFailingEvidence(entry)) {
      signals.push({
        summary: entry.summary,
        createdAt: entry.createdAt,
        kind: "diagnostic",
      })
      continue
    }

    if (entry.type !== "file-change") continue
    for (const filePath of extractFilePaths(entry.payload)) {
      if (!isTestFile(filePath)) continue
      signals.push({
        summary: filePath,
        createdAt: entry.createdAt,
        kind: "test-file",
      })
    }
  }

  return signals
}

function extractFilePaths(payload: Record<string, unknown>): string[] {
  const values = [
    payload.filePath,
    payload.path,
    payload.file,
    payload.files,
    payload.changedFiles,
    payload.paths,
  ]

  const files = values.flatMap((value) => {
    if (typeof value === "string") return [value]
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string")

    return []
  })

  return [...new Set(files.map(normalizePath).filter(Boolean))]
}

function isImplementationFile(filePath: string): boolean {
  if (isTestFile(filePath)) return false

  return /\.(c|cc|cpp|cs|css|go|java|js|jsx|kt|kts|mjs|mts|php|py|rb|rs|scss|swift|ts|tsx)$/.test(filePath)
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
}

function isFailingEvidence(evidence: Evidence): boolean {
  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode !== 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return true

  return !["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function uniquePathSignals<T extends { path: string; createdAt: string }>(signals: T[]): T[] {
  const seen = new Set<string>()

  return signals.filter((signal) => {
    const key = `${signal.path}:${signal.createdAt}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\//, "")
}

function sortEvidence(evidence: Evidence[]): Evidence[] {
  return evidence
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => left.entry.createdAt.localeCompare(right.entry.createdAt) || left.index - right.index)
    .map(({ entry }) => entry)
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
