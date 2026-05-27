import { describe, expect, test } from "bun:test"

import { createRuntime, type AgentContract } from "../src/index"

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

describe("runesmith runtime", () => {
  test("starts a mission and lets a valid contract claim the root task", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)

    const mission = runtime.startMission({
      goal: "Build the lease scheduler",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")

    const claimed = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })

    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return

    expect(claimed.value.task.status).toBe("running")
    expect(claimed.value.task.assignedAgentId).toBe("agent_atlas")
    expect(claimed.value.lease.id).toBe("lease_alpha")
  })

  test("reports idempotent task claims as replayed", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)

    const mission = runtime.startMission({
      goal: "Replay existing task claim",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")

    const first = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    if (!first.ok) throw new Error("first claim failed")

    const second = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })

    expect(first.value.replayed).toBe(false)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.replayed).toBe(true)
    expect(second.value.lease.id).toBe("lease_alpha")
  })

  test("rejects completion until required evidence exists", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Build completion gate",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")

    const claimed = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    if (!claimed.ok) throw new Error("claim failed")

    const completed = runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })

    expect(completed).toEqual({
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

  test("completes a task once required evidence exists", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Build evidence ledger",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")
    const claimed = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    if (!claimed.ok) throw new Error("claim failed")

    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runtime files",
        payload: { files: ["packages/core/src/runtime.ts"] },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Core tests passed",
        payload: { command: "bun test packages/core/tests", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const completed = runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })

    expect(completed.ok).toBe(true)
    if (!completed.ok) return
    expect(completed.value.task.status).toBe("complete")
    expect(completed.value.graph.mission.status).toBe("complete")
  })

  test("runs stale recovery against stored missions", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Recover stale task",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")
    const claimed = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    if (!claimed.ok) throw new Error("claim failed")

    const recovered = runtime.recover({
      missionId: "mission_alpha",
      now: later,
      staleAfterMs: 60_000,
    })

    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(recovered.value.graph.tasks.task_alpha?.status).toBe("stale")
  })

  test("hydrates mission state, evidence, leases, and contracts from a snapshot", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)

    const mission = runtime.startMission({
      goal: "Persist mission state",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")

    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runtime",
        payload: {},
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Tests passed",
        payload: { command: "bun test packages/core/tests", exitCode: 0 },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })

    const hydrated = createRuntime({ snapshot: runtime.snapshot(), now: fixedNow })
    const completed = hydrated.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })

    expect(completed.ok).toBe(true)
    if (!completed.ok) throw new Error("completion failed")
    expect(completed.value.graph.mission.status).toBe("complete")
    expect(hydrated.snapshot().leases.leases.lease_alpha?.holder).toBe("atlas")
  })
})
