import { createRunicCovenant, type RunicCovenant } from "./covenant"
import { deriveLoopPulse, type LoopPulse } from "./loop-pulse"
import type { RuntimeSnapshot } from "./runtime"
import type { Evidence, EvidenceType, MissionGraph, MissionTask } from "./types"

export type ProofPlanStatus = "idle" | "not-needed" | "needs-proof" | "needs-repair"
export type ProofPlanCommandKind =
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

  const evidence = Object.values(snapshot.ledgers[selected.graph.mission.id]?.evidence ?? {})
    .filter((entry) => entry.taskId === selected.task.id)
    .sort(compareEvidenceNewest)
  const diagnostics = evidence.filter((entry) => entry.type === "diagnostic").map((entry) => entry.summary).slice(0, 3)
  const latestDiagnosticCommand = firstDiagnosticCommand(evidence)
  const latestPassingProofCommand = firstPassingTestCommand(evidence)
  const needsRepair = pulse.nextAction.id === "repair-diagnostic"
  const needsTestProof = pulse.missingEvidence.includes("test-result")
  const commands = buildProofCommands({
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

  for (const command of scriptProofCommands(input.options)) {
    if (!commands.some((existing) => existing.command === command.command)) {
      commands.push(command)
    }
  }

  return commands
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

function compareEvidenceNewest(left: Evidence, right: Evidence): number {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
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
