import { describe, expect, test } from "bun:test"

import {
  advanceRunicMissionLoop,
  createCovenantTaskPlan,
  createRuntime,
  resolveRunicRisk,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const later = () => new Date("2026-05-27T00:03:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing", "repository-maintenance"],
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

function loopDefaults() {
  return {
    contract: atlas,
    holder: "runesmith-core-loop",
    idempotencyScope: "core-loop",
    ttlMs: 30_000,
  }
}

describe("runic mission loop", () => {
  test("waits with missing evidence instead of completing active Forge work", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Hold until proof exists",
      taskPlan: createCovenantTaskPlan("Hold until proof exists"),
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })

    const advanced = advanceRunicMissionLoop(runtime, loopDefaults())

    expect(advanced).toMatchObject({
      ok: true,
      value: {
        status: "waiting-for-evidence",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        missionStatus: "running",
        missingEvidence: ["file-change", "test-result"],
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
  })

  test("completes Forge Review and Seal when proof satisfies the task graph", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Complete verified loop",
      taskPlan: createCovenantTaskPlan("Complete verified loop"),
    })
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
        summary: "Changed runtime files",
        payload: { filePath: "packages/core/src/runic-loop.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Core loop tests passed",
        payload: { command: "bun test packages/core/tests/runic-loop.test.ts", exitCode: 0 },
        createdAt: fixedNow().toISOString(),
      },
    })

    const advanced = advanceRunicMissionLoop(runtime, loopDefaults())

    expect(advanced).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        missionId: "mission_alpha",
        taskId: "task_alpha_seal",
        missionStatus: "complete",
      },
    })

    const snapshot = runtime.snapshot()
    const graph = snapshot.graphs.mission_alpha
    const evidence = Object.values(snapshot.ledgers.mission_alpha.evidence)
    expect(graph.tasks.task_alpha.status).toBe("complete")
    expect(graph.tasks.task_alpha_review.status).toBe("complete")
    expect(graph.tasks.task_alpha_seal.status).toBe("complete")
    expect(graph.mission.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha_review",
          type: "decision",
          payload: expect.objectContaining({ stage: "review", verdict: "approved" }),
        }),
        expect.objectContaining({
          taskId: "task_alpha_seal",
          type: "decision",
          payload: expect.objectContaining({ stage: "seal", verdict: "sealed" }),
        }),
      ]),
    )
  })

  test("resolves active risk with a decision and advances the mission loop", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Resolve risk through runic loop",
      taskPlan: createCovenantTaskPlan("Resolve risk through runic loop"),
    })
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
        summary: "Changed runtime files",
        payload: { filePath: "packages/core/src/runic-loop.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Core loop tests passed",
        payload: { command: "bun test packages/core/tests/runic-loop.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_risk",
        taskId: "task_alpha",
        type: "risk",
        summary: "Deletes generated user files without confirmation",
        payload: { severity: "high" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const resolved = resolveRunicRisk(runtime, {
      ...loopDefaults(),
      verdict: "accepted",
      summary: "Generated files are safe to delete after operator review",
      now: later,
      evidenceIdFactory: () => "evidence_decision",
    })

    expect(resolved).toMatchObject({
      ok: true,
      value: {
        status: "resolved",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        evidenceId: "evidence_decision",
        verdict: "accepted",
        nextStatus: "completed",
      },
    })

    const snapshot = runtime.snapshot()
    expect(snapshot.graphs.mission_alpha.mission.status).toBe("complete")
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
    expect(Object.values(snapshot.ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence_decision",
          taskId: "task_alpha",
          type: "decision",
          summary: "Risk accepted: Generated files are safe to delete after operator review",
          payload: expect.objectContaining({
            mode: "runesmith-risk-resolution",
            verdict: "accepted",
            risks: ["Deletes generated user files without confirmation"],
          }),
        }),
      ]),
    )
  })

  test("recovers and reclaims stale dependency-ready work before evidence checks", () => {
    let now = new Date("2026-05-27T00:00:00.000Z")
    const runtime = createRuntime({ idFactory: ids, now: () => now })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Recover stale loop",
      taskPlan: createCovenantTaskPlan("Recover stale loop"),
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })

    now = later()
    const advanced = advanceRunicMissionLoop(runtime, {
      ...loopDefaults(),
      recoverStale: true,
      staleAfterMs: 60_000,
      now: () => now,
    })

    expect(advanced).toMatchObject({
      ok: true,
      value: {
        status: "recovered",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        nextTaskStatus: "running",
      },
    })

    const graph = runtime.snapshot().graphs.mission_alpha
    expect(graph.tasks.task_alpha.status).toBe("running")
    expect(graph.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
    expect(graph.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["task.stale", "task.requeued", "task.transitioned"]),
    )
  })
})
