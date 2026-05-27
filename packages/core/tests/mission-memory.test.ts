import { describe, expect, test } from "bun:test"

import {
  buildMissionMemoryPrompt,
  createRuntime,
  deriveMissionMemory,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
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

describe("mission memory", () => {
  test("summarizes the idle handoff without requiring a workflow name", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })

    const memory = deriveMissionMemory(runtime.snapshot())
    const prompt = buildMissionMemoryPrompt(runtime.snapshot())

    expect(memory).toMatchObject({
      status: "idle",
      handoff: "No active mission is waiting. Start a mission from the next coding goal.",
      proof: {
        status: "clear",
        required: [],
        missing: [],
      },
    })
    expect(prompt).toContain("## Runesmith Mission Memory")
    expect(prompt).toContain("Status: idle")
    expect(prompt).toContain("Handoff: No active mission is waiting.")
  })

  test("captures the missing-proof handoff for an active task", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Prove mission memory",
      requiredCapabilities: ["typescript"],
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
        summary: "Changed memory core",
        payload: { files: ["packages/core/src/mission-memory.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })

    const memory = deriveMissionMemory(runtime.snapshot())
    const prompt = buildMissionMemoryPrompt(runtime.snapshot())

    expect(memory).toMatchObject({
      status: "needs-proof",
      missionId: "mission_alpha",
      goal: "Prove mission memory",
      activeTask: {
        id: "task_alpha",
        title: "Mission root",
        status: "running",
      },
      proof: {
        status: "missing",
        required: ["file-change", "test-result"],
        missing: ["test-result"],
      },
      latestChanges: ["Changed memory core"],
      nextAction: {
        id: "capture-proof",
        label: "Capture proof",
      },
      handoff: "Capture proof for task_alpha: record test-result evidence before completion.",
    })
    expect(prompt).toContain("Status: needs-proof")
    expect(prompt).toContain("Mission: mission_alpha")
    expect(prompt).toContain("Proof: missing test-result")
    expect(prompt).toContain("Latest changes: Changed memory core")
  })

  test("keeps repair focus on the latest diagnostic until proof passes", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Repair memory diagnostics",
      requiredCapabilities: ["typescript"],
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
        summary: "Changed memory core",
        payload: { files: ["packages/core/src/mission-memory.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "bun test packages/core/tests failed",
        payload: { command: "bun test packages/core/tests", exitCode: 1 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const memory = deriveMissionMemory(runtime.snapshot())

    expect(memory).toMatchObject({
      status: "needs-repair",
      latestDiagnostics: ["bun test packages/core/tests failed"],
      proof: {
        status: "missing",
        missing: ["test-result"],
      },
      nextAction: {
        id: "repair-diagnostic",
      },
      handoff:
        "Repair task_alpha: bun test packages/core/tests failed. State a falsifiable hypothesis, change one repair variable, then rerun proof.",
    })
  })

  test("holds unresolved risk in the handoff until a later decision exists", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Hold risky mission memory",
      requiredCapabilities: ["typescript"],
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
        summary: "Changed mission memory",
        payload: { files: ["packages/core/src/mission-memory.ts"] },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Mission memory tests passed",
        payload: { command: "bun test packages/core/tests/mission-memory.test.ts", exitCode: 0 },
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

    const memory = deriveMissionMemory(runtime.snapshot())
    const prompt = buildMissionMemoryPrompt(runtime.snapshot())

    expect(memory).toMatchObject({
      status: "blocked",
      proof: {
        status: "missing",
        missing: ["decision"],
      },
      nextAction: {
        id: "resolve-risk",
        label: "Resolve risk",
      },
      handoff: "Resolve risk for task_alpha: Unresolved risk evidence requires an explicit later decision before completion.",
    })
    expect(prompt).toContain("Status: blocked")
    expect(prompt).toContain("Missing evidence: decision")
    expect(prompt).toContain("Resolve risk for task_alpha")
  })

  test("distinguishes blocked handoff from stale recovery", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Resolve memory blocker",
      requiredCapabilities: ["typescript"],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    const snapshot = runtime.snapshot()
    const blockedSnapshot = {
      ...snapshot,
      graphs: {
        mission_alpha: {
          ...snapshot.graphs.mission_alpha!,
          tasks: {
            ...snapshot.graphs.mission_alpha!.tasks,
            task_alpha: {
              ...snapshot.graphs.mission_alpha!.tasks.task_alpha!,
              status: "blocked" as const,
            },
          },
        },
      },
    }

    const memory = deriveMissionMemory(blockedSnapshot)

    expect(memory).toMatchObject({
      status: "blocked",
      activeTask: {
        id: "task_alpha",
        status: "blocked",
      },
      nextAction: {
        id: "resolve-blocker",
      },
      handoff:
        "Resolve blocker for task_alpha: The active task is blocked and needs explicit evidence, recovery, or user input.",
    })
  })

  test("keeps a sealed handoff for the latest completed mission", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Seal memory handoff",
      requiredCapabilities: ["typescript"],
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
        summary: "Changed mission memory",
        payload: { files: ["packages/core/src/mission-memory.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Mission memory tests passed",
        payload: { command: "bun test packages/core/tests/mission-memory.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })
    const completed = runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })
    expect(completed.ok).toBe(true)

    const memory = deriveMissionMemory(runtime.snapshot())
    const prompt = buildMissionMemoryPrompt(runtime.snapshot())

    expect(memory).toMatchObject({
      status: "sealed",
      missionId: "mission_alpha",
      goal: "Seal memory handoff",
      proof: {
        status: "present",
        passing: ["Mission memory tests passed"],
      },
      latestChanges: ["Changed mission memory"],
      handoff: "Mission mission_alpha is sealed with passing proof and 0 decision records.",
    })
    expect(prompt).toContain("Status: sealed")
    expect(prompt).toContain("Proof: present")
    expect(prompt).toContain("Passing proof: Mission memory tests passed")
  })
})
