import { createRunicCovenant, type RunicCovenant } from "./covenant.js"
import { deriveLoopPulse, type LoopPulse } from "./loop-pulse.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { Evidence, EvidenceType, MissionGraph, MissionTask } from "./types.js"

export type ProofPlanStatus = "idle" | "not-needed" | "needs-proof" | "needs-repair"
export type ProofPlanCommandKind =
  | "impact-test"
  | "rerun-diagnostic"
  | "rerun-stale-proof"
  | "typecheck"
  | "lint"
  | "test"
  | "build"

export type ProofPlanCommand = {
  id: string
  kind: ProofPlanCommandKind
  label: string
  command: string
  reason: string
  evidenceType: EvidenceType
}

export type ProofPlanOptions = {
  packageManager?: string
  scripts?: Record<string, string>
  repositoryFiles?: string[]
}

export type ProofPlan = {
  status: ProofPlanStatus
  summary: string
  handoff: string
  missionId?: string
  taskId?: string
  missingEvidence: EvidenceType[]
  diagnostics: string[]
  commands: ProofPlanCommand[]
}

export function deriveProofPlan(
  snapshot: RuntimeSnapshot,
  options: ProofPlanOptions = {},
  covenant: RunicCovenant = createRunicCovenant(),
): ProofPlan {
  const pulse = deriveLoopPulse(snapshot, covenant)
  const selected = selectProofTarget(snapshot, pulse)

  if (!selected) {
    return {
      status: "idle",
      summary: "No active mission needs proof.",
      handoff: "No proof run is needed until a mission has active work.",
      missingEvidence: [],
      diagnostics: [],
      commands: [],
    }
  }

  const evidence = sortEvidenceNewest(
    Object.values(snapshot.ledgers[selected.graph.mission.id]?.evidence ?? {})
      .filter((entry) => entry.taskId === selected.task.id),
  )
  const diagnostics = evidence.filter((entry) => entry.type === "diagnostic").map((entry) => entry.summary).slice(0, 3)
  const latestDiagnosticCommand = firstDiagnosticCommand(evidence)
  const latestPassingProofCommand = firstPassingTestCommand(evidence)
  const changedFiles = extractChangedFiles(evidence)
  const needsRepair = pulse.nextAction.id === "repair-diagnostic" || pulse.nextAction.id === "review-faultline"
  const needsTestProof = pulse.missingEvidence.includes("test-result")
  const commands = buildProofCommands({
    changedFiles,
    latestDiagnosticCommand: needsRepair ? latestDiagnosticCommand : undefined,
    latestStaleProofCommand: needsRepair ? undefined : latestPassingProofCommand,
    needsTestProof,
    options,
  })
  const status = needsRepair ? "needs-repair" : needsTestProof ? "needs-proof" : "not-needed"

  return {
    status,
    summary: buildSummary(status, selected.task, commands),
    handoff: buildHandoff(status, selected.task, commands),
    missionId: selected.graph.mission.id,
    taskId: selected.task.id,
    missingEvidence: pulse.missingEvidence,
    diagnostics,
    commands,
  }
}

export function buildProofPlanPrompt(
  snapshot: RuntimeSnapshot,
  options: ProofPlanOptions = {},
  covenant: RunicCovenant = createRunicCovenant(),
): string {
  const plan = deriveProofPlan(snapshot, options, covenant)
  const commandLines = plan.commands.length > 0
    ? plan.commands.map((command, index) => `${index + 1}. ${command.label}: ${command.command} (${command.reason})`)
    : ["none"]

  return [
    "## Runesmith Proof Plan",
    `Status: ${plan.status}`,
    `Mission: ${plan.missionId ?? "none"}`,
    `Task: ${plan.taskId ?? "none"}`,
    `Handoff: ${plan.handoff}`,
    `Missing evidence: ${formatList(plan.missingEvidence)}`,
    `Diagnostics: ${formatList(plan.diagnostics)}`,
    "Commands:",
    ...commandLines,
  ].join("\n")
}

function selectProofTarget(
  snapshot: RuntimeSnapshot,
  pulse: LoopPulse,
): { graph: MissionGraph; task: MissionTask } | undefined {
  const graph = pulse.missionId
    ? snapshot.graphs[pulse.missionId]
    : Object.values(snapshot.graphs).find((candidate) => !isTerminalMission(candidate))
  if (!graph) return undefined

  const task = pulse.taskId && graph.tasks[pulse.taskId]
    ? graph.tasks[pulse.taskId]
    : Object.values(graph.tasks).find((candidate) => !isTerminalTask(candidate))
  if (!task) return undefined

  return { graph, task }
}

function buildProofCommands(input: {
  changedFiles: string[]
  latestDiagnosticCommand?: string
  latestStaleProofCommand?: string
  needsTestProof: boolean
  options: ProofPlanOptions
}): ProofPlanCommand[] {
  if (!input.needsTestProof && !input.latestDiagnosticCommand && !input.latestStaleProofCommand) return []

  const commands: ProofPlanCommand[] = []
  if (input.latestDiagnosticCommand) {
    commands.push({
      id: "rerun-diagnostic",
      kind: "rerun-diagnostic",
      label: "Rerun failing command",
      command: input.latestDiagnosticCommand,
      reason: "Prove the latest diagnostic is repaired before broad verification.",
      evidenceType: "test-result",
    })
  }
  if (input.needsTestProof && input.latestStaleProofCommand) {
    commands.push({
      id: "rerun-stale-proof",
      kind: "rerun-stale-proof",
      label: "Rerun stale proof",
      command: input.latestStaleProofCommand,
      reason: "Refresh the last targeted passing proof after newer task evidence invalidated it.",
      evidenceType: "test-result",
    })
  }
  for (const command of impactProofCommands(input.changedFiles, input.options)) {
    if (!commands.some((existing) => existing.command === command.command)) {
      commands.push(command)
    }
  }

  for (const command of scriptProofCommands(input.options)) {
    if (!commands.some((existing) => existing.command === command.command)) {
      commands.push(command)
    }
  }

  return commands
}

function impactProofCommands(changedFiles: string[], options: ProofPlanOptions): ProofPlanCommand[] {
  const impacts = selectImpactedTests(changedFiles, options.repositoryFiles)

  return impacts.map((impact, index) => ({
    id: `impact-test-${index + 1}`,
    kind: "impact-test",
    label: "Run impacted test",
    command: testFileCommand(impact.testFile, options.packageManager),
    reason: `Run the nearest proof target for changed file ${impact.changedFile} before broad verification.`,
    evidenceType: "test-result",
  }))
}

function scriptProofCommands(options: ProofPlanOptions): ProofPlanCommand[] {
  const scripts = options.scripts ?? {}
  const commands: ProofPlanCommand[] = []
  const typecheck = scriptCommand("typecheck", options.packageManager, scripts)
  const lint = scriptCommand("lint", options.packageManager, scripts)
  const test = scriptCommand("test", options.packageManager, scripts) ?? "bun test"
  const build = scriptCommand("build", options.packageManager, scripts)

  if (typecheck) {
    commands.push({
      id: "typecheck",
      kind: "typecheck",
      label: "Run typecheck",
      command: typecheck,
      reason: "Catch contract and API drift before completion proof.",
      evidenceType: "test-result",
    })
  }

  if (lint) {
    commands.push({
      id: "lint",
      kind: "lint",
      label: "Run lint",
      command: lint,
      reason: "Catch style, safety, and static-analysis drift before completion proof.",
      evidenceType: "test-result",
    })
  }

  commands.push({
    id: "test",
    kind: "test",
    label: "Run tests",
    command: test,
    reason: "Attach passing test-result evidence for the active task.",
    evidenceType: "test-result",
  })

  if (build) {
    commands.push({
      id: "build",
      kind: "build",
      label: "Run build",
      command: build,
      reason: "Prove the production artifact still builds.",
      evidenceType: "test-result",
    })
  }

  return commands
}

function selectImpactedTests(
  changedFiles: string[],
  repositoryFiles: string[] | undefined,
): Array<{ changedFile: string; testFile: string }> {
  const repositoryFileSet = repositoryFiles
    ? new Set(repositoryFiles.map(normalizePath).filter(Boolean))
    : undefined
  const selected: Array<{ changedFile: string; testFile: string }> = []
  const seen = new Set<string>()

  for (const changedFile of changedFiles.map(normalizePath).filter(Boolean)) {
    const candidates = isTestFile(changedFile)
      ? [changedFile]
      : repositoryFileSet
        ? sourceTestCandidates(changedFile).filter((candidate) => repositoryFileSet.has(candidate))
        : []

    for (const candidate of candidates) {
      if (seen.has(candidate)) continue
      seen.add(candidate)
      selected.push({ changedFile, testFile: candidate })
      break
    }
  }

  return selected
}

function sourceTestCandidates(filePath: string): string[] {
  const extensionMatch = filePath.match(/\.[cm]?[jt]sx?$/)
  if (!extensionMatch) return []

  const extension = extensionMatch[0]
  const withoutExtension = filePath.slice(0, -extension.length)
  const basename = withoutExtension.split("/").pop()
  if (!basename || isTestFile(filePath)) return []

  const candidates: string[] = []
  for (const suffix of [".test", ".spec"]) {
    candidates.push(`${withoutExtension}${suffix}${extension}`)
  }

  const srcMarker = "/src/"
  const srcIndex = filePath.indexOf(srcMarker)
  if (srcIndex >= 0) {
    const packageRoot = filePath.slice(0, srcIndex)
    const relativeSource = withoutExtension.slice(srcIndex + srcMarker.length)
    for (const suffix of [".test", ".spec"]) {
      candidates.push(`${packageRoot}/tests/${relativeSource}${suffix}${extension}`)
      candidates.push(`${packageRoot}/__tests__/${relativeSource}${suffix}${extension}`)
    }
  }

  return candidates
}

function scriptCommand(
  scriptName: "typecheck" | "lint" | "test" | "build",
  packageManager: string | undefined,
  scripts: Record<string, string>,
): string | undefined {
  if (!scripts[scriptName]) return undefined

  const pm = normalizePackageManager(packageManager)
  if (pm === "bun") return scriptName === "test" ? "bun test" : `bun run ${scriptName}`
  if (pm === "yarn") return scriptName === "test" ? "yarn test" : `yarn ${scriptName}`
  if (pm === "pnpm") return scriptName === "test" ? "pnpm test" : `pnpm run ${scriptName}`

  return scriptName === "test" ? "npm test" : `npm run ${scriptName}`
}

function testFileCommand(filePath: string, packageManager: string | undefined): string {
  const pm = normalizePackageManager(packageManager)
  const target = quoteShellArg(filePath)

  if (pm === "bun") return `bun test ${target}`
  if (pm === "pnpm") return `pnpm test -- ${target}`
  if (pm === "yarn") return `yarn test ${target}`

  return `npm test -- ${target}`
}

function normalizePackageManager(packageManager: string | undefined): "bun" | "npm" | "pnpm" | "yarn" {
  const name = packageManager?.split("@", 1)[0]?.toLowerCase()
  if (name === "npm" || name === "pnpm" || name === "yarn") return name

  return "bun"
}

function buildSummary(status: ProofPlanStatus, task: MissionTask, commands: ProofPlanCommand[]): string {
  if (status === "not-needed") return `${task.id} does not need a proof run right now.`
  return `${task.id} proof plan has ${commands.length} command${commands.length === 1 ? "" : "s"}.`
}

function buildHandoff(status: ProofPlanStatus, task: MissionTask, commands: ProofPlanCommand[]): string {
  if (status === "not-needed") return `No proof run is needed for ${task.id} right now.`
  if (commands.length === 0) return `No proof command could be derived for ${task.id}.`

  return `Run proof for ${task.id}: ${commands.map((command) => command.command).join(" -> ")}.`
}

function firstDiagnosticCommand(evidence: Evidence[]): string | undefined {
  for (const entry of evidence) {
    if (entry.type !== "diagnostic") continue
    const command = entry.payload.command
    if (typeof command === "string" && command.trim().length > 0) {
      return command.trim()
    }
  }

  return undefined
}

function firstPassingTestCommand(evidence: Evidence[]): string | undefined {
  for (const entry of evidence) {
    if (entry.type !== "test-result" || !isPassingTestResult(entry)) continue
    const command = entry.payload.command
    if (typeof command === "string" && command.trim().length > 0) {
      return command.trim()
    }
  }

  return undefined
}

function isPassingTestResult(evidence: Evidence): boolean {
  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode === 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function extractChangedFiles(evidence: Evidence[]): string[] {
  const files: string[] = []

  for (const entry of evidence) {
    if (entry.type !== "file-change") continue

    for (const candidate of extractFileCandidates(entry.payload)) {
      const normalized = normalizePath(candidate)
      if (normalized) files.push(normalized)
    }
  }

  return [...new Set(files)]
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

function isTestFile(filePath: string): boolean {
  return /(^|\/)(tests?|__tests__)\/.+\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath)
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@+-]+$/.test(value)) return value

  return `"${value.replace(/"/g, '\\"')}"`
}

function sortEvidenceNewest(evidence: Evidence[]): Evidence[] {
  return evidence
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const createdAtDelta = right.entry.createdAt.localeCompare(left.entry.createdAt)
      return createdAtDelta || right.index - left.index
    })
    .map(({ entry }) => entry)
}

function isTerminalMission(graph: MissionGraph): boolean {
  return ["complete", "failed", "cancelled"].includes(graph.mission.status)
}

function isTerminalTask(task: MissionTask): boolean {
  return ["complete", "failed", "cancelled"].includes(task.status)
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
