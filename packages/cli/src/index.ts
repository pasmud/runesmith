#!/usr/bin/env bun

import { dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import {
  createCovenantDecisionDraft,
  createCovenantTaskPlan,
  createRuntime,
  defaultRuntimeCapsulePath,
  deriveLoopPulse,
  getRequiredEvidenceForTask,
  loadRuntimeCapsule,
  missingRequiredEvidence,
  saveRuntimeCapsule,
  taskDependenciesComplete,
  type AgentContract,
  type Evidence,
  type EvidenceType,
  type IdFactory,
  type Lease,
  type MissionTask,
  type RuntimeSnapshot,
} from "@runesmith/core"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { runDoctor } from "./doctor"
import {
  getDefaultOpenCodeConfigPath,
  getDefaultOpenCodePluginDir,
  isRunesmithPluginEntry,
  parseOptions,
} from "./options"

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CliHost = {
  exists(path: string): boolean | Promise<boolean>
  readText(path: string): string | Promise<string>
  writeText(path: string, text: string): void | Promise<void>
}

export function createMemoryHost(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles))

  return {
    exists(path: string): boolean {
      return files.has(path)
    },
    readText(path: string): string {
      const value = files.get(path)
      if (value === undefined) {
        throw new Error(`File not found: ${path}`)
      }

      return value
    },
    writeText(path: string, text: string): void {
      files.set(path, text)
    },
  }
}

export function createNodeHost(): CliHost {
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await readFile(path, "utf8")
        return true
      } catch {
        return false
      }
    },
    readText(path: string): Promise<string> {
      return readFile(path, "utf8")
    },
    async writeText(path: string, text: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, "utf8")
    },
  }
}

export async function runCli(args: string[], host: CliHost = createNodeHost()): Promise<CliResult> {
  const [command, subcommand, maybeId, ...rest] = args

  if (command === "install") {
    return installRunesmith(args.slice(1), host)
  }

  if (command === "up") {
    return runesmithUp(args.slice(1), host)
  }

  if (command === "init") {
    await writeProjectConfig(host)

    return success("Created .runesmith/config.json\n")
  }

  if (command === "doctor") {
    return runDoctor(args.slice(1), host)
  }

  if (command === "mission" && subcommand === "list") {
    const snapshot = await readSnapshot(host, [maybeId, ...rest].filter((value): value is string => Boolean(value)))
    if (!snapshot.ok) return snapshot.result

    const lines = Object.values(snapshot.value.graphs).map((graph) => {
      return `${graph.mission.id} ${graph.mission.status} ${graph.mission.goal}`
    })

    return success(`${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`)
  }

  if (command === "mission" && subcommand === "start") {
    return startMissionFromCli([maybeId, ...rest].filter((value): value is string => Boolean(value)), host)
  }

  if (command === "mission" && subcommand === "evidence") {
    return recordEvidenceFromCli([maybeId, ...rest].filter((value): value is string => Boolean(value)), host)
  }

  if (command === "mission" && subcommand === "tick") {
    return tickMissionFromCli(host)
  }

  if (command === "mission" && subcommand === "inspect" && maybeId) {
    const snapshot = await readSnapshot(host, rest)
    if (!snapshot.ok) return snapshot.result

    const graph = snapshot.value.graphs[maybeId]
    if (!graph) {
      return failure(`Mission not found: ${maybeId}\n`)
    }

    const pulse = deriveLoopPulse(snapshot.value)
    const taskLines = Object.values(graph.tasks).map((task) => {
      return `- ${task.id} ${task.status} ${task.assignedAgentId ?? "unassigned"} ${task.title}`
    })
    const evidenceLines = formatMissionEvidence(snapshot.value, maybeId)
    const leaseLines = formatMissionLeases(snapshot.value, maybeId)

    return success([
      `Mission ${graph.mission.id}`,
      `Status: ${graph.mission.status}`,
      `Goal: ${graph.mission.goal}`,
      `Loop Pulse: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
      `Next reason: ${pulse.nextAction.reason}`,
      `Required evidence: ${formatList(pulse.requiredEvidence)}`,
      `Missing evidence: ${formatList(pulse.missingEvidence)}`,
      `Active runes: ${formatList(pulse.runes.map((rune) => rune.name))}`,
      "Tasks:",
      ...taskLines,
      "Evidence:",
      ...evidenceLines,
      "Leases:",
      ...leaseLines,
      "",
    ].join("\n"))
  }

  return failure("Usage: runesmith <up|install|init|doctor|mission start|mission evidence|mission tick|mission list|mission inspect>\n")
}

function success(stdout: string): CliResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
  }
}

function failure(stderr: string): CliResult {
  return {
    exitCode: 1,
    stdout: "",
    stderr,
  }
}

type SnapshotReadResult =
  | {
      ok: true
      value: RuntimeSnapshot
    }
  | {
      ok: false
      result: CliResult
    }

const emptySnapshot: RuntimeSnapshot = {
  graphs: {},
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
}

const cliAtlasContract: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent for TypeScript, tests, and repository edits.",
  capabilities: ["typescript", "testing", "repository-maintenance"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "anthropic/claude-sonnet-4.5",
    fallbacks: ["openai/gpt-5.1-codex"],
  },
  fileScope: ["packages/**", "docs/**", "examples/**"],
  completionCriteria: ["Relevant files changed", "Verification command recorded"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: ["agent_oracle"],
}

async function writeProjectConfig(host: CliHost): Promise<void> {
  await host.writeText(".runesmith/config.json", JSON.stringify({
    version: 1,
    runtimeDir: ".runesmith/runtime",
    defaultStaleAfterMs: 120_000,
  }, null, 2))
}

async function ensureProjectConfig(host: CliHost): Promise<void> {
  if (await host.exists(".runesmith/config.json")) return

  await writeProjectConfig(host)
}

async function ensureRuntimeCapsule(host: CliHost): Promise<void> {
  if (await host.exists(defaultRuntimeCapsulePath)) return

  await saveRuntimeCapsule(host, {
    path: defaultRuntimeCapsulePath,
    snapshot: emptySnapshot,
  })
}

async function runesmithUp(args: string[], host: CliHost): Promise<CliResult> {
  await writeProjectConfig(host)
  await ensureRuntimeCapsule(host)

  const install = await installRunesmith(args, host)
  if (install.exitCode !== 0) return install

  const pluginPath = extractOutputValue(install.stdout, "plugin")

  return success([
    "Runesmith OS is ready",
    "config: .runesmith/config.json",
    `plugin: ${pluginPath ?? "installed"}`,
    `runtime: ${defaultRuntimeCapsulePath}`,
    "covenant: automatic",
    "dashboard: bun run dev:dashboard",
    "",
  ].join("\n"))
}

function extractOutputValue(stdout: string, key: string): string | undefined {
  const prefix = `${key}: `
  return stdout
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
}

async function readSnapshot(host: CliHost, args: string[]): Promise<SnapshotReadResult> {
  const snapshotFlagIndex = args.indexOf("--snapshot")
  const snapshotPath = snapshotFlagIndex >= 0 ? args[snapshotFlagIndex + 1] : undefined
  if (!snapshotPath) {
    const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
    if (!capsule.ok) {
      return {
        ok: false,
        result: failure(`${capsule.error.message}\n`),
      }
    }

    return {
      ok: true,
      value: capsule.value?.runtime ?? emptySnapshot,
    }
  }

  const raw = await host.readText(snapshotPath)
  return {
    ok: true,
    value: JSON.parse(raw) as RuntimeSnapshot,
  }
}

async function startMissionFromCli(args: string[], host: CliHost): Promise<CliResult> {
  const goal = parseMissionStartGoal(args)
  if (!goal) {
    return failure("Usage: runesmith mission start <goal>\n")
  }

  const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
  if (!capsule.ok) {
    return failure(`${capsule.error.message}\n`)
  }

  await ensureProjectConfig(host)

  const snapshot = capsule.value?.runtime ?? emptySnapshot
  const runtime = createRuntime({
    snapshot,
    idFactory: createCliIdFactory(snapshot),
  })
  runtime.registerContract(cliAtlasContract)

  const started = runtime.startMission({
    goal,
    taskPlan: createCovenantTaskPlan(goal),
  })
  if (!started.ok) return failure(`${started.error.message}\n`)

  const claimed = runtime.claimTask({
    missionId: started.value.missionId,
    taskId: started.value.rootTaskId,
    contractId: cliAtlasContract.id,
    holder: "runesmith-cli",
    idempotencyKey: `cli:${fingerprint(goal)}`,
    ttlMs: 30_000,
  })
  if (!claimed.ok) return failure(`${claimed.error.message}\n`)

  const snapshotAfterClaim = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: defaultRuntimeCapsulePath,
    snapshot: snapshotAfterClaim,
  })
  const pulse = deriveLoopPulse(snapshotAfterClaim)

  return success([
    "Mission started",
    `mission: ${started.value.missionId}`,
    `task: ${started.value.rootTaskId}`,
    `lease: ${claimed.value.lease.id}`,
    `goal: ${goal}`,
    `next: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
    `runtime: ${defaultRuntimeCapsulePath}`,
    "",
  ].join("\n"))
}

function parseMissionStartGoal(args: string[]): string {
  const goalArgs = args[0] === "--goal" ? args.slice(1) : args

  return goalArgs.join(" ").trim().replace(/\s+/g, " ")
}

function createCliIdFactory(snapshot: RuntimeSnapshot): IdFactory {
  const counts = new Map<string, number>()
  for (const prefix of ["mission", "task", "lease", "event", "evidence"] as const) {
    counts.set(prefix, maxExistingCliId(snapshot, prefix))
  }

  return (prefix) => {
    const count = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, count)

    return `${prefix}_cli_${count}`
  }
}

function maxExistingCliId(snapshot: RuntimeSnapshot, prefix: Parameters<IdFactory>[0]): number {
  const ids = [
    ...Object.keys(snapshot.graphs),
    ...Object.values(snapshot.graphs).flatMap((graph) => [
      ...Object.keys(graph.tasks),
      ...graph.events.map((event) => event.id),
    ]),
    ...Object.values(snapshot.ledgers).flatMap((ledger) => Object.keys(ledger.evidence)),
    ...Object.keys(snapshot.leases.leases),
  ]
  const marker = `${prefix}_cli_`

  return ids.reduce((max, id) => {
    if (!id.startsWith(marker)) return max
    const value = Number.parseInt(id.slice(marker.length), 10)
    return Number.isFinite(value) ? Math.max(max, value) : max
  }, 0)
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}

async function recordEvidenceFromCli(args: string[], host: CliHost): Promise<CliResult> {
  const input = parseEvidenceArgs(args)
  if (!input.ok) return failure(`${input.error}\n`)

  const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${defaultRuntimeCapsulePath}\n`)

  const idFactory = createCliIdFactory(capsule.value.runtime)
  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory,
  })
  runtime.registerContract(cliAtlasContract)

  const evidenceId = input.value.evidenceId ?? idFactory("evidence")
  const recorded = runtime.addTaskEvidence({
    missionId: input.value.missionId,
    evidence: {
      id: evidenceId,
      taskId: input.value.taskId,
      type: input.value.type,
      summary: input.value.summary,
      payload: input.value.payload,
      createdAt: new Date().toISOString(),
    },
  })
  if (!recorded.ok) return failure(`${recorded.error.message}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: defaultRuntimeCapsulePath,
    snapshot,
  })
  const pulse = deriveLoopPulse(snapshot)

  return success([
    "Evidence recorded",
    `mission: ${input.value.missionId}`,
    `task: ${input.value.taskId}`,
    `evidence: ${evidenceId}`,
    `type: ${input.value.type}`,
    `next: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
    `runtime: ${defaultRuntimeCapsulePath}`,
    "",
  ].join("\n"))
}

async function tickMissionFromCli(host: CliHost): Promise<CliResult> {
  const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${defaultRuntimeCapsulePath}\n`)

  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory: createCliIdFactory(capsule.value.runtime),
  })
  runtime.registerContract(cliAtlasContract)

  const advanced = advanceCliLoop(runtime)
  if (!advanced.ok) return failure(`${advanced.error}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: defaultRuntimeCapsulePath,
    snapshot,
  })
  const pulse = deriveLoopPulse(snapshot)

  return success([
    "Mission advanced",
    `status: ${advanced.value.status}`,
    `mission: ${advanced.value.missionId ?? "none"}`,
    `task: ${advanced.value.taskId ?? "none"}`,
    `mission status: ${advanced.value.missionStatus ?? "none"}`,
    `next: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
    `runtime: ${defaultRuntimeCapsulePath}`,
    "",
  ].join("\n"))
}

type EvidenceArgsResult =
  | {
      ok: true
      value: {
        missionId: string
        taskId: string
        type: EvidenceType
        summary: string
        payload: Record<string, unknown>
        evidenceId?: string
      }
    }
  | {
      ok: false
      error: string
    }

function parseEvidenceArgs(args: string[]): EvidenceArgsResult {
  const [missionId, taskId, ...flags] = args
  if (!missionId || !taskId) {
    return { ok: false, error: "Usage: runesmith mission evidence <mission-id> <task-id> --type <type> --summary <summary> [--payload-json <json>]" }
  }

  const options = parseFlagOptions(flags)
  const type = options.type
  if (!isEvidenceType(type)) {
    return { ok: false, error: "Evidence type must be one of: file-change, command-output, test-result, diagnostic, decision, risk" }
  }

  const summary = options.summary?.trim()
  if (!summary) {
    return { ok: false, error: "Evidence summary is required" }
  }

  const payload = options["payload-json"]
    ? parsePayloadJson(options["payload-json"])
    : { ok: true as const, value: { mode: "runesmith-cli" } }
  if (!payload.ok) return { ok: false, error: payload.error }

  return {
    ok: true,
    value: {
      missionId,
      taskId,
      type,
      summary,
      payload: payload.value,
      evidenceId: options.id,
    },
  }
}

function parseFlagOptions(flags: string[]): Record<string, string | undefined> {
  const options: Record<string, string | undefined> = {}
  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index]
    const value = flags[index + 1]
    if (flag?.startsWith("--") && value) {
      options[flag.slice(2)] = value
      index += 1
    }
  }

  return options
}

function parsePayloadJson(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Evidence payload JSON must be an object" }
    }

    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, error: "Evidence payload JSON is invalid" }
  }
}

function isEvidenceType(value: string | undefined): value is EvidenceType {
  if (!value) return false

  return ["file-change", "command-output", "test-result", "diagnostic", "decision", "risk"].includes(value)
}

type CliAdvanceResult =
  | {
      ok: true
      value: {
        status: "idle" | "waiting-for-evidence" | "claimed" | "completed"
        missionId?: string
        taskId?: string
        missionStatus?: string
      }
    }
  | {
      ok: false
      error: string
    }

function advanceCliLoop(runtime: ReturnType<typeof createRuntime>, depth = 0): CliAdvanceResult {
  if (depth > 12) return { ok: false, error: "Autopilot tick exceeded the maximum advance depth" }

  const snapshot = runtime.snapshot()
  const target = selectActiveTask(snapshot)
  if (!target) return { ok: true, value: { status: "idle" } }

  const graph = snapshot.graphs[target.missionId]
  const task = graph?.tasks[target.taskId]
  if (!graph || !task) return { ok: true, value: { status: "idle" } }

  const contractId = task.assignedAgentId ?? cliAtlasContract.id
  const contract = snapshot.contracts[contractId] ?? cliAtlasContract

  if (task.status === "queued") {
    const claimed = claimCliTask(runtime, {
      missionId: target.missionId,
      task,
      contractId,
    })
    if (!claimed.ok) return { ok: false, error: claimed.error.message }

    return { ok: true, value: { status: "claimed", missionId: target.missionId, taskId: target.taskId } }
  }

  const missingEvidence = getMissingEvidence(snapshot, {
    missionId: target.missionId,
    taskId: target.taskId,
    requiredEvidence: getRequiredEvidenceForTask(task, contract),
  })
  const decisionDraft = createCovenantDecisionDraft(task)
  if (decisionDraft && missingEvidence.length === 1 && missingEvidence[0] === "decision") {
    const recorded = runtime.addTaskEvidence({
      missionId: target.missionId,
      evidence: {
        id: `evidence_auto_decision_${fingerprint(`${target.missionId}:${target.taskId}:${decisionDraft.stage}`)}`,
        taskId: target.taskId,
        type: "decision",
        summary: decisionDraft.summary,
        payload: decisionDraft.payload,
        createdAt: new Date().toISOString(),
      },
    })
    if (!recorded.ok) return { ok: false, error: recorded.error.message }

    return advanceCliLoop(runtime, depth + 1)
  }

  if (missingEvidence.length > 0) {
    return {
      ok: true,
      value: {
        status: "waiting-for-evidence",
        missionId: target.missionId,
        taskId: target.taskId,
        missionStatus: graph.mission.status,
      },
    }
  }

  const completed = runtime.completeTask({
    missionId: target.missionId,
    taskId: target.taskId,
    contractId,
  })
  if (!completed.ok) return { ok: false, error: completed.error.message }

  const nextTarget = selectActiveTask(runtime.snapshot(), target.missionId)
  const nextTask = nextTarget ? runtime.snapshot().graphs[nextTarget.missionId]?.tasks[nextTarget.taskId] : undefined
  const nextClaimed = nextTask?.status === "queued"
    ? claimCliTask(runtime, {
        missionId: target.missionId,
        task: nextTask,
        contractId: cliAtlasContract.id,
      })
    : undefined
  if (nextClaimed && !nextClaimed.ok) return { ok: false, error: nextClaimed.error.message }

  if (nextClaimed?.ok) return advanceCliLoop(runtime, depth + 1)

  const finalGraph = runtime.snapshot().graphs[target.missionId]
  return {
    ok: true,
    value: {
      status: "completed",
      missionId: target.missionId,
      taskId: target.taskId,
      missionStatus: finalGraph?.mission.status ?? completed.value.graph.mission.status,
    },
  }
}

function claimCliTask(
  runtime: ReturnType<typeof createRuntime>,
  input: { missionId: string; task: MissionTask; contractId: string },
) {
  return runtime.claimTask({
    missionId: input.missionId,
    taskId: input.task.id,
    contractId: input.contractId,
    holder: "runesmith-cli",
    idempotencyKey: `cli:${input.missionId}:${input.task.id}`,
    ttlMs: 30_000,
  })
}

function selectActiveTask(snapshot: RuntimeSnapshot, missionId?: string): { missionId: string; taskId: string } | undefined {
  const rank: Record<string, number> = {
    running: 0,
    verifying: 1,
    queued: 2,
    blocked: 3,
    stale: 4,
  }

  return Object.values(snapshot.graphs)
    .filter((graph) => !missionId || graph.mission.id === missionId)
    .filter((graph) => !["complete", "failed", "cancelled"].includes(graph.mission.status))
    .flatMap((graph) => {
      return Object.values(graph.tasks)
        .filter((task) => {
          return !["complete", "failed", "cancelled"].includes(task.status)
            && (task.status !== "queued" || taskDependenciesComplete(graph, task))
        })
        .map((task) => ({
          missionId: graph.mission.id,
          taskId: task.id,
          status: task.status,
          updatedAt: task.updatedAt,
        }))
    })
    .sort((left, right) => {
      const rankDelta = (rank[left.status] ?? 99) - (rank[right.status] ?? 99)
      if (rankDelta !== 0) return rankDelta
      return right.updatedAt.localeCompare(left.updatedAt)
    })[0]
}

function getMissingEvidence(
  snapshot: RuntimeSnapshot,
  input: { missionId: string; taskId: string; requiredEvidence: EvidenceType[] },
): EvidenceType[] {
  const ledger = snapshot.ledgers[input.missionId]
  if (!ledger) return input.requiredEvidence

  return missingRequiredEvidence(ledger, input)
}

function formatMissionEvidence(snapshot: RuntimeSnapshot, missionId: string): string[] {
  const evidence = Object.values(snapshot.ledgers[missionId]?.evidence ?? {})
    .sort(compareEvidence)
    .map((entry) => {
      return `- ${entry.id} ${entry.taskId} ${entry.type} ${entry.summary}`
    })

  return evidence.length > 0 ? evidence : ["- none"]
}

function formatMissionLeases(snapshot: RuntimeSnapshot, missionId: string): string[] {
  const graph = snapshot.graphs[missionId]
  if (!graph) return ["- none"]

  const taskIds = new Set(Object.keys(graph.tasks))
  const leases = Object.values(snapshot.leases.leases)
    .filter((lease) => taskIds.has(lease.targetId))
    .sort(compareLeases)
    .map((lease) => {
      return `- ${lease.id} ${lease.status} ${lease.targetId} ${lease.holder} expires ${lease.expiresAt}`
    })

  return leases.length > 0 ? leases : ["- none"]
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}

function compareEvidence(left: Evidence, right: Evidence): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

function compareLeases(left: Lease, right: Lease): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
}

async function installRunesmith(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseOptions(args)
  const mode = options.mode ?? "local"

  if (mode === "npm") {
    return installNpmPlugin(host, {
      configPath: options.config ?? getDefaultOpenCodeConfigPath(),
      pluginEntry: options.package ?? "@runesmith/opencode-adapter@latest",
    })
  }

  if (mode !== "local") {
    return failure(`Unknown install mode: ${mode}\n`)
  }

  const source = options.source ?? resolveRepoPluginSource()
  const pluginDir = options.pluginDir ?? getDefaultOpenCodePluginDir()
  const pluginPath = `${pluginDir.replace(/[\\/]$/, "")}/runesmith.ts`
  const sourceUrl = pathToFileURL(source).href

  await host.writeText(pluginPath, [
    "// Generated by Runesmith. Re-run `runesmith install` to refresh.",
    `export { default } from "${sourceUrl}"`,
    "",
  ].join("\n"))

  return success([
    "Installed Runesmith local plugin",
    `plugin: ${pluginPath}`,
    `source: ${sourceUrl}`,
    "covenant: automatic",
    "",
  ].join("\n"))
}

async function installNpmPlugin(
  host: CliHost,
  input: { configPath: string; pluginEntry: string },
): Promise<CliResult> {
  const existed = await host.exists(input.configPath)
  const backupPath = `${input.configPath}.runesmith.bak`
  const current = existed ? await host.readText(input.configPath) : "{\n}\n"
  const errors: ParseError[] = []
  const parsed = parse(current, errors, { allowTrailingComma: true }) as { plugin?: unknown } | undefined

  if (errors.length > 0 || !parsed || typeof parsed !== "object") {
    return failure(`Could not parse OpenCode config: ${input.configPath}\n`)
  }

  if (existed) {
    await host.writeText(backupPath, current)
  }

  const existingPlugins = Array.isArray(parsed.plugin)
    ? parsed.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
  const normalizedPlugins = [
    ...existingPlugins.filter((entry) => !isRunesmithPluginEntry(entry)),
    input.pluginEntry,
  ]
  const edits = modify(current, ["plugin"], normalizedPlugins, {
    formattingOptions: {
      insertSpaces: true,
      tabSize: 2,
    },
  })
  const nextConfig = applyEdits(current, edits)
  await host.writeText(input.configPath, nextConfig.endsWith("\n") ? nextConfig : `${nextConfig}\n`)

  return success([
    "Installed Runesmith npm plugin",
    `config: ${input.configPath}`,
    `plugin: ${input.pluginEntry}`,
    `backup: ${existed ? backupPath : "none"}`,
    "covenant: automatic",
    "",
  ].join("\n"))
}

function resolveRepoPluginSource(): string {
  return new URL("../../opencode-adapter/src/plugin.ts", import.meta.url).pathname
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
