import { describe, expect, test } from "bun:test"

import {
  buildMissionMapPrompt,
  createCovenantTaskPlan,
  createRuntime,
  deriveMissionMap,
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
    primary: "anthropic/claude-sonnet-4.5",
    fallbacks: ["openai/gpt-5.1-codex"],
  },
  fileScope: ["packages/**"],
  completionCriteria: ["Code compiles", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

describe("mission map", () => {
  test("derives a live engine-owned map from a planned Covenant mission", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Build direct OpenCode orchestration",
      taskPlan: createCovenantTaskPlan("Build direct OpenCode orchestration"),
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })

    const map = deriveMissionMap(runtime.snapshot())

    expect(map).toMatchObject({
      status: "mapped",
      missionId: "mission_alpha",
      rootTaskId: "task_alpha",
      goal: "Build direct OpenCode orchestration",
      nextTaskId: "task_alpha",
      taskCount: 3,
      summary:
        "mission_alpha maps 3 tasks for Build direct OpenCode orchestration. Next task: task_alpha.",
      tasks: [
        {
          id: "task_alpha",
          key: "forge",
          title: "Forge: Build direct OpenCode orchestration",
          status: "running",
          ready: false,
          blockedBy: [],
          requiredEvidence: ["file-change", "test-result"],
        },
        {
          id: "task_alpha_review",
          key: "review",
          title: "Review: Build direct OpenCode orchestration",
          status: "queued",
          ready: false,
          blockedBy: ["task_alpha"],
          requiredEvidence: ["decision"],
        },
        {
          id: "task_alpha_seal",
          key: "seal",
          title: "Seal: Build direct OpenCode orchestration",
          status: "queued",
          ready: false,
          blockedBy: ["task_alpha_review"],
          requiredEvidence: ["decision"],
        },
      ],
    })
  })

  test("builds a compact prompt section for OpenCode and compaction", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.startMission({
      goal: "Expose the mission map",
      taskPlan: createCovenantTaskPlan("Expose the mission map"),
    })

    const prompt = buildMissionMapPrompt(runtime.snapshot())

    expect(prompt).toContain("## Runesmith Mission Map")
    expect(prompt).toContain("Status: mapped")
    expect(prompt).toContain("Mission: mission_alpha")
    expect(prompt).toContain("Next task: task_alpha")
    expect(prompt).toContain("- queued forge task_alpha: Forge: Expose the mission map")
    expect(prompt).toContain("- queued review task_alpha_review: Review: Expose the mission map")
    expect(prompt).toContain("Do not ask the user to load workflows or choose stages manually.")
  })
})
