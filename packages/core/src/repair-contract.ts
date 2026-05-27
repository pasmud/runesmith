import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, MissionGraph, MissionTask } from "./types.js"

export type RepairContractStatus =
  | "idle"
  | "awaiting-repair"
  | "ready-for-proof"
  | "over-broad"
  | "proven"
  | "faultline"

export type RepairContract = {
  status: RepairContractStatus
  summary: string
  missionId?: string
  taskId?: string
  diagnostic?: string
  failingCommand?: string
  failedAttempts: number
  repairChanges: string[]
  warnings: string[]
  passingProof?: string
  latestDiagnosticAt?: string
  latestRepairAt?: string
  latestProofAt?: string
}

export function deriveRepairContract(snapshot: RuntimeSnapshot): RepairContract {
  const graph = selectGraph(snapshot)
  if (!graph) {
    return idle("No mission is active for a Repair Contract.")
  }

  const task = selectImplementationTask(graph)
  if (!task) {
    return idle(`${graph.mission.id} has no implementation task for a Repair Contract.`, graph.mission.id)
  }

  const evidence = sortEvidence(
    Object.values(snapshot.ledgers[graph.mission.id]?.evidence ?? {})
      .filter((entry) => entry.taskId === task.id),
  )
  const latestDiagnosticIndex = latestIndex(evidence, isDiagnosticEvidence)
  if (latestDiagnosticIndex < 0) {
    return {
      status: "idle",
      missionId: graph.mission.id,
      taskId: task.id,
      summary: `No active failed diagnostic is waiting for repair on ${task.id}.`,
      failedAttempts: 0,
      repairChanges: [],
      warnings: [],
    }
  }

  const latestDiagnostic = evidence[latestDiagnosticIndex]!
  const latestPassingProofBeforeDiagnosticIndex = latestIndex(
    evidence.slice(0, latestDiagnosticIndex),
    isPassingProof,
  )
  const diagnosticsSinceProof = evidence
    .slice(latestPassingProofBeforeDiagnosticIndex + 1, latestDiagnosticIndex + 1)
    .filter(isDiagnosticEvidence)
  const evidenceAfterDiagnostic = evidence.slice(latestDiagnosticIndex + 1)
  const passingProofAfterDiagnostic = evidenceAfterDiagnostic.find(isPassingProof)
  const repairChanges = collectRepairChanges(
    passingProofAfterDiagnostic
      ? evidenceAfterDiagnostic.slice(0, evidenceAfterDiagnostic.indexOf(passingProofAfterDiagnostic))
      : evidenceAfterDiagnostic,
  )
  const failedAttempts = diagnosticsSinceProof.length
  const diagnosticSummary = latestDiagnostic.summary.trim() || `diagnostic evidence ${latestDiagnostic.id}`
  const failingCommand = extractCommand(latestDiagnostic)

  if (failedAttempts >= 3 && !passingProofAfterDiagnostic) {
    return {
      status: "faultline",
      missionId: graph.mission.id,
      taskId: task.id,
      diagnostic: diagnosticSummary,
      failingCommand,
      failedAttempts,
      repairChanges,
      warnings: ["Stop ordinary repair and resolve the Faultline architecture question before another patch."],
      latestDiagnosticAt: latestDiagnostic.createdAt,
      latestRepairAt: latestRepairAt(evidenceAfterDiagnostic),
      summary: `Repair contract escalated for ${task.id}: ${failedAttempts} failed proof attempts require Faultline architecture review before another patch.`,
    }
  }

  if (passingProofAfterDiagnostic && repairChanges.length > 0) {
    return {
      status: "proven",
      missionId: graph.mission.id,
      taskId: task.id,
      diagnostic: diagnosticSummary,
      failingCommand,
      failedAttempts,
      repairChanges,
      warnings: [],
      passingProof: passingProofAfterDiagnostic.summary.trim() || `proof evidence ${passingProofAfterDiagnostic.id}`,
      latestDiagnosticAt: latestDiagnostic.createdAt,
      latestRepairAt: latestRepairAt(evidenceAfterDiagnostic),
      latestProofAt: passingProofAfterDiagnostic.createdAt,
      summary: `Repair contract proven for ${task.id}: passing proof followed the diagnostic and repair edit.`,
    }
  }

  if (repairChanges.length === 0) {
    return {
      status: "awaiting-repair",
      missionId: graph.mission.id,
      taskId: task.id,
      diagnostic: diagnosticSummary,
      failingCommand,
      failedAttempts,
      repairChanges: [],
      warnings: ["Record a scoped repair edit before rerunning the failing proof."],
      latestDiagnosticAt: latestDiagnostic.createdAt,
      summary: `Repair contract waiting for ${task.id}: state a hypothesis, change one repair variable, then rerun ${failingCommand ?? "the failing proof"}.`,
    }
  }

  if (repairChanges.length > 1) {
    return {
      status: "over-broad",
      missionId: graph.mission.id,
      taskId: task.id,
      diagnostic: diagnosticSummary,
      failingCommand,
      failedAttempts,
      repairChanges,
      warnings: ["Keep Faultwright repairs to one variable before rerunning the failing proof."],
      latestDiagnosticAt: latestDiagnostic.createdAt,
      latestRepairAt: latestRepairAt(evidenceAfterDiagnostic),
      summary: `Repair contract over-broad for ${task.id}: ${repairChanges.length} implementation files changed before proof reran.`,
    }
  }

  return {
    status: "ready-for-proof",
    missionId: graph.mission.id,
    taskId: task.id,
    diagnostic: diagnosticSummary,
    failingCommand,
    failedAttempts,
    repairChanges,
    warnings: [],
    latestDiagnosticAt: latestDiagnostic.createdAt,
    latestRepairAt: latestRepairAt(evidenceAfterDiagnostic),
    summary: `Repair contract ready for ${task.id}: one repair variable changed after the diagnostic; rerun ${failingCommand ?? "the failing proof"}.`,
  }
}

export function buildRepairContractPrompt(snapshot: RuntimeSnapshot): string {
  const contract = deriveRepairContract(snapshot)

  return [
    "## Runesmith Repair Contract",
    `Status: ${contract.status}`,
    `Mission: ${contract.missionId ?? "none"}`,
    `Task: ${contract.taskId ?? "none"}`,
    `Summary: ${contract.summary}`,
    `Diagnostic: ${contract.diagnostic ?? "none"}`,
    `Failing command: ${contract.failingCommand ?? "none"}`,
    `Failed attempts: ${contract.failedAttempts}`,
    `Repair changes: ${formatList(contract.repairChanges)}`,
    `Passing proof: ${contract.passingProof ?? "none"}`,
    `Warnings: ${formatList(contract.warnings)}`,
    "Directive: Keep repair hypothesis-linked, one-variable, and tied to the exact failing command before broad proof.",
  ].join("\n")
}

function idle(summary: string, missionId?: string): RepairContract {
  return {
    status: "idle",
    missionId,
    summary,
    failedAttempts: 0,
    repairChanges: [],
    warnings: [],
  }
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

function collectRepairChanges(evidence: Evidence[]): string[] {
  const changes: string[] = []

  for (const entry of evidence) {
    if (entry.type !== "file-change") continue

    for (const filePath of extractFilePaths(entry.payload)) {
      if (!isImplementationFile(filePath)) continue
      changes.push(filePath)
    }
  }

  return [...new Set(changes)]
}

function latestRepairAt(evidence: Evidence[]): string | undefined {
  return evidence
    .filter((entry) => entry.type === "file-change" && extractFilePaths(entry.payload).some(isImplementationFile))
    .at(-1)?.createdAt
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

  return files.map(normalizePath).filter(Boolean)
}

function isImplementationFile(filePath: string): boolean {
  if (isTestFile(filePath)) return false

  return /\.(c|cc|cpp|cs|css|go|java|js|jsx|kt|kts|mjs|mts|php|py|rb|rs|scss|swift|ts|tsx)$/.test(filePath)
}

function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
}

function isDiagnosticEvidence(evidence: Evidence): boolean {
  if (evidence.type === "diagnostic") return true
  if (evidence.type !== "test-result") return false

  return !isPassingProof(evidence)
}

function isPassingProof(evidence: Evidence): boolean {
  if (evidence.type !== "test-result") return false

  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode === 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function extractCommand(evidence: Evidence): string | undefined {
  const command = evidence.payload.command
  if (typeof command === "string" && command.trim().length > 0) return command.trim()

  return undefined
}

function latestIndex<T>(values: T[], predicate: (value: T) => boolean): number {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index]!)) return index
  }

  return -1
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
