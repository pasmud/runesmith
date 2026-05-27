#!/usr/bin/env bun

import { dirname } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import {
  advanceRunicMissionLoop,
  createCovenantTaskPlan,
  createRuntime,
  defaultProjectConfigPath,
  defaultRuntimeCapsulePath,
  deriveLoopPulse,
  deriveMissionMap,
  deriveMissionMemory,
  deriveProofPlan,
  deriveReviewLens,
  deriveRunicProtocolDeck,
  deriveRunebook,
  deriveScopeSentinel,
  deriveSealAudit,
  loadProjectConfig,
  loadRuntimeCapsule,
  prepareRunicMission,
  repairProjectConfig as repairProjectConfigStore,
  repairRuntimeCapsule as repairRuntimeCapsuleStore,
  resolveRunicRisk,
  runRuneweave,
  runRunebookNext,
  runProofPlan,
  runtimeCapsulePathFromConfig,
  saveProjectConfig,
  saveRuntimeCapsule,
  type AgentContract,
  type Evidence,
  type EvidenceType,
  type IdFactory,
  type Lease,
  type MissionMap,
  type ProofCommandExecution,
  type ProofRunCommandResult,
  type ProofPlanOptions,
  type ReviewLens,
  type RunicProtocolDeck,
  type Runebook,
  type ScopeSentinel,
  type SealAudit,
  type RiskResolutionVerdict,
  type RuntimeSnapshot,
} from "@runesmith/core"
import { applyEdits, modify, parse, type ParseError } from "jsonc-parser"
import { runDoctor } from "./doctor.js"
import { findOpenCodeCli } from "./opencode-cli.js"
import {
  getDefaultOpenCodeConfigPath,
  getDefaultOpenCodePluginDir,
  isRunesmithPluginEntry,
  parseOptions,
} from "./options.js"

const shellOutputCaptureLimit = 64_000

export type CliResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type CliCommandResult = {
  exitCode: number
  stdout?: string
  stderr?: string
}

export type CliHost = {
  exists(path: string): boolean | Promise<boolean>
  findCommand?(command: string): string | undefined | Promise<string | undefined>
  readText(path: string): string | Promise<string>
  runCommand?(command: string, args: string[]): CliCommandResult | Promise<CliCommandResult>
  runShellCommand?(command: string): CliCommandResult | Promise<CliCommandResult>
  writeText(path: string, text: string): void | Promise<void>
}

export type MemoryHostOptions = {
  commands?: Record<string, string | undefined>
  runCommand?: (command: string, args: string[]) => CliCommandResult | Promise<CliCommandResult>
  runShellCommand?: (command: string) => CliCommandResult | Promise<CliCommandResult>
}

export function createMemoryHost(initialFiles: Record<string, string> = {}, options: MemoryHostOptions = {}) {
  const files = new Map(Object.entries(initialFiles))

  return {
    exists(path: string): boolean {
      return files.has(path)
    },
    findCommand(command: string): string | undefined {
      return options.commands?.[command]
    },
    readText(path: string): string {
      const value = files.get(path)
      if (value === undefined) {
        throw new Error(`File not found: ${path}`)
      }

      return value
    },
    runCommand(command: string, args: string[]): CliCommandResult | Promise<CliCommandResult> {
      return options.runCommand?.(command, args) ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
      }
    },
    runShellCommand(command: string): CliCommandResult | Promise<CliCommandResult> {
      return options.runShellCommand?.(command) ?? {
        exitCode: 0,
        stdout: "",
        stderr: "",
      }
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
    findCommand(command: string): string | undefined {
      try {
        return Bun.which(command) ?? undefined
      } catch {
        return undefined
      }
    },
    readText(path: string): Promise<string> {
      return readFile(path, "utf8")
    },
    async runCommand(command: string, args: string[]): Promise<CliCommandResult> {
      const child = Bun.spawn([command, ...args], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      })
      const exitCode = await child.exited

      return { exitCode }
    },
    async runShellCommand(command: string): Promise<CliCommandResult> {
      const shellCommand = process.platform === "win32"
        ? ["powershell", "-NoProfile", "-Command", command]
        : ["sh", "-lc", command]
      const child = Bun.spawn(shellCommand, {
        stdout: "pipe",
        stderr: "pipe",
      })
      const [stdout, stderr, exitCode] = await Promise.all([
        readTextBounded(child.stdout, shellOutputCaptureLimit),
        readTextBounded(child.stderr, shellOutputCaptureLimit),
        child.exited,
      ])

      return { exitCode, stdout, stderr }
    },
    async writeText(path: string, text: string): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, text, "utf8")
    },
  }
}

async function readTextBounded(
  stream: ReadableStream<Uint8Array> | null | undefined,
  maxLength: number,
): Promise<string> {
  if (!stream) return ""

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value || output.length >= maxLength) continue

      const text = decoder.decode(value, { stream: true })
      const remaining = maxLength - output.length
      output = `${output}${text.slice(0, remaining)}`
    }

    if (output.length < maxLength) {
      const tail = decoder.decode()
      const remaining = maxLength - output.length
      output = `${output}${tail.slice(0, remaining)}`
    }
  } finally {
    reader.releaseLock()
  }

  return output
}

export async function runCli(args: string[], host: CliHost = createNodeHost()): Promise<CliResult> {
  const [command, subcommand, maybeId, ...rest] = args

  if (command === "install") {
    return installRunesmith(args.slice(1), host)
  }

  if (command === "up") {
    return runesmithUp(args.slice(1), host)
  }

  if (command === "heal") {
    return runesmithHeal(args.slice(1), host)
  }

  if (command === "ignite") {
    return runesmithIgnite(args.slice(1), host)
  }

  if (command === "status") {
    return runesmithStatus(host)
  }

  if (command === "next") {
    return runNextFromCli(args.slice(1), host)
  }

  if (command === "run") {
    return runOsFromCli(args.slice(1), host)
  }

  if (command === "launch") {
    return launchOpenCode(args.slice(1), host)
  }

  if (command === "dashboard") {
    return runesmithDashboard(args.slice(1), host)
  }

  if (command === "prove") {
    return runProofFromCli(host)
  }

  if (command === "risk" && subcommand === "resolve") {
    return resolveRiskFromCli([maybeId, ...rest].filter((value): value is string => Boolean(value)), host)
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

    const proofOptions = await readProofPlanOptions(host)
    const pulse = deriveLoopPulse(snapshot.value)
    const missionMap = deriveMissionMap(snapshot.value)
    const scopeSentinel = deriveScopeSentinel(snapshot.value)
    const reviewLens = deriveReviewLens(snapshot.value)
    const sealAudit = deriveSealAudit(snapshot.value, proofOptions)
    const memory = deriveMissionMemory(snapshot.value)
    const proofPlan = deriveProofPlan(snapshot.value, proofOptions)
    const runebook = deriveRunebook(snapshot.value, { proofPlanOptions: proofOptions })
    const protocolDeck = deriveRunicProtocolDeck(snapshot.value, { proofPlanOptions: proofOptions })
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
      "Mission memory:",
      `Handoff: ${memory.handoff}`,
      `Proof: ${formatMissionMemoryProof(memory)}`,
      "Proof plan:",
      ...formatProofPlanLines(proofPlan),
      "Mission map:",
      `Summary: ${missionMap.summary}`,
      ...formatMissionMapTaskLines(missionMap),
      "Scope sentinel:",
      `Summary: ${scopeSentinel.summary}`,
      ...formatScopeSentinelChangeLines(scopeSentinel),
      `Findings: ${formatScopeSentinelFindings(scopeSentinel)}`,
      "Review lens:",
      `Summary: ${reviewLens.summary}`,
      ...formatReviewLensBlockedLines(reviewLens),
      `Findings: ${formatReviewLensFindings(reviewLens)}`,
      "Seal audit:",
      `Summary: ${sealAudit.summary}`,
      ...formatSealAuditAttentionLines(sealAudit),
      `Findings: ${formatSealAuditFindings(sealAudit)}`,
      `Required evidence: ${formatList(pulse.requiredEvidence)}`,
      `Missing evidence: ${formatList(pulse.missingEvidence)}`,
      ...formatPulseDiagnostics(pulse, "Diagnostics"),
      `Active runes: ${formatList(pulse.runes.map((rune) => rune.name))}`,
      "Runebook:",
      `Active card: ${formatRunebookCard(runebook)}`,
      `Commands: ${formatRunebookCommands(runebook)}`,
      `Tool hints: ${formatList(runebook.activeCard.toolHints)}`,
      "Protocol:",
      `Active protocol: ${formatRunicProtocol(protocolDeck)}`,
      `Forbidden moves: ${formatList(protocolDeck.active.forbiddenMoves)}`,
      "Tasks:",
      ...taskLines,
      "Evidence:",
      ...evidenceLines,
      "Leases:",
      ...leaseLines,
      "",
    ].join("\n"))
  }

  return failure("Usage: runesmith <ignite|heal|up|status|run|next|launch|dashboard|prove|install|init|doctor|risk resolve|mission start|mission evidence|mission tick|mission list|mission inspect>\n")
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

const defaultOpenCodePackagePluginEntry = "runesmith@git+https://github.com/pasmud/runesmith.git"

async function writeProjectConfig(host: CliHost): Promise<void> {
  await saveProjectConfig(host, { path: defaultProjectConfigPath })
}

async function ensureProjectConfig(host: CliHost): Promise<void> {
  if (await host.exists(".runesmith/config.json")) return

  await writeProjectConfig(host)
}

async function resolveRuntimeCapsulePath(host: CliHost): Promise<string> {
  const config = await loadProjectConfig(host, defaultProjectConfigPath)

  return config.ok && config.value
    ? runtimeCapsulePathFromConfig(config.value)
    : defaultRuntimeCapsulePath
}

async function ensureRuntimeCapsule(host: CliHost): Promise<string> {
  const capsulePath = await resolveRuntimeCapsulePath(host)
  if (await host.exists(capsulePath)) return capsulePath

  await saveRuntimeCapsule(host, {
    path: capsulePath,
    snapshot: emptySnapshot,
  })

  return capsulePath
}

type RepairState = "ok" | "repaired"

async function runesmithHeal(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseOptions(args)
  const setupArgs = options.mode ? args : ["--mode", "npm", ...args]
  const installMode = (options.mode ?? "npm") === "npm" ? "package" : "local shim"
  const configState = await repairProjectConfig(host)
  const runtimeState = await repairRuntimeCapsule(host)
  const install = await installRunesmith(setupArgs, host)
  if (install.exitCode !== 0) return install

  const doctor = await runDoctor(setupArgs, host)
  const doctorState = doctor.exitCode === 0 ? "ready" : "staged"
  const openCodeCli = await findOpenCodeCli(host)
  const openCodeConfig = extractOutputValue(install.stdout, "config")
  const plugin = extractOutputValue(install.stdout, "plugin")

  return success([
    "Runesmith Heal",
    `config: ${configState}`,
    `runtime: ${runtimeState}`,
    `install: ${installMode}`,
    ...(openCodeConfig ? [`opencode config: ${openCodeConfig}`] : []),
    `plugin: ${plugin ?? "installed"}`,
    `opencode: ${openCodeCli ? `found ${openCodeCli}` : "missing"}`,
    `doctor: ${doctorState}`,
    doctorState === "ready"
      ? "next: runesmith ignite \"<goal>\" or runesmith launch -- <opencode args>"
      : "next: install OpenCode CLI, then run `runesmith doctor`.",
    "",
  ].join("\n"))
}

async function repairProjectConfig(host: CliHost): Promise<RepairState> {
  const repaired = await repairProjectConfigStore(host, {
    path: defaultProjectConfigPath,
  })
  if (!repaired.ok) return "repaired"

  return repaired.value.status
}

async function repairRuntimeCapsule(host: CliHost): Promise<RepairState> {
  const capsulePath = await resolveRuntimeCapsulePath(host)
  const repaired = await repairRuntimeCapsuleStore(host, {
    path: capsulePath,
    snapshot: emptySnapshot,
  })
  if (!repaired.ok) return "repaired"

  return repaired.value.status
}

async function runesmithUp(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseOptions(args)
  const installMode = options.mode === "npm" ? "package" : "local shim"
  await repairProjectConfig(host)
  const runtimeCapsulePath = await ensureRuntimeCapsule(host)

  const install = await installRunesmith(args, host)
  if (install.exitCode !== 0) return install

  const pluginPath = extractOutputValue(install.stdout, "plugin")
  const openCodeConfig = extractOutputValue(install.stdout, "config")
  const openCodeCli = await findOpenCodeCli(host)

  return success([
    openCodeCli ? "Runesmith OS is ready" : "Runesmith OS is staged",
    "config: .runesmith/config.json",
    `install: ${installMode}`,
    ...(openCodeConfig ? [`opencode config: ${openCodeConfig}`] : []),
    `plugin: ${pluginPath ?? "installed"}`,
    `runtime: ${runtimeCapsulePath}`,
    openCodeCli
      ? `opencode: found ${openCodeCli}`
      : "opencode: missing (install OpenCode CLI, then run `runesmith doctor`)",
    "covenant: automatic",
    "dashboard: runesmith dashboard",
    "",
  ].join("\n"))
}

async function runesmithDashboard(args: string[], host: CliHost): Promise<CliResult> {
  if (!host.runCommand) {
    return failure("Dashboard launch requires a command runner.\n")
  }

  await repairProjectConfig(host)
  const runtimeCapsulePath = await ensureRuntimeCapsule(host)
  const options = parseFlagOptions(args)
  const hostName = options.host ?? "127.0.0.1"
  const port = options.port ?? "4177"
  if (!(await host.exists(resolveDashboardDistIndexPath()))) {
    const build = await host.runCommand("bun", [
      "run",
      "--cwd",
      resolveDashboardSourceDir(),
      "build",
    ])
    if (build.exitCode !== 0) {
      return {
        exitCode: build.exitCode,
        stdout: build.stdout ?? "",
        stderr: build.stderr ?? "",
      }
    }
  }

  const launched = await host.runCommand("bun", [
    resolveDashboardServerScript(),
    "--host",
    hostName,
    "--port",
    port,
    "--runtime",
    runtimeCapsulePath,
    "--dist",
    resolveDashboardDistDir(),
  ])

  return {
    exitCode: launched.exitCode,
    stdout: launched.stdout ?? "",
    stderr: launched.stderr ?? "",
  }
}

async function runesmithStatus(host: CliHost): Promise<CliResult> {
  const configFound = await host.exists(".runesmith/config.json")
  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) {
    return failure(`${capsule.error.message}\n`)
  }

  const snapshot = capsule.value?.runtime ?? emptySnapshot
  const openCodeCli = await findOpenCodeCli(host)
  const proofOptions = await readProofPlanOptions(host)
  const pulse = deriveLoopPulse(snapshot)
  const missionMap = deriveMissionMap(snapshot)
  const scopeSentinel = deriveScopeSentinel(snapshot)
  const reviewLens = deriveReviewLens(snapshot)
  const sealAudit = deriveSealAudit(snapshot, proofOptions)
  const memory = deriveMissionMemory(snapshot)
  const proofPlan = deriveProofPlan(snapshot, proofOptions)
  const runebook = deriveRunebook(snapshot, { proofPlanOptions: proofOptions })
  const protocolDeck = deriveRunicProtocolDeck(snapshot, { proofPlanOptions: proofOptions })
  const mission = pulse.missionId ? snapshot.graphs[pulse.missionId]?.mission : undefined
  const task = mission && pulse.taskId ? snapshot.graphs[mission.id]?.tasks[pulse.taskId] : undefined
  const state = selectInstallState(Boolean(configFound), Boolean(capsule.value), Boolean(openCodeCli))

  return success([
    "Runesmith OS",
    `state: ${state}`,
    `runtime: ${runtimeCapsulePath}`,
    `opencode: ${openCodeCli ? `found ${openCodeCli}` : "missing"}`,
    `next: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
    `plan: ${formatExecutionPlan(pulse.executionPlan)}`,
    `handoff: ${memory.handoff}`,
    `proof plan: ${formatProofPlanCommands(proofPlan)}`,
    `mission map: ${formatMissionMapSummary(missionMap)}`,
    `scope sentinel: ${formatScopeSentinelSummary(scopeSentinel)}`,
    `review lens: ${formatReviewLensSummary(reviewLens)}`,
    `seal audit: ${formatSealAuditSummary(sealAudit)}`,
    `mission: ${mission ? `${mission.id} ${mission.status} ${mission.goal}` : "none"}`,
    `task: ${task ? `${task.id} ${task.status} ${task.title}` : "none"}`,
    `missing evidence: ${formatList(pulse.missingEvidence)}`,
    `diagnostics: ${formatList(pulse.diagnostics)}`,
    `active runes: ${formatList(pulse.runes.map((rune) => rune.name))}`,
    `runebook: ${formatRunebookCard(runebook)}`,
    `runebook commands: ${formatRunebookCommands(runebook)}`,
    `protocol: ${formatRunicProtocol(protocolDeck)}`,
    "dashboard: runesmith dashboard",
    "launch: runesmith launch -- <opencode args>",
    "",
  ].join("\n"))
}

type IgniteArgs = {
  setupArgs: string[]
  loopArgs: string[]
  goal?: string
}

async function runesmithIgnite(args: string[], host: CliHost): Promise<CliResult> {
  const parsed = parseIgniteArgs(args)
  const setup = await runesmithHeal(parsed.setupArgs, host)
  if (setup.exitCode !== 0) return setup

  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

  const idFactory = createCliIdFactory(capsule.value.runtime)
  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory,
  })
  runtime.registerContract(cliAtlasContract)

  const goal = parsed.goal?.trim()
  const ignition = goal
    ? prepareRunicMission(runtime, {
        goal,
        contract: cliAtlasContract,
        holder: "runesmith-ignite",
        idempotencyScope: "ignite",
        ttlMs: 30_000,
      })
    : undefined
  if (ignition && !ignition.ok) return failure(`${ignition.error.message}\n`)

  const proofOptions = await readProofPlanOptions(host)
  const loopOptions = parseFlagOptions(parsed.loopArgs)
  const loop = await runRuneweave(runtime, {
    contract: cliAtlasContract,
    holder: "runesmith-ignite",
    idempotencyScope: "ignite-os",
    ttlMs: 30_000,
    proofPlanOptions: proofOptions,
    proofCommandRunner: host.runShellCommand
      ? (command) => host.runShellCommand!(command.command)
      : undefined,
    nextEvidenceId: () => idFactory("evidence"),
    maxSteps: parseMaxSteps(loopOptions["max-steps"]),
    risk: {
      verdict: parseRiskVerdict(loopOptions.verdict),
      summary: loopOptions.summary,
      evidenceIdFactory: () => idFactory("evidence"),
    },
  })
  if (!loop.ok) return failure(`${loop.error.message}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: runtimeCapsulePath,
    snapshot,
  })

  const setupState = setup.stdout.startsWith("Runesmith OS is ready") || extractOutputValue(setup.stdout, "doctor") === "ready"
    ? "ready"
    : "staged"
  const installMode = extractOutputValue(setup.stdout, "install") ?? "package"
  const openCodeConfig = extractOutputValue(setup.stdout, "opencode config")
  const plugin = extractOutputValue(setup.stdout, "plugin")
  const value = loop.value

  return {
    exitCode: ["proof-failed", "risk-held", "blocked", "step-limit"].includes(value.status) ? 1 : 0,
    stdout: [
      "Runesmith Ignite",
      `setup: ${setupState}`,
      `install: ${installMode}`,
      ...(openCodeConfig ? [`opencode config: ${openCodeConfig}`] : []),
      `plugin: ${plugin ?? "installed"}`,
      ignition
        ? `mission: ${ignition.value.missionId} ${ignition.value.missionCreated ? "created" : "resumed"}`
        : "mission: current",
      ignition ? `task: ${ignition.value.taskId}` : `task: ${value.taskId ?? "none"}`,
      ignition ? `lease: ${ignition.value.leaseId}` : "lease: none",
      `run: ${value.status}`,
      `reason: ${value.stopReason}`,
      `steps: ${value.stepCount}`,
      ...value.steps.map((step, index) => `${index + 1}. ${step.actionId} -> ${step.status}`),
      ...formatProofRunLines(value.commands),
      `next: ${value.finalPulse.nextAction.label} [${value.finalPulse.health}/${value.finalPulse.nextAction.priority}]`,
      ...formatPulseDiagnostics(value.finalPulse),
      `runtime: ${runtimeCapsulePath}`,
      "dashboard: runesmith dashboard",
      "launch: runesmith launch -- <opencode args>",
      "",
    ].join("\n"),
    stderr: "",
  }
}

function parseIgniteArgs(args: string[]): IgniteArgs {
  const setupArgs: string[] = []
  const loopArgs: string[] = []
  const goalParts: string[] = []
  let hasMode = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    const next = args[index + 1]
    if (!arg) continue

    if (arg === "--goal" && next) {
      goalParts.push(next)
      index += 1
      continue
    }

    if (["--mode", "--config", "--package", "--plugin-dir", "--source"].includes(arg) && next) {
      if (arg === "--mode") hasMode = true
      setupArgs.push(arg, next)
      index += 1
      continue
    }

    if (["--max-steps", "--summary", "--verdict"].includes(arg) && next) {
      loopArgs.push(arg, next)
      index += 1
      continue
    }

    if (!arg.startsWith("--")) {
      goalParts.push(arg)
    }
  }

  return {
    setupArgs: hasMode ? setupArgs : ["--mode", "npm", ...setupArgs],
    loopArgs,
    goal: goalParts.join(" ").trim().replace(/\s+/g, " ") || undefined,
  }
}

function selectInstallState(configFound: boolean, capsuleFound: boolean, openCodeFound: boolean): "ready" | "staged" | "uninitialized" {
  if (!configFound && !capsuleFound) return "uninitialized"
  return configFound && capsuleFound && openCodeFound ? "ready" : "staged"
}

async function launchOpenCode(args: string[], host: CliHost): Promise<CliResult> {
  const split = splitLaunchArgs(args)
  const setup = await runesmithUp(split.setupArgs, host)
  const openCodeCli = await findOpenCodeCli(host)

  if (!openCodeCli) {
    return {
      exitCode: 1,
      stdout: setup.stdout,
      stderr: "OpenCode CLI not found. Install OpenCode CLI, then rerun `runesmith launch`.\n",
    }
  }

  if (!host.runCommand) {
    return {
      exitCode: 1,
      stdout: setup.stdout,
      stderr: "This host cannot launch external commands.\n",
    }
  }

  const launched = await host.runCommand(openCodeCli, split.openCodeArgs)

  return {
    exitCode: launched.exitCode,
    stdout: `${setup.stdout}\nlaunch: ${formatCommandForDisplay(openCodeCli, split.openCodeArgs)}\n${launched.stdout ?? ""}`,
    stderr: launched.stderr ?? "",
  }
}

function splitLaunchArgs(args: string[]): { setupArgs: string[]; openCodeArgs: string[] } {
  const passthroughIndex = args.indexOf("--")
  if (passthroughIndex < 0) {
    return { setupArgs: args, openCodeArgs: [] }
  }

  return {
    setupArgs: args.slice(0, passthroughIndex),
    openCodeArgs: args.slice(passthroughIndex + 1),
  }
}

function formatCommandForDisplay(command: string, args: string[]): string {
  return [command, ...args].map(formatCommandPartForDisplay).join(" ")
}

function formatCommandPartForDisplay(part: string): string {
  if (!/[\s"]/.test(part)) return part

  return `"${part.replaceAll("\"", "\\\"")}"`
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
    const capsule = await loadRuntimeCapsule(host, await resolveRuntimeCapsulePath(host))
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

  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
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
    path: runtimeCapsulePath,
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
    `runtime: ${runtimeCapsulePath}`,
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

  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

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
    path: runtimeCapsulePath,
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
    ...formatPulseDiagnostics(pulse),
    `runtime: ${runtimeCapsulePath}`,
    "",
  ].join("\n"))
}

async function tickMissionFromCli(host: CliHost): Promise<CliResult> {
  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory: createCliIdFactory(capsule.value.runtime),
  })
  runtime.registerContract(cliAtlasContract)

  const advanced = advanceRunicMissionLoop(runtime, {
    contract: cliAtlasContract,
    holder: "runesmith-cli",
    idempotencyScope: "cli",
    ttlMs: 30_000,
  })
  if (!advanced.ok) return failure(`${advanced.error.message}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: runtimeCapsulePath,
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
    ...formatPulseDiagnostics(pulse),
    `runtime: ${runtimeCapsulePath}`,
    "",
  ].join("\n"))
}

async function runProofFromCli(host: CliHost): Promise<CliResult> {
  if (!host.runShellCommand) {
    return failure("This host cannot run proof commands.\n")
  }

  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

  const idFactory = createCliIdFactory(capsule.value.runtime)
  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory,
  })
  runtime.registerContract(cliAtlasContract)

  const proofOptions = await readProofPlanOptions(host)
  const proofPlan = deriveProofPlan(runtime.snapshot(), proofOptions)
  const proofRun = await runProofPlan(runtime, proofPlan, {
    nextEvidenceId: () => idFactory("evidence"),
    runCommand(command): Promise<ProofCommandExecution> | ProofCommandExecution {
      return host.runShellCommand!(command.command)
    },
  })

  let status: string = proofRun.status
  if (proofRun.status === "passed") {
    const advanced = advanceRunicMissionLoop(runtime, {
      contract: cliAtlasContract,
      holder: "runesmith-cli",
      idempotencyScope: "cli",
      ttlMs: 30_000,
    })
    if (!advanced.ok) return failure(`${advanced.error.message}\n`)
    status = advanced.value.status
  }

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: runtimeCapsulePath,
    snapshot,
  })
  const pulse = deriveLoopPulse(snapshot)

  return {
    exitCode: proofRun.status === "failed" ? 1 : 0,
    stdout: [
      proofRun.status === "failed" ? "Proof plan failed" : proofRun.status === "idle" ? "Proof plan idle" : "Proof plan executed",
      `mission: ${proofRun.missionId ?? "none"}`,
      `task: ${proofRun.taskId ?? "none"}`,
      ...formatProofRunLines(proofRun.commands),
      `status: ${status}`,
      `next: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
      ...formatPulseDiagnostics(pulse),
      `runtime: ${runtimeCapsulePath}`,
      "",
    ].join("\n"),
    stderr: "",
  }
}

async function runNextFromCli(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseFlagOptions(args)
  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

  const idFactory = createCliIdFactory(capsule.value.runtime)
  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory,
  })
  runtime.registerContract(cliAtlasContract)

  const proofOptions = await readProofPlanOptions(host)
  const next = await runRunebookNext(runtime, {
    contract: cliAtlasContract,
    holder: "runesmith-cli",
    idempotencyScope: "cli-next",
    ttlMs: 30_000,
    proofPlanOptions: proofOptions,
    proofCommandRunner: host.runShellCommand
      ? (command) => host.runShellCommand!(command.command)
      : undefined,
    nextEvidenceId: () => idFactory("evidence"),
    risk: {
      verdict: parseRiskVerdict(options.verdict),
      summary: options.summary,
      evidenceIdFactory: () => idFactory("evidence"),
    },
  })
  if (!next.ok) return failure(`${next.error.message}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: runtimeCapsulePath,
    snapshot,
  })
  const value = next.value

  return {
    exitCode: value.status === "proof-failed" ? 1 : 0,
    stdout: [
      "Runebook next",
      `action: ${value.actionId}`,
      `card: ${value.card.title} [${value.card.autonomy}]`,
      `mission: ${value.missionId ?? "none"}`,
      `task: ${value.taskId ?? "none"}`,
      ...formatProofRunLines(value.commands ?? []),
      `status: ${value.status}`,
      `next status: ${value.nextStatus ?? "none"}`,
      `next: ${value.loopPulse.nextAction.label} [${value.loopPulse.health}/${value.loopPulse.nextAction.priority}]`,
      ...formatPulseDiagnostics(value.loopPulse),
      `runtime: ${runtimeCapsulePath}`,
      "",
    ].join("\n"),
    stderr: "",
  }
}

async function runOsFromCli(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseFlagOptions(args)
  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

  const idFactory = createCliIdFactory(capsule.value.runtime)
  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory,
  })
  runtime.registerContract(cliAtlasContract)

  const proofOptions = await readProofPlanOptions(host)
  const loop = await runRuneweave(runtime, {
    contract: cliAtlasContract,
    holder: "runesmith-cli",
    idempotencyScope: "cli-os",
    ttlMs: 30_000,
    proofPlanOptions: proofOptions,
    proofCommandRunner: host.runShellCommand
      ? (command) => host.runShellCommand!(command.command)
      : undefined,
    nextEvidenceId: () => idFactory("evidence"),
    maxSteps: parseMaxSteps(options["max-steps"]),
    risk: {
      verdict: parseRiskVerdict(options.verdict),
      summary: options.summary,
      evidenceIdFactory: () => idFactory("evidence"),
    },
  })
  if (!loop.ok) return failure(`${loop.error.message}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: runtimeCapsulePath,
    snapshot,
  })
  const value = loop.value

  return {
    exitCode: ["proof-failed", "risk-held", "blocked", "step-limit"].includes(value.status) ? 1 : 0,
    stdout: [
      "Runesmith OS run",
      `status: ${value.status}`,
      `reason: ${value.stopReason}`,
      `steps: ${value.stepCount}`,
      ...value.steps.map((step, index) => `${index + 1}. ${step.actionId} -> ${step.status}`),
      ...formatProofRunLines(value.commands),
      `next: ${value.finalPulse.nextAction.label} [${value.finalPulse.health}/${value.finalPulse.nextAction.priority}]`,
      ...formatPulseDiagnostics(value.finalPulse),
      `runtime: ${runtimeCapsulePath}`,
      "",
    ].join("\n"),
    stderr: "",
  }
}

async function resolveRiskFromCli(args: string[], host: CliHost): Promise<CliResult> {
  const options = parseFlagOptions(args)
  const verdict = parseRiskVerdict(options.verdict)
  const summary = options.summary?.trim()
  if (!summary) {
    return failure("Usage: runesmith risk resolve --summary <summary> [--verdict accepted|cleared]\n")
  }

  const runtimeCapsulePath = await resolveRuntimeCapsulePath(host)
  const capsule = await loadRuntimeCapsule(host, runtimeCapsulePath)
  if (!capsule.ok) return failure(`${capsule.error.message}\n`)
  if (!capsule.value) return failure(`Runtime capsule not found: ${runtimeCapsulePath}\n`)

  const idFactory = createCliIdFactory(capsule.value.runtime)
  const runtime = createRuntime({
    snapshot: capsule.value.runtime,
    idFactory,
  })
  runtime.registerContract(cliAtlasContract)

  const resolved = resolveRunicRisk(runtime, {
    contract: cliAtlasContract,
    holder: "runesmith-cli",
    idempotencyScope: "cli-risk",
    ttlMs: 30_000,
    verdict,
    summary,
    evidenceIdFactory: () => idFactory("evidence"),
  })
  if (!resolved.ok) return failure(`${resolved.error.message}\n`)

  const snapshot = runtime.snapshot()
  await saveRuntimeCapsule(host, {
    path: runtimeCapsulePath,
    snapshot,
  })
  const pulse = deriveLoopPulse(snapshot)

  return success([
    "Risk resolved",
    `mission: ${resolved.value.missionId}`,
    `task: ${resolved.value.taskId}`,
    `evidence: ${resolved.value.evidenceId}`,
    `verdict: ${resolved.value.verdict}`,
    `status: ${resolved.value.nextStatus}`,
    `next: ${pulse.nextAction.label} [${pulse.health}/${pulse.nextAction.priority}]`,
    ...formatPulseDiagnostics(pulse),
    `runtime: ${runtimeCapsulePath}`,
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

function parseRiskVerdict(value: string | undefined): RiskResolutionVerdict {
  return value === "cleared" ? "cleared" : "accepted"
}

function parseMaxSteps(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value)

  return Number.isInteger(parsed) ? parsed : undefined
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

function formatExecutionPlan(plan: ReturnType<typeof deriveLoopPulse>["executionPlan"]): string {
  return plan.length > 0 ? plan.map((step) => step.label).join(" -> ") : "none"
}

function formatMissionMemoryProof(memory: ReturnType<typeof deriveMissionMemory>): string {
  if (memory.proof.status === "missing") return `missing ${formatList(memory.proof.missing)}`

  return memory.proof.status
}

function formatProofPlanCommands(plan: ReturnType<typeof deriveProofPlan>): string {
  return plan.commands.length > 0 ? plan.commands.map((command) => command.command).join(" -> ") : "none"
}

function formatProofPlanLines(plan: ReturnType<typeof deriveProofPlan>): string[] {
  if (plan.commands.length === 0) return ["- none"]

  return plan.commands.map((command) => `- ${command.label}: ${command.command}`)
}

function formatMissionMapSummary(map: MissionMap): string {
  if (map.taskCount === 0) return "none"

  const label = map.taskCount === 1 ? "task" : "tasks"
  return `${map.taskCount} ${label}; next ${map.nextTaskId ?? "none"}`
}

function formatMissionMapTaskLines(map: MissionMap): string[] {
  if (map.tasks.length === 0) return ["- none"]

  return map.tasks.map((task) => {
    return `- ${task.status} ${task.key} ${task.id}: ${task.title}; ready: ${task.ready ? "yes" : "no"}; blocked by: ${formatList(task.blockedBy)}; required evidence: ${formatList(task.requiredEvidence)}`
  })
}

function formatScopeSentinelSummary(sentinel: ScopeSentinel): string {
  const label = sentinel.findings.length === 1 ? "finding" : "findings"
  return `${sentinel.status}; ${sentinel.findings.length} ${label}`
}

function formatScopeSentinelChangeLines(sentinel: ScopeSentinel): string[] {
  if (sentinel.changes.length === 0) return ["- none"]

  return sentinel.changes.map((change) => `- ${change.path}: ${change.status}`)
}

function formatScopeSentinelFindings(sentinel: ScopeSentinel): string {
  return sentinel.findings.length > 0 ? sentinel.findings.map((finding) => finding.summary).join("; ") : "none"
}

function formatReviewLensSummary(lens: ReviewLens): string {
  const label = lens.findings.length === 1 ? "finding" : "findings"
  return `${lens.status}; ${lens.findings.length} ${label}`
}

function formatReviewLensBlockedLines(lens: ReviewLens): string[] {
  const rootBlocked = lens.checklist.filter((item) => item.status === "blocked" && item.id !== "review-decision")
  const blocked = rootBlocked.length > 0 ? rootBlocked : lens.checklist.filter((item) => item.status === "blocked")
  if (blocked.length === 0) return ["- none"]

  return blocked.map((item) => `- ${item.id}: ${item.status} - ${item.detail}`)
}

function formatReviewLensFindings(lens: ReviewLens): string {
  return lens.findings.length > 0 ? lens.findings.map((finding) => finding.summary).join("; ") : "none"
}

function formatSealAuditSummary(audit: SealAudit): string {
  const label = audit.findings.length === 1 ? "finding" : "findings"
  return `${audit.status}; ${audit.findings.length} ${label}`
}

function formatSealAuditAttentionLines(audit: SealAudit): string[] {
  const actionable = audit.checks.filter((item) => item.status !== "passed" && item.id !== "seal-decision")
  const checks = actionable.length > 0 ? actionable : audit.checks.filter((item) => item.status !== "passed")
  if (checks.length === 0) return ["- none"]

  return checks.map((item) => `- ${item.id}: ${item.status} - ${item.detail}`)
}

function formatSealAuditFindings(audit: SealAudit): string {
  return audit.findings.length > 0 ? audit.findings.map((finding) => finding.summary).join("; ") : "none"
}

function formatRunebookCard(runebook: Runebook): string {
  return `${runebook.activeCard.title} [${runebook.activeCard.autonomy}]`
}

function formatRunebookCommands(runebook: Runebook): string {
  return runebook.activeCard.commands.length > 0
    ? runebook.activeCard.commands.map((command) => command.command).join(" -> ")
    : "none"
}

function formatRunicProtocol(deck: RunicProtocolDeck): string {
  return `${deck.active.name} [${deck.active.mode}]`
}

function formatProofRunLines(commands: ProofRunCommandResult[]): string[] {
  if (commands.length === 0) return ["- none"]

  return commands.map((command) => {
    const status = command.exitCode === 0 ? "PASS" : "FAIL"
    return `- ${status} ${command.label}: ${command.command}`
  })
}

function formatPulseDiagnostics(pulse: ReturnType<typeof deriveLoopPulse>, label = "diagnostics"): string[] {
  return pulse.diagnostics.length > 0 ? [`${label}: ${formatList(pulse.diagnostics)}`] : []
}

async function readProofPlanOptions(host: CliHost): Promise<ProofPlanOptions> {
  if (!(await host.exists("package.json"))) return {}

  try {
    const manifest = JSON.parse(await host.readText("package.json")) as {
      packageManager?: unknown
      scripts?: unknown
    }

    return {
      packageManager: typeof manifest.packageManager === "string" ? manifest.packageManager : undefined,
      scripts: isStringRecord(manifest.scripts) ? manifest.scripts : undefined,
    }
  } catch {
    return {}
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false

  return Object.values(value).every((entry) => typeof entry === "string")
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
      pluginEntry: options.package ?? defaultOpenCodePackagePluginEntry,
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
    "Installed Runesmith OpenCode package plugin",
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

function resolveDashboardServerScript(): string {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js"

  return fileURLToPath(new URL(`./dashboard-server.${extension}`, import.meta.url))
}

function resolveDashboardDistDir(): string {
  return fileURLToPath(new URL("../../dashboard/dist", import.meta.url))
}

function resolveDashboardDistIndexPath(): string {
  return fileURLToPath(new URL("../../dashboard/dist/index.html", import.meta.url))
}

function resolveDashboardSourceDir(): string {
  return fileURLToPath(new URL("../../dashboard", import.meta.url))
}

if (import.meta.main) {
  const result = await runCli(Bun.argv.slice(2))
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  process.exit(result.exitCode)
}
