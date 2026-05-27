import {
  buildCovenantPrompt,
  createRuntime,
  createRunicCovenant,
  defaultRuntimeCapsulePath,
  loadRuntimeCapsule,
  saveRuntimeCapsule,
  type AgentContract,
  type EvidenceType,
  type RunicCovenant,
  type RunesmithRuntime,
  type RuntimeOptions,
  type RuntimeSnapshot,
} from "@runesmith/core"
import { dirname } from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export type ToolResponse = {
  title: string
  output: string
  metadata?: Record<string, unknown>
}

export type ToolDefinition<TArgs extends Record<string, unknown>> = {
  description: string
  parameters: Record<string, unknown>
  execute(args: TArgs): Promise<ToolResponse> | ToolResponse
}

export type RunesmithPlugin = {
  name: "runesmith"
  tool: {
    runesmith_autopilot_prepare: ToolDefinition<AutopilotPrepareArgs>
    runesmith_covenant_status: ToolDefinition<CovenantStatusArgs>
    runesmith_mission_start: ToolDefinition<MissionStartArgs>
    runesmith_mission_status: ToolDefinition<MissionStatusArgs>
    runesmith_task_claim: ToolDefinition<TaskClaimArgs>
    runesmith_task_evidence: ToolDefinition<TaskEvidenceArgs>
    runesmith_task_complete: ToolDefinition<TaskCompleteArgs>
    runesmith_recover: ToolDefinition<RecoverArgs>
  }
  experimental: {
    chat: {
      system: {
        transform(input: unknown, systemPrompt: string): Promise<string> | string
      }
    }
  }
  "experimental.chat.system.transform": (input: unknown, output: OpenCodeSystemOutput) => Promise<void> | void
  "experimental.session.compacting": (input: unknown, output: OpenCodeCompactionOutput) => Promise<void> | void
  "tool.execute.after": (input: OpenCodeToolInput, output: OpenCodeToolOutput) => Promise<void> | void
}

export type PluginOptions = RuntimeOptions & {
  runtime?: RunesmithRuntime
  contracts?: AgentContract[]
  covenant?: RunicCovenant
  runtimeStore?: PluginRuntimeStore
}

export type PluginRuntimeStore = {
  save(snapshot: RuntimeSnapshot): Promise<void> | void
}

type CovenantStatusArgs = Record<string, never>

type AutopilotPrepareArgs = {
  goal?: string
  messages?: unknown[]
}

type MissionStartArgs = {
  goal: string
  requiredCapabilities?: string[]
}

type MissionStatusArgs = {
  missionId: string
}

type TaskClaimArgs = {
  missionId: string
  taskId: string
  contractId: string
  holder: string
  idempotencyKey: string
  ttlMs?: number
}

type TaskEvidenceArgs = {
  missionId: string
  taskId: string
  type: EvidenceType
  summary: string
  payload?: Record<string, unknown>
  evidenceId?: string
}

type TaskCompleteArgs = {
  missionId: string
  taskId: string
  contractId: string
}

type RecoverArgs = {
  missionId: string
  staleAfterMs?: number
}

type OpenCodeSystemOutput = {
  system?: string[] | string
}

type OpenCodeCompactionOutput = {
  context?: string[]
  prompt?: string
}

type OpenCodeToolInput = {
  tool?: string
  [key: string]: unknown
}

type OpenCodeToolOutput = {
  args?: unknown
  result?: unknown
  [key: string]: unknown
}

const defaultAtlasContract: AgentContract = {
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

export function createRunesmithPlugin(options: PluginOptions = {}): RunesmithPlugin {
  const runtime = options.runtime ?? createRuntime(options)
  const covenant = options.covenant ?? createRunicCovenant()
  const covenantPrompt = buildCovenantPrompt(covenant)
  const autopilotPrompt = buildAutopilotPrompt()
  for (const contract of options.contracts ?? [defaultAtlasContract]) {
    runtime.registerContract(contract)
  }

  return {
    name: "runesmith",
    tool: {
      runesmith_autopilot_prepare: {
        description:
          "Prepare the current OpenCode request as a durable Runesmith mission and claim its root task automatically.",
        parameters: objectSchema({
          goal: stringSchema("Optional explicit mission goal. If omitted, Runesmith reads the latest user message."),
          messages: valueArraySchema("Recent OpenCode chat messages used to infer the mission goal."),
        }),
        async execute(args) {
          return prepareAutopilotMission({
            runtime,
            runtimeStore: options.runtimeStore,
            args,
          })
        },
      },
      runesmith_covenant_status: {
        description: "Return the active Runic Covenant autonomous workflow installed by Runesmith.",
        parameters: objectSchema({}),
        execute() {
          return formatValue("Runic Covenant active", {
            name: covenant.name,
            version: covenant.version,
            installMode: covenant.installMode,
            stageCount: covenant.stages.length,
            stages: covenant.stages.map((stage) => ({
              id: stage.id,
              name: stage.name,
              gates: stage.gates,
              evidence: stage.evidence,
            })),
          })
        },
      },
      runesmith_mission_start: {
        description: "Create a durable Runesmith mission graph from a user goal.",
        parameters: objectSchema({
          goal: stringSchema("Mission goal"),
          requiredCapabilities: arraySchema("Capabilities required by the root task"),
        }),
        async execute(args) {
          const result = runtime.startMission({
            goal: args.goal,
            requiredCapabilities: args.requiredCapabilities,
          })

          if (!result.ok) return formatError("Mission start rejected", result.error)

          return persistAndFormat(options.runtimeStore, runtime, "Mission started", {
            missionId: result.value.missionId,
            rootTaskId: result.value.rootTaskId,
            status: result.value.graph.mission.status,
          })
        },
      },
      runesmith_mission_status: {
        description: "Return the current graph status for a Runesmith mission.",
        parameters: objectSchema({
          missionId: stringSchema("Mission id"),
        }),
        execute(args) {
          const result = runtime.getMission(args.missionId)
          if (!result.ok) return formatError("Mission not found", result.error)

          const tasks = Object.values(result.value.tasks).map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            assignedAgentId: task.assignedAgentId,
          }))

          return formatValue("Mission status", {
            missionId: result.value.mission.id,
            status: result.value.mission.status,
            tasks,
          })
        },
      },
      runesmith_task_claim: {
        description: "Claim a mission task for an agent contract through the lease scheduler.",
        parameters: objectSchema({
          missionId: stringSchema("Mission id"),
          taskId: stringSchema("Task id"),
          contractId: stringSchema("Agent contract id"),
          holder: stringSchema("Lease holder name"),
          idempotencyKey: stringSchema("Stable idempotency key for this claim attempt"),
          ttlMs: numberSchema("Lease time to live in milliseconds"),
        }),
        async execute(args) {
          const result = runtime.claimTask({
            missionId: args.missionId,
            taskId: args.taskId,
            contractId: args.contractId,
            holder: args.holder,
            idempotencyKey: args.idempotencyKey,
            ttlMs: args.ttlMs ?? 30_000,
          })
          if (!result.ok) return formatError("Task claim rejected", result.error)

          return persistAndFormat(options.runtimeStore, runtime, "Task claimed", {
            taskId: result.value.task.id,
            status: result.value.task.status,
            assignedAgentId: result.value.task.assignedAgentId,
            leaseId: result.value.lease.id,
            replayed: result.value.replayed,
          })
        },
      },
      runesmith_task_evidence: {
        description: "Attach evidence to a mission task.",
        parameters: objectSchema({
          missionId: stringSchema("Mission id"),
          taskId: stringSchema("Task id"),
          type: stringSchema("Evidence type"),
          summary: stringSchema("Short evidence summary"),
          payload: objectSchema({}),
          evidenceId: stringSchema("Optional stable evidence id"),
        }),
        async execute(args) {
          const result = runtime.addTaskEvidence({
            missionId: args.missionId,
            evidence: {
              id: args.evidenceId ?? `evidence_${crypto.randomUUID()}`,
              taskId: args.taskId,
              type: args.type,
              summary: args.summary,
              payload: args.payload ?? {},
              createdAt: new Date().toISOString(),
            },
          })
          if (!result.ok) return formatError("Evidence rejected", result.error)

          return persistAndFormat(options.runtimeStore, runtime, "Evidence recorded", {
            taskId: args.taskId,
            type: args.type,
          })
        },
      },
      runesmith_task_complete: {
        description: "Attempt to complete a task after required evidence validation.",
        parameters: objectSchema({
          missionId: stringSchema("Mission id"),
          taskId: stringSchema("Task id"),
          contractId: stringSchema("Agent contract id"),
        }),
        async execute(args) {
          const result = runtime.completeTask(args)
          if (!result.ok) return formatError("Task completion rejected", result.error)

          return persistAndFormat(options.runtimeStore, runtime, "Task completed", {
            taskId: result.value.task.id,
            status: result.value.task.status,
            missionStatus: result.value.graph.mission.status,
          })
        },
      },
      runesmith_recover: {
        description: "Run Runesmith recovery policies for a mission.",
        parameters: objectSchema({
          missionId: stringSchema("Mission id"),
          staleAfterMs: numberSchema("Heartbeat threshold in milliseconds"),
        }),
        async execute(args) {
          const result = runtime.recover({
            missionId: args.missionId,
            staleAfterMs: args.staleAfterMs ?? 120_000,
          })
          if (!result.ok) return formatError("Recovery rejected", result.error)

          return persistAndFormat(options.runtimeStore, runtime, "Recovery complete", {
            missionId: result.value.graph.mission.id,
            status: result.value.graph.mission.status,
            staleTasks: Object.values(result.value.graph.tasks)
              .filter((task) => task.status === "stale")
              .map((task) => task.id),
          })
        },
      },
    },
    experimental: {
      chat: {
        system: {
          transform(_input, systemPrompt) {
            return appendPromptSections(systemPrompt, [covenantPrompt, autopilotPrompt])
          },
        },
      },
    },
    "experimental.chat.system.transform"(_input, output) {
      appendSystemSections(output, [covenantPrompt, autopilotPrompt])
    },
    "experimental.session.compacting"(_input, output) {
      appendCompactionContext(output, runtime.snapshot())
    },
    async "tool.execute.after"(input, output) {
      await recordToolExecutionEvidence({
        runtime,
        runtimeStore: options.runtimeStore,
        input,
        output,
      })
    },
  }
}

export default async function RunesmithOpenCodePlugin(): Promise<RunesmithPlugin> {
  const host = createNodeRuntimeStoreHost()
  const capsule = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
  const snapshot = capsule.ok ? capsule.value?.runtime : undefined

  return createRunesmithPlugin({
    snapshot,
    runtimeStore: {
      async save(nextSnapshot) {
        await saveRuntimeCapsule(host, {
          path: defaultRuntimeCapsulePath,
          snapshot: nextSnapshot,
        })
      },
    },
  })
}

type PrepareAutopilotMissionInput = {
  runtime: RunesmithRuntime
  runtimeStore?: PluginRuntimeStore
  args: AutopilotPrepareArgs
}

async function prepareAutopilotMission(input: PrepareAutopilotMissionInput): Promise<ToolResponse> {
  const goal = normalizeGoal(input.args.goal) ?? extractLatestUserGoal(input.args.messages)
  if (!goal) {
    return formatError("Autopilot preparation rejected", {
      code: "AUTOPILOT_GOAL_MISSING",
      message: "Runesmith could not infer a user goal from the current OpenCode messages.",
    })
  }

  const existing = findActiveMissionForGoal(input.runtime.snapshot(), goal)
  let missionId = existing?.mission.id
  let taskId = existing?.mission.rootTaskId
  let missionCreated = false

  if (!missionId || !taskId) {
    const started = input.runtime.startMission({ goal })
    if (!started.ok) return formatError("Autopilot mission start rejected", started.error)

    missionId = started.value.missionId
    taskId = started.value.rootTaskId
    missionCreated = true
    await persistRuntime(input.runtimeStore, input.runtime)
  }

  const claimed = input.runtime.claimTask({
    missionId,
    taskId,
    contractId: defaultAtlasContract.id,
    holder: "runesmith-autopilot",
    idempotencyKey: `autopilot:${fingerprint(goal)}`,
    ttlMs: 30_000,
  })
  if (!claimed.ok) return formatError("Autopilot task claim rejected", claimed.error)

  await persistRuntime(input.runtimeStore, input.runtime)

  return formatValue("Autopilot mission prepared", {
    missionId,
    taskId,
    leaseId: claimed.value.lease.id,
    agentId: claimed.value.task.assignedAgentId,
    goal,
    replayed: claimed.value.replayed,
    missionCreated,
  })
}

type RecordToolExecutionEvidenceInput = {
  runtime: RunesmithRuntime
  runtimeStore?: PluginRuntimeStore
  input: OpenCodeToolInput
  output: OpenCodeToolOutput
}

async function recordToolExecutionEvidence(input: RecordToolExecutionEvidenceInput): Promise<void> {
  const tool = normalizeGoal(input.input.tool)
  if (!tool || tool.startsWith("runesmith_")) return

  const snapshot = input.runtime.snapshot()
  const target = selectActiveTask(snapshot)
  if (!target) return

  const args = asRecord(input.output.args) ?? {}
  const result = asRecord(input.output.result) ?? asRecord(input.output)
  const evidence = classifyToolEvidence(tool, args, result)
  if (!evidence) return

  const recorded = input.runtime.addTaskEvidence({
    missionId: target.missionId,
    evidence: {
      id: buildAutomaticEvidenceId(tool, target.taskId, args, result),
      taskId: target.taskId,
      type: evidence.type,
      summary: evidence.summary,
      payload: {
        tool,
        ...evidence.payload,
      },
      createdAt: new Date().toISOString(),
    },
  })

  if (recorded.ok) {
    await persistRuntime(input.runtimeStore, input.runtime)
  }
}

function selectActiveTask(snapshot: RuntimeSnapshot): { missionId: string; taskId: string } | undefined {
  const terminalMissionStatuses = new Set(["complete", "failed", "cancelled"])
  const terminalTaskStatuses = new Set(["complete", "failed", "cancelled"])
  const statusRank: Record<string, number> = {
    running: 0,
    verifying: 1,
    queued: 2,
    stale: 3,
    blocked: 4,
  }

  return Object.values(snapshot.graphs)
    .filter((graph) => !terminalMissionStatuses.has(graph.mission.status))
    .flatMap((graph) => {
      return Object.values(graph.tasks)
        .filter((task) => !terminalTaskStatuses.has(task.status))
        .map((task) => ({
          missionId: graph.mission.id,
          taskId: task.id,
          status: task.status,
          updatedAt: task.updatedAt,
        }))
    })
    .sort((left, right) => {
      const statusDelta = (statusRank[left.status] ?? 99) - (statusRank[right.status] ?? 99)
      if (statusDelta !== 0) return statusDelta
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    })[0]
}

function classifyToolEvidence(
  tool: string,
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
): { type: EvidenceType; summary: string; payload: Record<string, unknown> } | undefined {
  const lowerTool = tool.toLowerCase()
  const command = normalizeGoal(args.command)
  const filePath = extractFilePath(args)
  const exitCode = extractExitCode(result)

  if (isReadOnlyTool(lowerTool)) return undefined

  if (isFileMutationTool(lowerTool)) {
    return {
      type: "file-change",
      summary: filePath ? `${tool} changed ${filePath}` : `${tool} changed files`,
      payload: {
        filePath,
        args: sanitizeForPayload(args),
        result: summarizeResult(result),
      },
    }
  }

  if (isShellTool(lowerTool)) {
    const isTest = command ? isTestCommand(command) : false
    return {
      type: isTest ? "test-result" : "command-output",
      summary: command ? `${tool} ran ${command}` : `${tool} executed`,
      payload: {
        command,
        exitCode,
        args: sanitizeForPayload(args),
        result: summarizeResult(result),
      },
    }
  }

  return {
    type: "command-output",
    summary: `${tool} executed`,
    payload: {
      filePath,
      exitCode,
      args: sanitizeForPayload(args),
      result: summarizeResult(result),
    },
  }
}

function isReadOnlyTool(tool: string): boolean {
  return [
    "read",
    "grep",
    "glob",
    "list",
    "ls",
    "find",
    "search",
  ].some((name) => tool === name || tool.endsWith(`.${name}`))
}

function isFileMutationTool(tool: string): boolean {
  return [
    "edit",
    "write",
    "patch",
    "apply_patch",
    "multiedit",
  ].some((name) => tool === name || tool.includes(name))
}

function isShellTool(tool: string): boolean {
  return ["bash", "shell", "terminal", "exec", "command"].some((name) => tool === name || tool.includes(name))
}

function isTestCommand(command: string): boolean {
  const normalized = command.toLowerCase()
  return [
    " test",
    "bun test",
    "npm test",
    "pnpm test",
    "yarn test",
    "vitest",
    "jest",
    "playwright",
    "cypress",
    "cargo test",
    "go test",
    "pytest",
    "rspec",
  ].some((needle) => normalized.includes(needle.trim()))
}

function extractFilePath(args: Record<string, unknown>): string | undefined {
  return normalizeGoal(args.filePath)
    ?? normalizeGoal(args.file)
    ?? normalizeGoal(args.path)
    ?? normalizeGoal(args.target)
}

function extractExitCode(result: Record<string, unknown> | undefined): number | undefined {
  const value = result?.exitCode ?? result?.code ?? result?.statusCode
  return typeof value === "number" ? value : undefined
}

function summarizeResult(result: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!result) return undefined

  return {
    exitCode: extractExitCode(result),
    status: normalizeGoal(result.status),
    stdout: truncateText(normalizeGoal(result.stdout), 1_000),
    stderr: truncateText(normalizeGoal(result.stderr), 1_000),
    output: truncateText(normalizeGoal(result.output), 1_000),
    message: truncateText(normalizeGoal(result.message), 1_000),
  }
}

function sanitizeForPayload(value: unknown): unknown {
  if (typeof value === "string") return truncateText(value, 1_000)
  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeForPayload)

  const record = asRecord(value)
  if (!record) return undefined

  return Object.fromEntries(
    Object.entries(record)
      .slice(0, 25)
      .map(([key, entry]) => [key, sanitizeForPayload(entry)]),
  )
}

function truncateText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value
}

function buildAutomaticEvidenceId(
  tool: string,
  taskId: string,
  args: Record<string, unknown>,
  result: Record<string, unknown> | undefined,
): string {
  const stableExecutionId = normalizeGoal(result?.id)
    ?? normalizeGoal(result?.toolCallId)
    ?? normalizeGoal(result?.callId)
    ?? normalizeGoal(args.id)
    ?? normalizeGoal(args.toolCallId)
    ?? normalizeGoal(args.callId)

  if (stableExecutionId) {
    return `evidence_auto_${fingerprint(`${taskId}:${tool}:${stableExecutionId}`)}`
  }

  return `evidence_auto_${fingerprint(`${taskId}:${tool}:${JSON.stringify(sanitizeForPayload(args))}`)}_${crypto.randomUUID()}`
}

function buildAutopilotPrompt(): string {
  return [
    "## Runesmith Autopilot",
    "Runesmith is installed as the orchestration engine for this OpenCode session.",
    "When the user asks for coding, repo, debugging, UI, or research-to-implementation work, call `runesmith_autopilot_prepare` with the latest user goal or message list before starting edits.",
    "Continue under the returned mission, task, and lease. Runesmith records shell, test, and file-change tool evidence automatically; use `runesmith_task_evidence` only for decisions, risks, diagnostics, or external proof the tool hooks cannot see.",
    "Do not ask the user to invoke Runesmith, skills, or a workflow by name. Keep the user experience install-once and direct.",
    "Before claiming completion, attach required evidence and use `runesmith_task_complete`; if state looks stale or conflicting, run `runesmith_recover` first.",
  ].join("\n")
}

function appendPromptSections(systemPrompt: string, sections: string[]): string {
  let next = systemPrompt.trimEnd()

  for (const section of sections) {
    const heading = sectionHeading(section)
    if (next.includes(heading)) continue
    next = next.length > 0 ? `${next}\n\n${section}` : section
  }

  return next
}

function appendSystemSections(output: OpenCodeSystemOutput, sections: string[]): void {
  const system =
    typeof output.system === "string"
      ? [output.system]
      : Array.isArray(output.system)
        ? output.system
        : []
  let joined = system.join("\n")

  for (const section of sections) {
    const heading = sectionHeading(section)
    if (joined.includes(heading)) continue
    system.push(section)
    joined = `${joined}\n${section}`
  }

  output.system = system
}

function appendCompactionContext(output: OpenCodeCompactionOutput, snapshot: RuntimeSnapshot): void {
  const context = output.context ?? []
  const summary = buildMissionCapsuleSummary(snapshot)
  if (!context.join("\n").includes("## Runesmith Mission Capsule")) {
    context.push(summary)
  }
  output.context = context
}

function buildMissionCapsuleSummary(snapshot: RuntimeSnapshot): string {
  const graphs = Object.values(snapshot.graphs)
  if (graphs.length === 0) {
    return [
      "## Runesmith Mission Capsule",
      "No Runesmith missions have been started in this capsule yet.",
    ].join("\n")
  }

  const missionBlocks = graphs.map((graph) => {
    const ledger = snapshot.ledgers[graph.mission.id]
    const evidenceCount = Object.keys(ledger?.evidence ?? {}).length
    const taskLines = Object.values(graph.tasks).map((task) => {
      const assignee = task.assignedAgentId ? `; agent=${task.assignedAgentId}` : ""
      return `  - ${task.id}: ${task.status}; ${task.title}${assignee}`
    })
    const leaseLines = Object.values(snapshot.leases.leases)
      .filter((lease) => graph.tasks[lease.targetId])
      .map((lease) => `  - lease ${lease.id}: ${lease.status}; target=${lease.targetId}; holder=${lease.holder}`)

    return [
      `- ${graph.mission.id}: ${graph.mission.status}; goal=${graph.mission.goal}; root=${graph.mission.rootTaskId}; evidence=${evidenceCount}`,
      ...taskLines,
      ...leaseLines,
    ].join("\n")
  })

  return [
    "## Runesmith Mission Capsule",
    "Preserve this orchestration state across compaction. Continue existing running work before starting duplicate missions.",
    ...missionBlocks,
  ].join("\n")
}

function findActiveMissionForGoal(snapshot: RuntimeSnapshot, goal: string) {
  const normalizedGoal = normalizeGoal(goal)
  if (!normalizedGoal) return undefined

  return Object.values(snapshot.graphs).find((graph) => {
    if (["complete", "failed", "cancelled"].includes(graph.mission.status)) return false
    return normalizeGoal(graph.mission.goal) === normalizedGoal
  })
}

function extractLatestUserGoal(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asRecord(messages[index])
    if (!message) continue

    const role = stringValue(message.role) ?? stringValue(asRecord(message.info)?.role)
    if (role !== "user") continue

    const text = extractMessageText(message)
    const goal = normalizeGoal(text)
    if (goal) return goal
  }

  return undefined
}

function extractMessageText(message: Record<string, unknown>): string | undefined {
  const candidates = [message.text, message.content, message.parts]
  const text = candidates.map(extractTextValue).filter(Boolean).join("\n")
  return text.length > 0 ? text : undefined
}

function extractTextValue(value: unknown): string {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map(extractTextValue).filter(Boolean).join("\n")

  const record = asRecord(value)
  if (!record) return ""

  return [record.text, record.content].map(extractTextValue).filter(Boolean).join("\n")
}

function normalizeGoal(goal: unknown): string | undefined {
  if (typeof goal !== "string") return undefined
  const normalized = goal.replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : undefined
}

function fingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return (hash >>> 0).toString(36)
}

function sectionHeading(section: string): string {
  return section.split("\n", 1)[0] ?? section
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return undefined
}

function formatValue(title: string, value: Record<string, unknown>): ToolResponse {
  return {
    title,
    output: JSON.stringify({ ok: true, value }, null, 2),
    metadata: value,
  }
}

function formatError(title: string, error: Record<string, unknown>): ToolResponse {
  return {
    title,
    output: JSON.stringify({ ok: false, error }, null, 2),
    metadata: { error },
  }
}

async function persistAndFormat(
  runtimeStore: PluginRuntimeStore | undefined,
  runtime: RunesmithRuntime,
  title: string,
  value: Record<string, unknown>,
): Promise<ToolResponse> {
  await persistRuntime(runtimeStore, runtime)

  return formatValue(title, value)
}

async function persistRuntime(
  runtimeStore: PluginRuntimeStore | undefined,
  runtime: RunesmithRuntime,
): Promise<void> {
  if (runtimeStore) {
    await runtimeStore.save(runtime.snapshot())
  }
}

function createNodeRuntimeStoreHost() {
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

function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "object",
    properties,
    additionalProperties: false,
  }
}

function stringSchema(description: string): Record<string, unknown> {
  return {
    type: "string",
    description,
  }
}

function numberSchema(description: string): Record<string, unknown> {
  return {
    type: "number",
    description,
  }
}

function arraySchema(description: string): Record<string, unknown> {
  return {
    type: "array",
    description,
    items: {
      type: "string",
    },
  }
}

function valueArraySchema(description: string): Record<string, unknown> {
  return {
    type: "array",
    description,
    items: {},
  }
}
