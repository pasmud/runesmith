import { describe, expect, test } from "bun:test"

import {
  buildPlanContractPrompt,
  createCovenantTaskPlan,
  createRuntime,
  derivePlanContract,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing"],
  allowedTools: ["read", "edit", "test"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["packages/**"],
  completionCriteria: ["Implementation changed", "Focused tests passed"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

const oracle: AgentContract = {
  id: "agent_oracle",
  displayName: "Oracle",
  description: "Verification agent",
  capabilities: ["testing"],
  allowedTools: ["read", "test"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["packages/**"],
  completionCriteria: ["Verification passed"],
  requiredEvidence: ["test-result"],
  fallbacks: [],
}

describe("plan contract", () => {
  test("stays idle without an active mission map", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })

    const contract = derivePlanContract(runtime.snapshot())
    const prompt = buildPlanContractPrompt(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "idle",
      summary: "No mission map is active for a Plan Contract.",
      taskCount: 0,
      executionSlices: [],
      missing: [],
      warnings: [],
    })
    expect(prompt).toContain("## Runesmith Plan Contract")
    expect(prompt).toContain("Status: idle")
  })

  test("marks the default Covenant map as thin planning", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.startMission({
      goal: "Build automatic planning discipline",
      taskPlan: createCovenantTaskPlan("Build automatic planning discipline"),
    })

    const contract = derivePlanContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "thin",
      missionId: "mission_alpha",
      goal: "Build automatic planning discipline",
      taskCount: 3,
      implementationTaskCount: 1,
      summary: "Plan contract thin for mission_alpha: Forge/Review/Seal exists, but implementation has no concrete execution slices yet.",
      missing: ["concrete execution slices"],
      warnings: ["Break the Forge stage into focused implementation/proof slices before broad autonomous work."],
    })
    expect(contract.executionSlices.map((slice) => [slice.key, slice.status])).toEqual([
      ["forge", "queued"],
      ["review", "queued"],
      ["seal", "queued"],
    ])
  })

  test("marks a decomposed mission map ready for execution", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.startMission({
      goal: "Ship OpenCode plan guard",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: Ship OpenCode plan guard",
          description: "Record concrete slices, interfaces, and proof commands before implementation.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: OpenCode plan guard prompt surface",
          description: "Expose the plan contract in the OpenCode prompt and status tool.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard plan guard panel",
          description: "Show the plan contract in the mission-control right rail.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "review",
          title: "Review: plan guard",
          description: "Review proof, scope, and residual risk for the plan guard.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
          dependsOn: ["adapter-forge", "dashboard-forge"],
        },
        {
          key: "seal",
          title: "Seal: plan guard",
          description: "Capture the final checkpoint and handoff.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
          dependsOn: ["review"],
        },
      ],
    })

    const contract = derivePlanContract(runtime.snapshot())
    const prompt = buildPlanContractPrompt(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "ready",
      missionId: "mission_alpha",
      taskCount: 5,
      implementationTaskCount: 2,
      missing: [],
      warnings: [],
      summary: "Plan contract ready for mission_alpha: 2 focused implementation slices are mapped with proof evidence.",
    })
    expect(prompt).toContain("adapter-forge")
    expect(prompt).toContain("dashboard-forge")
  })

  test("blocks mission maps with tasks that cannot prove completion", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.startMission({
      goal: "Ship an unprovable plan",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: unprovable implementation",
          description: "Change implementation without an evidence contract.",
          requiredCapabilities: ["typescript"],
        },
        {
          key: "review",
          title: "Review: unprovable implementation",
          description: "Review the implementation.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
          dependsOn: ["forge"],
        },
      ],
    })

    const contract = derivePlanContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "blocked",
      missionId: "mission_alpha",
      taskCount: 2,
      implementationTaskCount: 1,
      missing: ["required evidence for forge"],
      summary: "Plan contract blocked for mission_alpha: 1 mapped task lacks required evidence.",
    })
  })

  test("uses assigned agent contracts as the evidence plan for legacy mapped tasks", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.registerContract(oracle)
    runtime.startMission({
      goal: "Ship legacy capsule planning",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: legacy capsule adapter",
          description: "Implement a capsule adapter that predates explicit task evidence.",
          requiredCapabilities: ["typescript"],
        },
        {
          key: "review",
          title: "Review: legacy capsule adapter",
          description: "Verify the adapter behavior.",
          requiredCapabilities: ["testing"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-atlas",
      ttlMs: 30_000,
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_oracle",
      holder: "oracle",
      idempotencyKey: "claim-oracle",
      ttlMs: 30_000,
    })

    const contract = derivePlanContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "ready",
      missionId: "mission_alpha",
      taskCount: 2,
      implementationTaskCount: 1,
      missing: [],
      summary: "Plan contract ready for mission_alpha: 1 focused implementation slice is mapped with proof evidence.",
    })
    expect(contract.executionSlices.map((slice) => [slice.key, slice.requiredEvidence])).toEqual([
      ["forge", ["file-change", "test-result"]],
      ["review", ["test-result"]],
    ])
  })
})
