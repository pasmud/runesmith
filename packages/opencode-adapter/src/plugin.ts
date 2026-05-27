import {
  advanceRunicMissionLoop,
  buildCovenantControlBrief,
  buildCovenantPrompt,
  buildLoopPulsePrompt,
  buildMissionMapPrompt,
  buildMissionMemoryPrompt,
  buildProofPlanPrompt,
  buildReviewLensPrompt,
  buildRunicProtocolPrompt,
  buildRunebookPrompt,
  buildScopeSentinelPrompt,
  buildSealAuditPrompt,
  createRuntime,
  createRunicCovenant,
  defaultProjectConfigPath,
  deriveCovenantControlBrief,
  deriveLoopPulse,
  deriveMissionMap,
  deriveMissionMemory,
  deriveProofPlan,
  deriveReviewLens,
  deriveRunicProtocolDeck,
  deriveRunebook,
  deriveScopeSentinel,
  deriveSealAudit,
  prepareRunicMission,
  repairProjectConfig,
  repairRuntimeCapsule,
  resolveRunicRisk,
  runRuneweave,
  runRunebookNext,
  runProofPlan,
  runtimeCapsulePathFromConfig,
  saveRuntimeCapsule,
  selectRunicLoopTask,
  type AgentContract,
  type EvidenceType,
  type IdFactory,
  type MissionEvent,
  type ProofCommandExecution,
  type ProofCommandRunner,
  type ProofPlan,
  type ProofPlanCommand,
  type ProofPlanOptions,
  type RunicCovenant,
  type RuneweaveValue,
  type RunesmithRuntime,
  type RiskResolutionVerdict,
  type RuntimeOptions,
  type RuntimeSnapshot,
  type RuntimeStoreHost,
} from "@runesmith/core"
import { dirname } from "node:path"
import { spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

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
    runesmith_next: ToolDefinition<NextArgs>
    runesmith_os_run: ToolDefinition<OsRunArgs>
    runesmith_autopilot_tick: ToolDefinition<AutopilotTickArgs>
    runesmith_proof_run: ToolDefinition<ProofRunArgs>
    runesmith_risk_resolve: ToolDefinition<RiskResolveArgs>
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
  "experimental.chat.messages.transform": (input: unknown, output: OpenCodeMessagesOutput) => Promise<void> | void
  "experimental.session.compacting": (input: unknown, output: OpenCodeCompactionOutput) => Promise<void> | void
  "tool.execute.before": (input: OpenCodeToolInput, output: OpenCodeToolOutput) => Promise<void> | void
  "tool.execute.after": (input: OpenCodeToolInput, output: OpenCodeToolOutput) => Promise<void> | void
  config: (config: OpenCodeConfig) => Promise<void> | void
  event?: (input: OpenCodeEventInput) => Promise<void> | void
}

export type PluginOptions = RuntimeOptions & {
  runtime?: RunesmithRuntime
  contracts?: AgentContract[]
  covenant?: RunicCovenant
  proofPlanOptions?: ProofPlanOptions | false
  proofCommandRunner?: ProofCommandRunner
  runtimeStore?: PluginRuntimeStore
}

export type PluginRuntimeStore = {
  save(snapshot: RuntimeSnapshot): Promise<void> | void
}

export type OpenCodePluginFactoryOptions = PluginOptions & {
  host?: RuntimeStoreHost
  capsulePath?: string
}

type CovenantStatusArgs = Record<string, never>

type AutopilotPrepareArgs = {
  goal?: string
  messages?: unknown[]
}

type NextArgs = {
  riskSummary?: string
  riskVerdict?: RiskResolutionVerdict
  evidenceId?: string
}

type OsRunArgs = NextArgs & {
  maxSteps?: number
}

type AutopilotTickArgs = Record<string, never>

type ProofRunArgs = Record<string, never>

type RiskResolveArgs = {
  verdict?: RiskResolutionVerdict
  summary?: string
  evidenceId?: string
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

type OpenCodeMessagesOutput = {
  messages?: unknown[]
}

type OpenCodeConfig = {
  skills?: {
    paths?: unknown[]
    [key: string]: unknown
  }
  [key: string]: unknown
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

type OpenCodeEventInput = {
  event?: unknown
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

const autopilotStaleAfterMs = 120_000
const shellProofCaptureLimit = 64_000
const runesmithOpenCodeSkillsPath = fileURLToPath(new URL("../../../.opencode/skills", import.meta.url))

export function createRunesmithPlugin(options: PluginOptions = {}): RunesmithPlugin {
  const runtime = options.runtime ?? createRuntime(options)
  const covenant = options.covenant ?? createRunicCovenant()
  const proofPlanOptions = resolveProofPlanOptions(options.proofPlanOptions)
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
          "Prepare the current OpenCode request as a planned Runesmith mission and claim its next ready task automatically.",
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
      runesmith_next: {
        description:
          "Run the current Runesmith Runebook card: prove, recover, resolve risk when given a decision summary, or advance the shared loop as appropriate.",
        parameters: objectSchema({
          riskSummary: stringSchema("Optional decision summary when the active Runebook card is a risk hold"),
          riskVerdict: stringSchema("Optional risk verdict: accepted or cleared"),
          evidenceId: stringSchema("Optional stable risk decision evidence id"),
        }),
        async execute(args) {
          return runNextFromOpenCode({
            runtime,
            proofPlanOptions,
            proofCommandRunner: options.proofCommandRunner,
            runtimeStore: options.runtimeStore,
            idFactory: options.idFactory,
            now: options.now,
            args,
          })
        },
      },
      runesmith_os_run: {
        description:
          "Run the Runeweave OS loop: repeatedly execute engine-owned Runebook actions until work is sealed, proof fails, Faultline needs architecture review, risk needs a decision, or implementation work is required.",
        parameters: objectSchema({
          maxSteps: numberSchema("Optional safety limit for Runebook actions in this OS run"),
          riskSummary: stringSchema("Optional decision summary when the loop reaches a risk hold"),
          riskVerdict: stringSchema("Optional risk verdict: accepted or cleared"),
          evidenceId: stringSchema("Optional stable risk decision evidence id"),
        }),
        async execute(args) {
          return runOsFromOpenCode({
            runtime,
            proofPlanOptions,
            proofCommandRunner: options.proofCommandRunner,
            runtimeStore: options.runtimeStore,
            idFactory: options.idFactory,
            now: options.now,
            args,
          })
        },
      },
      runesmith_autopilot_tick: {
        description:
          "Advance the active Runesmith mission when the current task has enough automatically captured evidence.",
        parameters: objectSchema({}),
        async execute() {
          return advanceAutopilotLoop({
            runtime,
            proofPlanOptions,
            runtimeStore: options.runtimeStore,
          })
        },
      },
      runesmith_proof_run: {
        description:
          "Execute the active Runesmith Proof Plan, record proof or diagnostic evidence, and advance the mission when proof passes.",
        parameters: objectSchema({}),
        async execute() {
          return runProofFromOpenCode({
            runtime,
            proofPlanOptions,
            proofCommandRunner: options.proofCommandRunner,
            runtimeStore: options.runtimeStore,
            idFactory: options.idFactory,
            now: options.now,
          })
        },
      },
      runesmith_risk_resolve: {
        description:
          "Record an explicit decision for the active unresolved risk, then advance the Runesmith mission through the evidence gate.",
        parameters: objectSchema({
          verdict: stringSchema("Risk decision verdict: accepted or cleared"),
          summary: stringSchema("Short decision summary explaining why the active risk can proceed"),
          evidenceId: stringSchema("Optional stable decision evidence id"),
        }),
        async execute(args) {
          return resolveRiskFromOpenCode({
            runtime,
            proofPlanOptions,
            runtimeStore: options.runtimeStore,
            idFactory: options.idFactory,
            now: options.now,
            args,
          })
        },
      },
      runesmith_covenant_status: {
        description: "Return the active Runic Covenant autonomous workflow installed by Runesmith.",
        parameters: objectSchema({}),
        execute() {
          const snapshot = runtime.snapshot()
          const controlBrief = deriveCovenantControlBrief(snapshot, covenant)
          const loopPulse = deriveLoopPulse(snapshot, covenant)
          const missionMap = deriveMissionMap(snapshot)
          const scopeSentinel = deriveScopeSentinel(snapshot)
          const reviewLens = deriveReviewLens(snapshot)
          const sealAudit = deriveSealAudit(snapshot, proofPlanOptions)
          const missionMemory = deriveMissionMemory(snapshot, covenant)
          const proofPlan = deriveProofPlan(snapshot, proofPlanOptions)
          const runebook = deriveRunebook(snapshot, { proofPlanOptions, covenant })
          const protocolDeck = deriveRunicProtocolDeck(snapshot, { proofPlanOptions, covenant })

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
            controlBrief: {
              status: controlBrief.status,
              stage: {
                id: controlBrief.stage.id,
                name: controlBrief.stage.name,
              },
              missionId: controlBrief.missionId,
              taskId: controlBrief.taskId,
              missionGoal: controlBrief.missionGoal,
              taskTitle: controlBrief.taskTitle,
              taskStatus: controlBrief.taskStatus,
              assignedAgentId: controlBrief.assignedAgentId,
              requiredEvidence: controlBrief.requiredEvidence,
              missingEvidence: controlBrief.missingEvidence,
              directives: controlBrief.directives,
            },
            loopPulse,
            missionMap,
            scopeSentinel,
            reviewLens,
            sealAudit,
            missionMemory,
            proofPlan,
            runebook,
            protocolDeck,
            activeRunes: controlBrief.runes,
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
              createdAt: nowIso(options.now),
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
          const before = runtime.snapshot().graphs[args.missionId]
          const result = runtime.recover({
            missionId: args.missionId,
            staleAfterMs: args.staleAfterMs ?? autopilotStaleAfterMs,
            requeueStale: true,
          })
          if (!result.ok) return formatError("Recovery rejected", result.error)

          return persistAndFormat(options.runtimeStore, runtime, "Recovery complete", {
            missionId: result.value.graph.mission.id,
            status: result.value.graph.mission.status,
            staleTasks: Object.values(result.value.graph.tasks)
              .filter((task) => task.status === "stale")
              .map((task) => task.id),
            requeuedTasks: Object.values(result.value.graph.tasks)
              .filter((task) => {
                const previous = before?.tasks[task.id]
                return task.status === "queued" && previous && ["running", "stale"].includes(previous.status)
              })
              .map((task) => task.id),
          })
        },
      },
    },
    experimental: {
      chat: {
        system: {
          transform(_input, systemPrompt) {
            const snapshot = runtime.snapshot()
            let prompt = appendPromptSections(systemPrompt, [covenantPrompt, autopilotPrompt])
            prompt = upsertPromptSection(prompt, buildCovenantControlBrief(snapshot, covenant))
            prompt = upsertPromptSection(prompt, buildLoopPulsePrompt(snapshot, covenant))
            prompt = upsertPromptSection(prompt, buildMissionMapPrompt(snapshot))
            prompt = upsertPromptSection(prompt, buildScopeSentinelPrompt(snapshot))
            prompt = upsertPromptSection(prompt, buildReviewLensPrompt(snapshot))
            prompt = upsertPromptSection(prompt, buildSealAuditPrompt(snapshot, proofPlanOptions))
            prompt = upsertPromptSection(prompt, buildRunebookPrompt(snapshot, { proofPlanOptions, covenant }))
            prompt = upsertPromptSection(prompt, buildRunicProtocolPrompt(snapshot, { proofPlanOptions, covenant }))
            prompt = upsertPromptSection(prompt, buildMissionMemoryPrompt(snapshot, covenant))
            return upsertPromptSection(prompt, buildProofPlanPrompt(snapshot, proofPlanOptions, covenant))
          },
        },
      },
    },
    "experimental.chat.system.transform"(_input, output) {
      const snapshot = runtime.snapshot()
      appendSystemSections(output, [covenantPrompt, autopilotPrompt])
      upsertSystemSection(output, buildCovenantControlBrief(snapshot, covenant))
      upsertSystemSection(output, buildLoopPulsePrompt(snapshot, covenant))
      upsertSystemSection(output, buildMissionMapPrompt(snapshot))
      upsertSystemSection(output, buildScopeSentinelPrompt(snapshot))
      upsertSystemSection(output, buildReviewLensPrompt(snapshot))
      upsertSystemSection(output, buildSealAuditPrompt(snapshot, proofPlanOptions))
      upsertSystemSection(output, buildRunebookPrompt(snapshot, { proofPlanOptions, covenant }))
      upsertSystemSection(output, buildRunicProtocolPrompt(snapshot, { proofPlanOptions, covenant }))
      upsertSystemSection(output, buildMissionMemoryPrompt(snapshot, covenant))
      upsertSystemSection(output, buildProofPlanPrompt(snapshot, proofPlanOptions, covenant))
    },
    "experimental.chat.messages.transform"(_input, output) {
      injectMessageBootstrap(output, runtime.snapshot(), covenant, proofPlanOptions)
    },
    "experimental.session.compacting"(_input, output) {
      appendCompactionContext(output, runtime.snapshot(), proofPlanOptions)
    },
    async "tool.execute.before"(input, output) {
      await prepareBeforeToolExecution({
        runtime,
        runtimeStore: options.runtimeStore,
        input,
        output,
      })
    },
    async "tool.execute.after"(input, output) {
      await recordToolExecutionEvidence({
        runtime,
        runtimeStore: options.runtimeStore,
        now: options.now,
        input,
        output,
      })
      await advanceAutopilotLoop({
        runtime,
        proofPlanOptions,
        runtimeStore: options.runtimeStore,
        recoverStale: false,
      })
    },
    config(config) {
      registerRunesmithSkillsPath(config)
    },
    async event(input) {
      if (getOpenCodeEventType(input) !== "session.idle") return

      await advanceIdleOrchestration({
        runtime,
        proofPlanOptions,
        proofCommandRunner: options.proofCommandRunner,
        runtimeStore: options.runtimeStore,
        idFactory: options.idFactory,
        now: options.now,
        eventInput: input,
      })
    },
  }
}

export async function createRunesmithOpenCodePlugin(
  options: OpenCodePluginFactoryOptions = {},
): Promise<RunesmithPlugin> {
  const host = options.host ?? createNodeRuntimeStoreHost()
  const projectConfig = await repairProjectConfig(host, {
    path: defaultProjectConfigPath,
  })
  const capsulePath = options.capsulePath
    ?? (projectConfig.ok
      ? runtimeCapsulePathFromConfig(projectConfig.value.config)
      : runtimeCapsulePathFromConfig())
  const fallbackSnapshot = options.snapshot ?? {
    graphs: {},
    ledgers: {},
    leases: { leases: {} },
    contracts: {},
  }
  const capsule = await repairRuntimeCapsule(host, {
    path: capsulePath,
    snapshot: fallbackSnapshot,
    now: options.now,
  })
  const runtime = options.runtime ?? createRuntime({
    ...options,
    snapshot: capsule.ok ? capsule.value.capsule.runtime : fallbackSnapshot,
  })
  const runtimeStore: PluginRuntimeStore = {
    async save(nextSnapshot) {
      await saveRuntimeCapsule(host, {
        path: capsulePath,
        snapshot: nextSnapshot,
      })
      await options.runtimeStore?.save(nextSnapshot)
    },
  }

  return createRunesmithPlugin({
    ...options,
    runtime,
    runtimeStore,
  })
}

export default async function RunesmithOpenCodePlugin(): Promise<RunesmithPlugin> {
  return createRunesmithOpenCodePlugin()
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

  const prepared = prepareRunicMission(input.runtime, {
    goal,
    contract: defaultAtlasContract,
    holder: "runesmith-autopilot",
    idempotencyScope: "autopilot",
    ttlMs: 30_000,
  })
  if (!prepared.ok) return formatError("Autopilot preparation rejected", prepared.error)

  await persistRuntime(input.runtimeStore, input.runtime)

  return formatValue("Autopilot mission prepared", {
    missionId: prepared.value.missionId,
    taskId: prepared.value.taskId,
    leaseId: prepared.value.leaseId,
    agentId: prepared.value.agentId,
    goal: prepared.value.goal,
    replayed: prepared.value.replayed,
    missionCreated: prepared.value.missionCreated,
  })
}

type PrepareBeforeToolExecutionInput = {
  runtime: RunesmithRuntime
  runtimeStore?: PluginRuntimeStore
  input: OpenCodeToolInput
  output: OpenCodeToolOutput
}

async function prepareBeforeToolExecution(input: PrepareBeforeToolExecutionInput): Promise<void> {
  const tool = normalizeGoal(input.input.tool)
  if (!tool) return

  const lowerTool = tool.toLowerCase()
  if (tool.startsWith("runesmith_") || isReadOnlyTool(lowerTool)) return
  if (selectRunicLoopTask(input.runtime.snapshot())) return

  const messages = extractMessages(input.input) ?? extractMessages(input.output)
  const goal = normalizeGoal(input.input.goal) ?? normalizeGoal(input.output.goal) ?? extractLatestUserGoal(messages)
  if (!goal) return

  await prepareAutopilotMission({
    runtime: input.runtime,
    runtimeStore: input.runtimeStore,
    args: {
      goal,
      messages,
    },
  })
}

type RecordToolExecutionEvidenceInput = {
  runtime: RunesmithRuntime
  runtimeStore?: PluginRuntimeStore
  now?: () => Date
  input: OpenCodeToolInput
  output: OpenCodeToolOutput
}

async function recordToolExecutionEvidence(input: RecordToolExecutionEvidenceInput): Promise<void> {
  const tool = normalizeGoal(input.input.tool)
  if (!tool || tool.startsWith("runesmith_")) return

  const snapshot = input.runtime.snapshot()
  const target = selectRunicLoopTask(snapshot)
  if (!target) return

  const args = extractToolArgs(input.input, input.output)
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
      createdAt: nowIso(input.now),
    },
  })

  if (recorded.ok) {
    await persistRuntime(input.runtimeStore, input.runtime)
  }
}

function nowIso(now: (() => Date) | undefined): string {
  return (now ?? (() => new Date()))().toISOString()
}

function extractToolArgs(input: OpenCodeToolInput, output: OpenCodeToolOutput): Record<string, unknown> {
  return {
    ...(asRecord(input.args) ?? asRecord(input.arguments) ?? asRecord(input.toolArgs) ?? {}),
    ...(asRecord(output.args) ?? asRecord(output.arguments) ?? asRecord(output.toolArgs) ?? {}),
  }
}

type AdvanceAutopilotLoopInput = {
  runtime: RunesmithRuntime
  proofPlanOptions?: ProofPlanOptions
  runtimeStore?: PluginRuntimeStore
  recoverStale?: boolean
}

type AdvanceIdleOrchestrationInput = {
  runtime: RunesmithRuntime
  proofPlanOptions?: ProofPlanOptions
  proofCommandRunner?: ProofCommandRunner
  runtimeStore?: PluginRuntimeStore
  idFactory?: IdFactory
  now?: () => Date
  eventInput?: OpenCodeEventInput
}

async function advanceIdleOrchestration(input: AdvanceIdleOrchestrationInput): Promise<void> {
  let snapshot = input.runtime.snapshot()
  let loopPulse = deriveLoopPulse(snapshot)

  if (loopPulse.nextAction.id === "wait-for-goal") {
    const messages = extractMessages(input.eventInput) ?? extractMessages(asRecord(input.eventInput?.event))
    const goal = normalizeGoal(asRecord(input.eventInput?.event)?.goal)
      ?? normalizeGoal(input.eventInput?.goal)
      ?? extractLatestUserGoal(messages)

    if (goal) {
      await prepareAutopilotMission({
        runtime: input.runtime,
        runtimeStore: input.runtimeStore,
        args: {
          goal,
          messages,
        },
      })
      snapshot = input.runtime.snapshot()
      loopPulse = deriveLoopPulse(snapshot)
    } else {
      return
    }
  }

  if (!loopPulse.missionId) return

  const proofPlan = deriveProofPlan(snapshot, input.proofPlanOptions)
  if (shouldHoldProofActionOnIdle(loopPulse.nextAction.id, snapshot, proofPlan)) {
    await advanceAutopilotLoop({
      runtime: input.runtime,
      proofPlanOptions: input.proofPlanOptions,
      runtimeStore: input.runtimeStore,
    })
    return
  }

  await runIdleRuneweave(input)
}

async function advanceAutopilotLoop(input: AdvanceAutopilotLoopInput): Promise<ToolResponse> {
  const advanced = advanceRunicMissionLoop(input.runtime, {
    contract: defaultAtlasContract,
    holder: "runesmith-autopilot",
    idempotencyScope: "autopilot",
    ttlMs: 30_000,
    recoverStale: input.recoverStale ?? true,
    staleAfterMs: autopilotStaleAfterMs,
  })
  if (!advanced.ok) return formatError("Autopilot tick rejected", advanced.error)

  await persistRuntime(input.runtimeStore, input.runtime)
  const loopPulse = deriveLoopPulse(input.runtime.snapshot())
  const missionMemory = deriveMissionMemory(input.runtime.snapshot())
  const proofPlan = deriveProofPlan(input.runtime.snapshot(), input.proofPlanOptions)
  const runebook = deriveRunebook(input.runtime.snapshot(), { proofPlanOptions: input.proofPlanOptions })

  return formatValue(formatAutopilotLoopTitle(advanced.value.status), {
    status: advanced.value.status,
    missionId: advanced.value.missionId,
    taskId: advanced.value.taskId,
    taskStatus: advanced.value.nextTaskStatus,
    missionStatus: advanced.value.missionStatus,
    missingEvidence: advanced.value.missingEvidence,
    diagnostics: loopPulse.diagnostics,
    missionMemory,
    proofPlan,
    runebook,
    loopPulse,
  })
}

type RunProofFromOpenCodeInput = {
  runtime: RunesmithRuntime
  proofPlanOptions?: ProofPlanOptions
  proofCommandRunner?: ProofCommandRunner
  runtimeStore?: PluginRuntimeStore
  idFactory?: IdFactory
  now?: () => Date
}

type RunNextFromOpenCodeInput = RunProofFromOpenCodeInput & {
  args: NextArgs
}

type RunOsFromOpenCodeInput = RunProofFromOpenCodeInput & {
  args: OsRunArgs
}

type RunIdleRuneweaveInput = RunProofFromOpenCodeInput

type ResolveRiskFromOpenCodeInput = {
  runtime: RunesmithRuntime
  proofPlanOptions?: ProofPlanOptions
  runtimeStore?: PluginRuntimeStore
  idFactory?: IdFactory
  now?: () => Date
  args: RiskResolveArgs
}

async function runNextFromOpenCode(input: RunNextFromOpenCodeInput): Promise<ToolResponse> {
  const snapshot = input.runtime.snapshot()
  const nextEvidenceId = createProofEvidenceIdFactory(snapshot, input.idFactory)
  const next = await runRunebookNext(input.runtime, {
    contract: defaultAtlasContract,
    holder: "runesmith-autopilot",
    idempotencyScope: "next",
    ttlMs: 30_000,
    staleAfterMs: autopilotStaleAfterMs,
    proofPlanOptions: input.proofPlanOptions,
    proofCommandRunner: input.proofCommandRunner ?? runOpenCodeShellProofCommand,
    nextEvidenceId,
    now: input.now,
    risk: {
      verdict: parseRiskVerdict(input.args.riskVerdict),
      summary: input.args.riskSummary,
      evidenceIdFactory: () => input.args.evidenceId ?? input.idFactory?.("evidence") ?? `evidence_${crypto.randomUUID()}`,
    },
  })
  if (!next.ok) return formatError("Runebook next rejected", next.error)

  await persistRuntime(input.runtimeStore, input.runtime)

  return formatValue("Runebook next", next.value as unknown as Record<string, unknown>)
}

async function runOsFromOpenCode(input: RunOsFromOpenCodeInput): Promise<ToolResponse> {
  const snapshot = input.runtime.snapshot()
  const nextEvidenceId = createProofEvidenceIdFactory(snapshot, input.idFactory)
  const loop = await runRuneweave(input.runtime, {
    contract: defaultAtlasContract,
    holder: "runesmith-autopilot",
    idempotencyScope: "os-run",
    ttlMs: 30_000,
    staleAfterMs: autopilotStaleAfterMs,
    proofPlanOptions: input.proofPlanOptions,
    proofCommandRunner: input.proofCommandRunner ?? runOpenCodeShellProofCommand,
    nextEvidenceId,
    now: input.now,
    maxSteps: parseMaxSteps(input.args.maxSteps),
    risk: {
      verdict: parseRiskVerdict(input.args.riskVerdict),
      summary: input.args.riskSummary,
      evidenceIdFactory: () => input.args.evidenceId ?? input.idFactory?.("evidence") ?? `evidence_${crypto.randomUUID()}`,
    },
  })
  if (!loop.ok) return formatError("Runesmith OS run rejected", loop.error)

  recordRuneweaveStop(input.runtime, loop.value, "tool")
  await persistRuntime(input.runtimeStore, input.runtime)

  return formatValue("Runesmith OS run", loop.value as unknown as Record<string, unknown>)
}

async function runIdleRuneweave(input: RunIdleRuneweaveInput): Promise<ToolResponse> {
  const snapshot = input.runtime.snapshot()
  const nextEvidenceId = createProofEvidenceIdFactory(snapshot, input.idFactory)
  const loop = await runRuneweave(input.runtime, {
    contract: defaultAtlasContract,
    holder: "runesmith-autopilot",
    idempotencyScope: "idle-os",
    ttlMs: 30_000,
    staleAfterMs: autopilotStaleAfterMs,
    proofPlanOptions: input.proofPlanOptions,
    proofCommandRunner: input.proofCommandRunner ?? runOpenCodeShellProofCommand,
    nextEvidenceId,
    now: input.now,
    maxSteps: 8,
  })
  if (!loop.ok) return formatError("Runesmith idle OS rejected", loop.error)

  recordRuneweaveStop(input.runtime, loop.value, "session.idle")
  await persistRuntime(input.runtimeStore, input.runtime)

  return formatValue("Runesmith idle OS run", loop.value as unknown as Record<string, unknown>)
}

async function runProofFromOpenCode(input: RunProofFromOpenCodeInput): Promise<ToolResponse> {
  const snapshot = input.runtime.snapshot()
  const proofPlan = deriveProofPlan(snapshot, input.proofPlanOptions)
  const proofRun = await runProofPlan(input.runtime, proofPlan, {
    nextEvidenceId: createProofEvidenceIdFactory(snapshot, input.idFactory),
    now: input.now,
    runCommand: input.proofCommandRunner ?? runOpenCodeShellProofCommand,
  })

  let status = proofRun.status === "failed" ? "waiting-for-evidence" : proofRun.status
  if (proofRun.status === "passed") {
    const advanced = advanceRunicMissionLoop(input.runtime, {
      contract: defaultAtlasContract,
      holder: "runesmith-autopilot",
      idempotencyScope: "proof-run",
      ttlMs: 30_000,
      recoverStale: false,
      staleAfterMs: autopilotStaleAfterMs,
    })
    if (!advanced.ok) return formatError("Proof run advance rejected", advanced.error)
    status = advanced.value.status
  }

  await persistRuntime(input.runtimeStore, input.runtime)
  const nextSnapshot = input.runtime.snapshot()
  const loopPulse = deriveLoopPulse(nextSnapshot)
  const missionMemory = deriveMissionMemory(nextSnapshot)
  const nextProofPlan = deriveProofPlan(nextSnapshot, input.proofPlanOptions)
  const runebook = deriveRunebook(nextSnapshot, { proofPlanOptions: input.proofPlanOptions })

  return formatValue(proofRun.status === "failed" ? "Proof plan failed" : "Proof plan executed", {
    status,
    proofStatus: proofRun.status,
    missionId: proofRun.missionId,
    taskId: proofRun.taskId,
    commands: proofRun.commands,
    missingEvidence: loopPulse.missingEvidence,
    diagnostics: loopPulse.diagnostics,
    missionMemory,
    proofPlan: nextProofPlan,
    runebook,
    loopPulse,
  })
}

async function resolveRiskFromOpenCode(input: ResolveRiskFromOpenCodeInput): Promise<ToolResponse> {
  const resolved = resolveRunicRisk(input.runtime, {
    contract: defaultAtlasContract,
    holder: "runesmith-autopilot",
    idempotencyScope: "risk-resolve",
    ttlMs: 30_000,
    verdict: parseRiskVerdict(input.args.verdict),
    summary: input.args.summary,
    now: input.now,
    evidenceIdFactory: () => input.args.evidenceId ?? input.idFactory?.("evidence") ?? `evidence_${crypto.randomUUID()}`,
  })
  if (!resolved.ok) return formatError("Risk resolution rejected", resolved.error)

  await persistRuntime(input.runtimeStore, input.runtime)
  const snapshot = input.runtime.snapshot()
  const loopPulse = deriveLoopPulse(snapshot)
  const missionMemory = deriveMissionMemory(snapshot)
  const proofPlan = deriveProofPlan(snapshot, input.proofPlanOptions)
  const runebook = deriveRunebook(snapshot, { proofPlanOptions: input.proofPlanOptions })

  return formatValue("Risk resolved", {
    status: resolved.value.status,
    missionId: resolved.value.missionId,
    taskId: resolved.value.taskId,
    evidenceId: resolved.value.evidenceId,
    verdict: resolved.value.verdict,
    risks: resolved.value.risks,
    nextStatus: resolved.value.nextStatus,
    missingEvidence: loopPulse.missingEvidence,
    missionMemory,
    proofPlan,
    runebook,
    loopPulse,
  })
}

function shouldRunProofPlanOnIdle(snapshot: RuntimeSnapshot, proofPlan: ProofPlan): boolean {
  if (!proofPlan.missionId || !proofPlan.taskId || proofPlan.commands.length === 0) return false

  if (proofPlan.status === "needs-proof") {
    return hasTaskEvidenceOfType(snapshot, proofPlan.missionId, proofPlan.taskId, "file-change")
  }

  if (proofPlan.status === "needs-repair") {
    return hasTaskEvidenceAfterLatestDiagnostic(snapshot, proofPlan.missionId, proofPlan.taskId, "file-change")
  }

  return false
}

function shouldHoldProofActionOnIdle(actionId: string, snapshot: RuntimeSnapshot, proofPlan: ProofPlan): boolean {
  if (actionId !== "capture-proof" && actionId !== "repair-diagnostic") return false

  return !shouldRunProofPlanOnIdle(snapshot, proofPlan)
}

function recordRuneweaveStop(
  runtime: RunesmithRuntime,
  loop: RuneweaveValue,
  mode: "session.idle" | "tool",
): void {
  if (!loop.missionId) return

  const targetId = loop.taskId ?? loop.missionId
  const graph = runtime.snapshot().graphs[loop.missionId]
  if (!graph || isDuplicateRuneweaveStop(graph.events, loop, mode, targetId)) return

  runtime.recordMissionEvent({
    missionId: loop.missionId,
    type: "runeweave.stopped",
    targetId,
    message: `Runeweave ${loop.status}: ${loop.stopReason}`,
    data: {
      mode,
      status: loop.status,
      stopReason: loop.stopReason,
      stepCount: loop.stepCount,
      finalActionId: loop.finalActionId,
      proofStatus: loop.proofStatus,
      commands: loop.commands.map((command) => ({
        evidenceId: command.evidenceId,
        command: command.command,
        kind: command.kind,
        label: command.label,
        exitCode: command.exitCode,
        evidenceType: command.evidenceType,
      })),
    },
  })
}

function isDuplicateRuneweaveStop(
  events: MissionEvent[],
  loop: RuneweaveValue,
  mode: "session.idle" | "tool",
  targetId: string,
): boolean {
  const latest = events.at(-1)
  if (!latest || latest.type !== "runeweave.stopped" || latest.targetId !== targetId) return false

  const data = asRecord(latest.data)
  return data?.mode === mode
    && data?.status === loop.status
    && data?.stopReason === loop.stopReason
    && data?.finalActionId === loop.finalActionId
    && data?.proofStatus === loop.proofStatus
}

function hasTaskEvidenceOfType(
  snapshot: RuntimeSnapshot,
  missionId: string,
  taskId: string,
  evidenceType: EvidenceType,
): boolean {
  return taskEvidence(snapshot, missionId, taskId).some((entry) => entry.type === evidenceType)
}

function hasTaskEvidenceAfterLatestDiagnostic(
  snapshot: RuntimeSnapshot,
  missionId: string,
  taskId: string,
  evidenceType: EvidenceType,
): boolean {
  const evidence = taskEvidence(snapshot, missionId, taskId)
  let latestDiagnosticIndex = -1
  let latestEvidenceIndex = -1

  evidence.forEach((entry, index) => {
    if (entry.type === "diagnostic") latestDiagnosticIndex = index
    if (entry.type === evidenceType) latestEvidenceIndex = index
  })

  return latestDiagnosticIndex >= 0 && latestEvidenceIndex > latestDiagnosticIndex
}

function taskEvidence(snapshot: RuntimeSnapshot, missionId: string, taskId: string) {
  return Object.values(snapshot.ledgers[missionId]?.evidence ?? {}).filter((entry) => entry.taskId === taskId)
}

function formatAutopilotLoopTitle(status: string): string {
  if (status === "idle") return "Autopilot tick idle"
  if (status === "recovered") return "Autopilot recovered stale work"
  if (status === "claimed") return "Autopilot tick claimed"
  if (status === "waiting-for-evidence") return "Autopilot tick held"

  return "Autopilot tick completed"
}

function getOpenCodeEventType(input: OpenCodeEventInput): string | undefined {
  const event = asRecord(input.event) ?? input
  return normalizeGoal(event.type) ?? normalizeGoal(event.name)
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
    const isVerification = command ? isVerificationCommand(command) : false
    const verificationPassed = isVerification && isPassingExecution(result)

    return {
      type: verificationPassed ? "test-result" : isVerification ? "diagnostic" : "command-output",
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

function isPassingExecution(result: Record<string, unknown> | undefined): boolean {
  const exitCode = extractExitCode(result)
  if (typeof exitCode === "number") return exitCode === 0

  const status = normalizeGoal(result?.status)
  if (!status) return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function isVerificationCommand(command: string): boolean {
  const tokens = tokenizeShellCommand(command)
  const first = tokens[0]
  if (!first) return false

  if (["bun", "npm", "pnpm", "yarn"].includes(first)) {
    return tokens.some(isVerificationScriptToken)
  }

  if (first === "npx" || first === "pnpx" || first === "bunx") {
    return isVerificationToolCommand(tokens.slice(1))
      || tokens.slice(1).some(isVerificationScriptToken)
  }

  if (["cargo", "go"].includes(first)) {
    return tokens[1] === "test"
  }

  return isVerificationToolCommand(tokens)
}

function tokenizeShellCommand(command: string): string[] {
  return command
    .toLowerCase()
    .replace(/["']/g, "")
    .split(/[\s;&|()]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function isVerificationScriptToken(token: string): boolean {
  const normalized = token.replace(/^run:/, "")
  return ["test", "typecheck", "lint", "build"].some((script) => {
    return normalized === script
      || normalized.startsWith(`${script}:`)
      || normalized.startsWith(`${script}-`)
  })
}

function isVerificationToolCommand(tokens: string[]): boolean {
  const [tool, ...args] = tokens
  if (!tool) return false

  if ([
    "vitest",
    "jest",
    "playwright",
    "cypress",
    "pytest",
    "rspec",
    "tsc",
    "eslint",
  ].includes(tool)) {
    return true
  }

  if (tool === "biome") {
    return args.some((arg) => ["check", "ci", "lint"].includes(arg))
  }

  if (tool === "prettier") {
    return args.some((arg) => ["--check", "--list-different"].includes(arg))
  }

  if (tool === "vite" || tool === "next") {
    return args.some((arg) => arg === "build" || arg === "lint")
  }

  return false
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
    "If you reach a session-idle point before preparation, Runesmith can infer the latest user goal from chat context and prepare the mission automatically.",
    "Continue under the returned mission, task, and lease. New autopilot missions are planned as Forge, Review, and Seal tasks. Runesmith records shell, test, file-change, and safe Covenant decision evidence automatically; use `runesmith_task_evidence` for risks, diagnostics, external proof, or decisions the tool hooks cannot infer.",
    "Follow the active Runesmith Runebook card and Active runes as automatic procedure, not as user-invoked workflows.",
    "Prefer `runesmith_os_run` when you need Runesmith to keep executing engine-owned Runebook cards until the mission is sealed or a real stop condition appears.",
    "Prefer `runesmith_next` when you need Runesmith to execute the current Runebook card without choosing a lower-level tool.",
    "When proof is missing, call `runesmith_proof_run` to execute the live Runesmith Proof Plan before asking for completion. When Faultline is active, follow the architecture breakpoint before rerunning proof.",
    "When Loop Pulse says `Resolve risk`, call `runesmith_risk_resolve` with a short decision summary instead of asking the user to find mission ids or manually attach decision evidence.",
    "When the active task has required evidence, call `runesmith_autopilot_tick` or let session-idle events advance it. The tick may complete the task only after the evidence gate is satisfied, synthesize Review and Seal decisions when safe, then claim the next dependency-ready task.",
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

function injectMessageBootstrap(
  output: OpenCodeMessagesOutput,
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant,
  proofPlanOptions: ProofPlanOptions,
): void {
  if (!Array.isArray(output.messages)) return

  const firstUserMessage = output.messages.map(asRecord).find((message) => getMessageRole(message) === "user")
  if (!firstUserMessage) return

  const parts = Array.isArray(firstUserMessage.parts) ? firstUserMessage.parts : []
  if (parts.some((part) => extractTextValue(part).includes("<RUNESMITH_BOOTSTRAP>"))) return

  const firstPart = asRecord(parts[0])
  const bootstrapPart = firstPart
    ? { ...firstPart, type: "text", text: buildMessageBootstrap(snapshot, covenant, proofPlanOptions) }
    : { type: "text", text: buildMessageBootstrap(snapshot, covenant, proofPlanOptions) }

  firstUserMessage.parts = [bootstrapPart, ...parts]
}

function buildMessageBootstrap(
  snapshot: RuntimeSnapshot,
  covenant: RunicCovenant,
  proofPlanOptions: ProofPlanOptions,
): string {
  const pulse = deriveLoopPulse(snapshot, covenant)
  const protocolDeck = deriveRunicProtocolDeck(snapshot, { proofPlanOptions, covenant })

  return [
    "<RUNESMITH_BOOTSTRAP>",
    "Runesmith is installed as the OpenCode orchestration OS.",
    `Current next action: ${pulse.nextAction.label} (${pulse.nextAction.id}).`,
    `Active protocol: ${protocolDeck.active.name} [${protocolDeck.active.mode}].`,
    "Let Runesmith choose the procedure from runtime state.",
    "Before mutating coding work, use Runesmith to prepare or resume the active mission.",
    "Prefer runesmith_os_run, runesmith_next, runesmith_proof_run, or runesmith_risk_resolve when Loop Pulse makes them the next engine-owned action.",
    "Do not ask the user to load skills or invoke workflows by name.",
    "</RUNESMITH_BOOTSTRAP>",
  ].join("\n")
}

function getMessageRole(message: Record<string, unknown> | undefined): string | undefined {
  if (!message) return undefined

  return stringValue(message.role) ?? stringValue(asRecord(message.info)?.role)
}

function registerRunesmithSkillsPath(config: OpenCodeConfig): void {
  config.skills = config.skills ?? {}
  const paths = Array.isArray(config.skills.paths) ? config.skills.paths : []

  if (!paths.includes(runesmithOpenCodeSkillsPath)) {
    paths.push(runesmithOpenCodeSkillsPath)
  }

  config.skills.paths = paths
}

function upsertSystemSection(output: OpenCodeSystemOutput, section: string): void {
  const system =
    typeof output.system === "string"
      ? [output.system]
      : Array.isArray(output.system)
        ? output.system
        : []

  upsertTextListSection(system, section)
  output.system = system
}

function upsertTextListSection(target: string[], section: string): void {
  const heading = sectionHeading(section)
  const existingIndex = target.findIndex((entry) => entry.includes(heading))
  if (existingIndex >= 0) {
    target[existingIndex] = upsertPromptSection(target[existingIndex]!, section)
    return
  }

  target.push(section)
}

function upsertPromptSection(text: string, section: string): string {
  const heading = sectionHeading(section)
  const start = text.indexOf(heading)
  if (start < 0) {
    return text.trimEnd().length > 0 ? `${text.trimEnd()}\n\n${section}` : section
  }

  const nextHeading = text.indexOf("\n## ", start + heading.length)
  const before = text.slice(0, start).trimEnd()
  const after = nextHeading >= 0 ? text.slice(nextHeading).trimStart() : ""

  return [before, section, after].filter((part) => part.length > 0).join("\n\n")
}

function appendCompactionContext(
  output: OpenCodeCompactionOutput,
  snapshot: RuntimeSnapshot,
  proofPlanOptions: ProofPlanOptions = {},
): void {
  const context = output.context ?? []
  const summary = buildMissionCapsuleSummary(snapshot)
  if (!context.join("\n").includes("## Runesmith Mission Capsule")) {
    context.push(summary)
  }
  upsertTextListSection(context, buildCovenantControlBrief(snapshot))
  upsertTextListSection(context, buildLoopPulsePrompt(snapshot))
  upsertTextListSection(context, buildMissionMapPrompt(snapshot))
  upsertTextListSection(context, buildScopeSentinelPrompt(snapshot))
  upsertTextListSection(context, buildReviewLensPrompt(snapshot))
  upsertTextListSection(context, buildSealAuditPrompt(snapshot, proofPlanOptions))
  upsertTextListSection(context, buildRunebookPrompt(snapshot, { proofPlanOptions }))
  upsertTextListSection(context, buildRunicProtocolPrompt(snapshot, { proofPlanOptions }))
  upsertTextListSection(context, buildMissionMemoryPrompt(snapshot))
  upsertTextListSection(context, buildProofPlanPrompt(snapshot, proofPlanOptions))
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

function extractMessages(value: unknown): unknown[] | undefined {
  const record = asRecord(value)
  if (!record) return undefined

  return Array.isArray(record.messages) ? record.messages : undefined
}

function extractMessageText(message: Record<string, unknown>): string | undefined {
  const candidates = [message.text, message.content, message.parts]
  const text = stripRunesmithBootstrapBlocks(candidates.map(extractTextValue).filter(Boolean).join("\n"))
  return text.length > 0 ? text : undefined
}

function stripRunesmithBootstrapBlocks(text: string): string {
  return text.replace(/<RUNESMITH_BOOTSTRAP>[\s\S]*?<\/RUNESMITH_BOOTSTRAP>/g, "\n")
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
  const normalized = stripRunesmithBootstrapBlocks(goal).replace(/\s+/g, " ").trim()
  return normalized.length > 0 ? normalized : undefined
}

function parseRiskVerdict(value: unknown): RiskResolutionVerdict {
  return value === "cleared" ? "cleared" : "accepted"
}

function parseMaxSteps(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined

  return value
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

export async function runOpenCodeShellProofCommand(command: ProofPlanCommand): Promise<ProofCommandExecution> {
  return new Promise((resolve) => {
    const child = spawn(command.command, {
      shell: true,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    const settle = (execution: ProofCommandExecution) => {
      if (settled) return
      settled = true
      resolve(execution)
    }

    child.stdout?.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk, shellProofCaptureLimit)
    })
    child.stderr?.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk, shellProofCaptureLimit)
    })
    child.on("error", (error) => {
      settle({
        exitCode: 1,
        stdout,
        stderr: appendBoundedOutput(stderr, error.message, shellProofCaptureLimit),
      })
    })
    child.on("close", (code) => {
      settle({
        exitCode: typeof code === "number" ? code : 1,
        stdout,
        stderr,
      })
    })
  })
}

function appendBoundedOutput(current: string, chunk: unknown, maxLength: number): string {
  if (current.length >= maxLength) return current

  const text = String(chunk)
  const remaining = maxLength - current.length

  return `${current}${text.slice(0, remaining)}`
}

function createProofEvidenceIdFactory(snapshot: RuntimeSnapshot, idFactory: IdFactory | undefined): () => string {
  const used = new Set(Object.values(snapshot.ledgers).flatMap((ledger) => Object.keys(ledger.evidence)))
  let index = 0

  return () => {
    index += 1
    const base = idFactory?.("evidence") ?? `evidence_proof_${index}`
    const id = used.has(base) ? `${base}_${index}` : base
    used.add(id)

    return id
  }
}

function resolveProofPlanOptions(options: PluginOptions["proofPlanOptions"]): ProofPlanOptions {
  if (options === false) return {}
  if (options) return options

  return readPackageProofPlanOptions()
}

function readPackageProofPlanOptions(): ProofPlanOptions {
  try {
    const manifest = JSON.parse(readFileSync("package.json", "utf8")) as {
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
