import { describe, expect, test } from "bun:test"

import {
  addEvidence,
  assertRequiredEvidence,
  createEvidenceLedger,
  createMissionGraph,
  recoverStaleTasks,
  routeTools,
  transitionTask,
  validateAgentForTask,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const later = () => new Date("2026-05-27T00:02:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "anthropic/claude-sonnet-4.5",
    fallbacks: ["openai/gpt-5.1-codex"],
  },
  fileScope: ["packages/**"],
  completionCriteria: ["Code compiles", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: ["agent_oracle"],
}

describe("agent contracts", () => {
  test("rejects task assignment when required capabilities are missing", () => {
    const graph = createMissionGraph({
      goal: "Write Rust bindings",
      idFactory: ids,
      now: fixedNow,
      requiredCapabilities: ["rust"],
    })
    if (!graph.ok) throw new Error("mission creation failed")

    const result = validateAgentForTask(atlas, graph.value.tasks.task_alpha!)

    expect(result).toEqual({
      ok: false,
      error: {
        code: "CAPABILITY_MISSING",
        message: "Agent is missing required task capabilities",
        details: {
          agentId: "agent_atlas",
          taskId: "task_alpha",
          missingCapabilities: ["rust"],
        },
      },
    })
  })
})

describe("evidence ledger", () => {
  test("blocks completion when required evidence is missing", () => {
    const ledger = createEvidenceLedger()

    const result = assertRequiredEvidence(ledger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: "EVIDENCE_REQUIRED",
        message: "Task is missing required evidence",
        details: {
          taskId: "task_alpha",
          missingEvidence: ["file-change", "test-result"],
        },
      },
    })
  })

  test("allows completion when all required evidence is present", () => {
    let ledger = createEvidenceLedger()
    ledger = addEvidence(ledger, {
      id: "evidence_file",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Updated runtime",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:00:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_test",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed",
      payload: { command: "bun test packages/core/tests" },
      createdAt: "2026-05-27T00:01:00.000Z",
    }).value

    const result = assertRequiredEvidence(ledger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })

    expect(result).toEqual({ ok: true, value: undefined })
  })
})

describe("tool router", () => {
  test("returns only tools allowed by the contract and context", () => {
    const tools = routeTools(atlas, {
      availableTools: ["read", "edit", "bash", "web", "deploy"],
      requiredCapabilities: ["typescript"],
    })

    expect(tools).toEqual(["read", "edit", "bash"])
  })
})

describe("recovery", () => {
  test("marks running tasks stale when heartbeat exceeds the threshold", () => {
    const created = createMissionGraph({
      goal: "Long running implementation",
      idFactory: ids,
      now: fixedNow,
    })
    if (!created.ok) throw new Error("mission creation failed")

    const running = transitionTask(created.value, {
      taskId: "task_alpha",
      nextStatus: "running",
      now: fixedNow,
      reason: "Agent claimed task",
      eventId: "event_running",
    })
    if (!running.ok) throw new Error("transition failed")

    const recovered = recoverStaleTasks(running.value, {
      now: later,
      staleAfterMs: 60_000,
      eventIdFactory: (taskId) => `event_stale_${taskId}`,
    })

    expect(recovered.tasks.task_alpha?.status).toBe("stale")
    expect(recovered.events.at(-1)).toEqual({
      id: "event_stale_task_alpha",
      type: "task.stale",
      at: "2026-05-27T00:02:00.000Z",
      targetId: "task_alpha",
      message: "Task marked stale after missing heartbeat",
      data: {
        staleAfterMs: 60000,
      },
    })
  })
})
