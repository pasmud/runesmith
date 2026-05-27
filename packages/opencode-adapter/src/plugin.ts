import {
  buildCovenantPrompt,
  createRuntime,
  createRunicCovenant,
  type AgentContract,
  type EvidenceType,
  type RunicCovenant,
  type RunesmithRuntime,
  type RuntimeOptions,
} from "@runesmith/core"

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
}

export type PluginOptions = RuntimeOptions & {
  runtime?: RunesmithRuntime
  contracts?: AgentContract[]
  covenant?: RunicCovenant
}

type CovenantStatusArgs = Record<string, never>

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
  for (const contract of options.contracts ?? [defaultAtlasContract]) {
    runtime.registerContract(contract)
  }

  return {
    name: "runesmith",
    tool: {
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
        execute(args) {
          const result = runtime.startMission({
            goal: args.goal,
            requiredCapabilities: args.requiredCapabilities,
          })

          if (!result.ok) return formatError("Mission start rejected", result.error)

          return formatValue("Mission started", {
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
        execute(args) {
          const result = runtime.claimTask({
            missionId: args.missionId,
            taskId: args.taskId,
            contractId: args.contractId,
            holder: args.holder,
            idempotencyKey: args.idempotencyKey,
            ttlMs: args.ttlMs ?? 30_000,
          })
          if (!result.ok) return formatError("Task claim rejected", result.error)

          return formatValue("Task claimed", {
            taskId: result.value.task.id,
            status: result.value.task.status,
            assignedAgentId: result.value.task.assignedAgentId,
            leaseId: result.value.lease.id,
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
        execute(args) {
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

          return formatValue("Evidence recorded", {
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
        execute(args) {
          const result = runtime.completeTask(args)
          if (!result.ok) return formatError("Task completion rejected", result.error)

          return formatValue("Task completed", {
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
        execute(args) {
          const result = runtime.recover({
            missionId: args.missionId,
            staleAfterMs: args.staleAfterMs ?? 120_000,
          })
          if (!result.ok) return formatError("Recovery rejected", result.error)

          return formatValue("Recovery complete", {
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
            if (systemPrompt.includes("## Runic Covenant")) {
              return systemPrompt
            }

            return `${systemPrompt.trimEnd()}\n\n${covenantPrompt}`
          },
        },
      },
    },
  }
}

export default async function RunesmithOpenCodePlugin(): Promise<RunesmithPlugin> {
  return createRunesmithPlugin()
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
