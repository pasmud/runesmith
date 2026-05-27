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

  test("rejects evidence for tasks outside the mission graph", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Reject stray proof",
      requiredCapabilities: ["typescript"],
    })
    if (!mission.ok) throw new Error("mission start failed")

    const recorded = runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_stray",
        taskId: "task_missing",
        type: "file-change",
        summary: "Evidence for a task that does not exist",
        payload: {},
        createdAt: "2026-05-27T00:00:30.000Z",
      },
    })

    expect(recorded).toEqual({
      ok: false,
      error: {
        code: "TASK_NOT_FOUND",
        message: "Task does not exist",
        details: {
          taskId: "task_missing",
        },
      },
    })
  })

  test("treats recorded evidence as task activity before stale recovery", () => {
    let current = new Date("2026-05-27T00:00:00.000Z")
    const runtime = createRuntime({
      idFactory: ids,
      now: () => current,
    })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Keep active proof from going stale",
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

    current = new Date("2026-05-27T00:01:30.000Z")
    const recorded = runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runtime files",
        payload: { files: ["packages/core/src/runtime.ts"] },
        createdAt: current.toISOString(),
      },
    })
    expect(recorded.ok).toBe(true)

    current = new Date("2026-05-27T00:02:00.000Z")
    const recovered = runtime.recover({
      missionId: "mission_alpha",
      now: () => current,
      staleAfterMs: 60_000,
    })

    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(recovered.value.graph.tasks.task_alpha?.status).toBe("running")
    expect(recovered.value.graph.tasks.task_alpha?.lastHeartbeatAt).toBe("2026-05-27T00:01:30.000Z")
    expect(recovered.value.graph.events.map((event) => event.type)).toContain("task.evidence.recorded")
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

  test("uses task-level evidence and keeps planned missions running until every task is complete", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Run planned mission",
      taskPlan: [
        {
          key: "forge",
          title: "Forge planned mission",
          description: "Make the implementation change.",
          requiredCapabilities: ["typescript"],
          requiredEvidence: ["file-change"],
        },
        {
          key: "review",
          title: "Review planned mission",
          description: "Review the change before sealing.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
          dependsOn: ["forge"],
        },
      ],
    })
    if (!mission.ok) throw new Error("mission start failed")

    const claimedForge = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-forge",
      ttlMs: 30_000,
    })
    if (!claimedForge.ok) throw new Error("forge claim failed")

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

    const completedForge = runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })

    expect(completedForge.ok).toBe(true)
    if (!completedForge.ok) return
    expect(completedForge.value.task.status).toBe("complete")
    expect(completedForge.value.graph.mission.status).toBe("running")

    const claimedReview = runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-review",
      ttlMs: 30_000,
    })
    expect(claimedReview.ok).toBe(true)
    if (!claimedReview.ok) return

    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_decision",
        taskId: "task_alpha_review",
        type: "decision",
        summary: "Review found no blockers",
        payload: { verdict: "approved" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })

    const completedReview = runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_atlas",
    })

    expect(completedReview.ok).toBe(true)
    if (!completedReview.ok) return
    expect(completedReview.value.graph.mission.status).toBe("complete")
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

  test("requeues stale work through the runtime when reclaim is enabled", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    const mission = runtime.startMission({
      goal: "Reclaim stale task",
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
      requeueStale: true,
    })

    expect(recovered.ok).toBe(true)
    if (!recovered.ok) return
    expect(recovered.value.graph.tasks.task_alpha?.status).toBe("queued")
    expect(recovered.value.graph.tasks.task_alpha?.assignedAgentId).toBeUndefined()
    expect(recovered.value.graph.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["task.stale", "task.requeued"]),
    )
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
