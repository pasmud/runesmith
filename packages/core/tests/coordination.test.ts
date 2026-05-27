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
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      createdAt: "2026-05-27T00:01:00.000Z",
    }).value

    const result = assertRequiredEvidence(ledger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })

    expect(result).toEqual({ ok: true, value: undefined })
  })

  test("treats same-timestamp proof as fresh when it is appended after the file change", () => {
    let ledger = createEvidenceLedger()
    ledger = addEvidence(ledger, {
      id: "evidence_z_file",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Updated runtime",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:00:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_a_test",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed",
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      createdAt: "2026-05-27T00:00:00.000Z",
    }).value

    const result = assertRequiredEvidence(ledger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })

    expect(result).toEqual({ ok: true, value: undefined })
  })

  test("blocks completion when required test evidence failed", () => {
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
      summary: "Core tests failed",
      payload: { command: "bun test packages/core/tests", exitCode: 1 },
      createdAt: "2026-05-27T00:01:00.000Z",
    }).value

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
          missingEvidence: ["test-result"],
        },
      },
    })
  })

  test("blocks completion when passing test proof is older than a later file change", () => {
    let ledger = createEvidenceLedger()
    ledger = addEvidence(ledger, {
      id: "evidence_file_initial",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed runtime",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:00:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_test",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed",
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      createdAt: "2026-05-27T00:01:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_file_later",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed runtime again",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:02:00.000Z",
    }).value

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
          missingEvidence: ["test-result"],
        },
      },
    })
  })

  test("requires passing proof after the latest diagnostic repair target", () => {
    let ledger = createEvidenceLedger()
    ledger = addEvidence(ledger, {
      id: "evidence_file",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed runtime",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:00:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_test_old",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed",
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      createdAt: "2026-05-27T00:01:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_diagnostic",
      taskId: "task_alpha",
      type: "diagnostic",
      summary: "Core tests failed after a repair attempt",
      payload: { command: "bun test packages/core/tests", exitCode: 1 },
      createdAt: "2026-05-27T00:02:00.000Z",
    }).value

    const staleResult = assertRequiredEvidence(ledger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })

    expect(staleResult).toEqual({
      ok: false,
      error: {
        code: "EVIDENCE_REQUIRED",
        message: "Task is missing required evidence",
        details: {
          taskId: "task_alpha",
          missingEvidence: ["test-result"],
        },
      },
    })

    const repairedLedger = addEvidence(ledger, {
      id: "evidence_test_fresh",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed after repair",
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      createdAt: "2026-05-27T00:03:00.000Z",
    }).value

    expect(assertRequiredEvidence(repairedLedger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })).toEqual({ ok: true, value: undefined })
  })

  test("requires a decision after unresolved risk evidence", () => {
    let ledger = createEvidenceLedger()
    ledger = addEvidence(ledger, {
      id: "evidence_file",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed runtime",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:00:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_test",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed",
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      createdAt: "2026-05-27T00:01:00.000Z",
    }).value
    ledger = addEvidence(ledger, {
      id: "evidence_risk",
      taskId: "task_alpha",
      type: "risk",
      summary: "Deletes generated user files without confirmation",
      payload: { severity: "high" },
      createdAt: "2026-05-27T00:02:00.000Z",
    }).value

    const blocked = assertRequiredEvidence(ledger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })

    expect(blocked).toEqual({
      ok: false,
      error: {
        code: "EVIDENCE_REQUIRED",
        message: "Task is missing required evidence",
        details: {
          taskId: "task_alpha",
          missingEvidence: ["decision"],
        },
      },
    })

    const resolvedLedger = addEvidence(ledger, {
      id: "evidence_decision",
      taskId: "task_alpha",
      type: "decision",
      summary: "Human approved deleting generated files",
      payload: { verdict: "approved" },
      createdAt: "2026-05-27T00:03:00.000Z",
    }).value

    expect(assertRequiredEvidence(resolvedLedger, {
      taskId: "task_alpha",
      requiredEvidence: ["file-change", "test-result"],
    })).toEqual({ ok: true, value: undefined })
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

  test("requeues safe stale tasks when recovery is allowed to reclaim work", () => {
    const created = createMissionGraph({
      goal: "Recover and reassign implementation",
      idFactory: ids,
      now: fixedNow,
      taskPlan: [
        {
          key: "forge",
          title: "Forge recovery",
          description: "Implement the change.",
        },
        {
          key: "review",
          title: "Review recovery",
          description: "Review the change.",
          dependsOn: ["forge"],
        },
      ],
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
      requeueStale: true,
      eventIdFactory: (taskId, type) => `event_${type}_${taskId}`,
    })

    expect(recovered.tasks.task_alpha?.status).toBe("queued")
    expect(recovered.tasks.task_alpha?.assignedAgentId).toBeUndefined()
    expect(recovered.tasks.task_alpha_review?.status).toBe("queued")
    expect(recovered.events.slice(-2)).toEqual([
      {
        id: "event_task.stale_task_alpha",
        type: "task.stale",
        at: "2026-05-27T00:02:00.000Z",
        targetId: "task_alpha",
        message: "Task marked stale after missing heartbeat",
        data: {
          staleAfterMs: 60000,
        },
      },
      {
        id: "event_task.requeued_task_alpha",
        type: "task.requeued",
        at: "2026-05-27T00:02:00.000Z",
        targetId: "task_alpha",
        message: "Stale task requeued for reassignment",
        data: {
          staleAfterMs: 60000,
        },
      },
    ])
  })

  test("does not requeue stale tasks whose dependencies are still incomplete", () => {
    const created = createMissionGraph({
      goal: "Wait for dependency before recovery",
      idFactory: ids,
      now: fixedNow,
      taskPlan: [
        {
          key: "forge",
          title: "Forge dependency",
          description: "Implement the change.",
        },
        {
          key: "review",
          title: "Review dependency",
          description: "Review the change.",
          dependsOn: ["forge"],
        },
      ],
    })
    if (!created.ok) throw new Error("mission creation failed")

    const graph = {
      ...created.value,
      tasks: {
        ...created.value.tasks,
        task_alpha_review: {
          ...created.value.tasks.task_alpha_review!,
          status: "stale" as const,
          assignedAgentId: "agent_atlas",
        },
      },
    }

    const recovered = recoverStaleTasks(graph, {
      now: later,
      staleAfterMs: 60_000,
      requeueStale: true,
      eventIdFactory: (taskId, type) => `event_${type}_${taskId}`,
    })

    expect(recovered.tasks.task_alpha_review?.status).toBe("stale")
    expect(recovered.tasks.task_alpha_review?.assignedAgentId).toBe("agent_atlas")
    expect(recovered.events.at(-1)?.type).not.toBe("task.requeued")
  })
})
