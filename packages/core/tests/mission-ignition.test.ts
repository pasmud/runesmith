import { describe, expect, test } from "bun:test"

import {
  createRuntime,
  prepareRunicMission,
  type AgentContract,
  type IdFactory,
} from "../src/index"

const fixedNow = () => new Date("2026-05-28T00:00:00.000Z")

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

describe("runic mission ignition", () => {
  test("starts a covenant mission once and replays the existing claim for the same goal", () => {
    const runtime = createRuntime({ idFactory: createCountedIds(), now: fixedNow })
    runtime.registerContract(atlas)

    const first = prepareRunicMission(runtime, {
      goal: "Add one-command Runesmith ignition",
      contract: atlas,
      holder: "runesmith-ignite",
      idempotencyScope: "ignite",
      ttlMs: 30_000,
    })

    expect(first).toMatchObject({
      ok: true,
      value: {
        goal: "Add one-command Runesmith ignition",
        missionId: "mission_alpha_1",
        taskId: "task_alpha_1",
        leaseId: "lease_alpha_1",
        agentId: "agent_atlas",
        missionCreated: true,
        replayed: false,
      },
    })

    const second = prepareRunicMission(runtime, {
      goal: "Add one-command Runesmith ignition",
      contract: atlas,
      holder: "runesmith-ignite",
      idempotencyScope: "ignite",
      ttlMs: 30_000,
    })

    expect(second).toMatchObject({
      ok: true,
      value: {
        missionId: "mission_alpha_1",
        taskId: "task_alpha_1",
        leaseId: "lease_alpha_1",
        missionCreated: false,
        replayed: true,
        loopPulse: {
          nextAction: {
            id: "refine-plan",
          },
        },
      },
    })
    expect(Object.keys(runtime.snapshot().graphs)).toEqual(["mission_alpha_1"])
  })

  test("resumes the next dependency-ready covenant task after forge completes", () => {
    const runtime = createRuntime({ idFactory: createCountedIds(), now: fixedNow })
    runtime.registerContract(atlas)

    const started = prepareRunicMission(runtime, {
      goal: "Resume review after verified forge work",
      contract: atlas,
      holder: "runesmith-ignite",
      idempotencyScope: "ignite",
      ttlMs: 30_000,
    })
    if (!started.ok) throw new Error(started.error.message)

    runtime.addTaskEvidence({
      missionId: started.value.missionId,
      evidence: {
        id: "evidence_file",
        taskId: started.value.taskId,
        type: "file-change",
        summary: "Changed CLI ignition files",
        payload: { filePath: "packages/cli/src/index.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: started.value.missionId,
      evidence: {
        id: "evidence_test",
        taskId: started.value.taskId,
        type: "test-result",
        summary: "Focused ignition tests passed",
        payload: { command: "bun test packages/core/tests/mission-ignition.test.ts", exitCode: 0 },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.completeTask({
      missionId: started.value.missionId,
      taskId: started.value.taskId,
      contractId: atlas.id,
    })

    const resumed = prepareRunicMission(runtime, {
      goal: "Resume review after verified forge work",
      contract: atlas,
      holder: "runesmith-ignite",
      idempotencyScope: "ignite",
      ttlMs: 30_000,
    })

    expect(resumed).toMatchObject({
      ok: true,
      value: {
        missionCreated: false,
        missionId: "mission_alpha_1",
        taskId: "task_alpha_1_review",
        agentId: "agent_atlas",
        loopPulse: {
          nextAction: {
            id: "review-change",
          },
        },
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha_1.tasks.task_alpha_1_review.status).toBe("running")
  })
})

function createCountedIds(): IdFactory {
  const counts = new Map<string, number>()

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)

    return `${prefix}_alpha_${next}`
  }
}
