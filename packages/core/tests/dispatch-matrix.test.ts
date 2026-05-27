import { describe, expect, test } from "bun:test"

import {
  createRuntime,
  deriveDispatchMatrix,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing", "repository-maintenance"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["packages/**"],
  completionCriteria: ["Code compiles", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: ["agent_artificer"],
}

const artificer: AgentContract = {
  id: "agent_artificer",
  displayName: "Artificer",
  description: "UI implementation agent",
  capabilities: ["typescript", "testing", "ui"],
  allowedTools: ["read", "edit", "test"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["packages/dashboard/**"],
  completionCriteria: ["UI renders", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

const steward: AgentContract = {
  id: "agent_steward",
  displayName: "Steward",
  description: "Planning and release agent",
  capabilities: ["repository-maintenance"],
  allowedTools: ["read", "edit"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["docs/**"],
  completionCriteria: ["Decision recorded"],
  requiredEvidence: ["decision"],
  fallbacks: [],
}

describe("dispatch matrix", () => {
  test("stays idle without an active mission", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })

    const matrix = deriveDispatchMatrix(runtime.snapshot())

    expect(matrix).toMatchObject({
      status: "idle",
      summary: "No active mission is ready for Dispatch Matrix.",
      readySlotCount: 0,
      activeSlotCount: 0,
      blockedSlotCount: 0,
      slots: [],
    })
  })

  test("detects parallel-ready mission slices and matching agent contracts", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.registerContract(artificer)
    runtime.registerContract(steward)
    runtime.startMission({
      goal: "Ship parallel OpenCode orchestration",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: parallel orchestration",
          description: "Record the dispatch boundary.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: adapter dispatch surface",
          description: "Expose dispatch state to OpenCode.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard dispatch panel",
          description: "Show dispatch state in the dashboard.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "review",
          title: "Review: dispatch",
          description: "Review the dispatch proof.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
          dependsOn: ["adapter-forge", "dashboard-forge"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "claim-plan",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_alpha",
        taskId: "task_alpha",
        type: "decision",
        summary: "Dispatch boundary approved",
        payload: {},
        createdAt: "2026-05-27T00:00:01.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_steward",
    })

    const matrix = deriveDispatchMatrix(runtime.snapshot())

    expect(matrix).toMatchObject({
      status: "parallel",
      missionId: "mission_alpha",
      readySlotCount: 2,
      activeSlotCount: 0,
      blockedSlotCount: 1,
      summary: "Dispatch Matrix parallel for mission_alpha: 2 ready slots can run across 2 agent contracts.",
    })
    expect(matrix.slots.map((slot) => [slot.key, slot.lane, slot.recommendedAgentId])).toEqual([
      ["plan", "complete", "agent_steward"],
      ["adapter-forge", "ready", "agent_atlas"],
      ["dashboard-forge", "ready", "agent_artificer"],
      ["review", "blocked", "agent_artificer"],
    ])
  })

  test("blocks ready tasks that no registered agent can execute", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Ship unsupported compiler work",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: unsupported compiler",
          description: "Change a compiler that needs an unavailable capability.",
          requiredCapabilities: ["rust"],
          requiredEvidence: ["file-change", "test-result"],
        },
      ],
    })

    const matrix = deriveDispatchMatrix(runtime.snapshot())

    expect(matrix).toMatchObject({
      status: "blocked",
      missionId: "mission_alpha",
      readySlotCount: 0,
      blockedSlotCount: 1,
      summary: "Dispatch Matrix blocked for mission_alpha: no claimable slots; 1 task needs dependencies, contracts, or recovery.",
    })
    expect(matrix.slots[0]).toMatchObject({
      key: "forge",
      lane: "blocked",
      blockers: ["no matching agent contract"],
    })
  })

  test("treats leased running work as a serial active dispatch", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Ship active dispatch",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: active dispatch",
          description: "Implement active dispatch state.",
          requiredCapabilities: ["typescript"],
          requiredEvidence: ["file-change", "test-result"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-forge",
      ttlMs: 30_000,
    })

    const matrix = deriveDispatchMatrix(runtime.snapshot())

    expect(matrix).toMatchObject({
      status: "serial",
      missionId: "mission_alpha",
      readySlotCount: 0,
      activeSlotCount: 1,
      blockedSlotCount: 0,
      summary: "Dispatch Matrix serial for mission_alpha: 1 dispatch slot is active or ready.",
    })
    expect(matrix.slots[0]).toMatchObject({
      key: "forge",
      lane: "active",
      activeLeaseId: "lease_alpha",
      activeHolder: "atlas",
      recommendedAgentId: "agent_atlas",
    })
  })
})
