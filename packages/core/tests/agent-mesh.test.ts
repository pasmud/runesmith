import { describe, expect, test } from "bun:test"

import {
  advanceRunicMissionLoop,
  createCovenantTaskPlan,
  createRuntime,
  createRunesmithAgentContractMap,
  createRunesmithAgentContracts,
  defaultRunesmithAgentContract,
  deriveDispatchMatrix,
  type IdFactory,
} from "../src/index"

describe("runesmith agent mesh", () => {
  test("ships default contracts for routing without user-authored setup", () => {
    const contracts = createRunesmithAgentContracts()
    const contractMap = createRunesmithAgentContractMap()

    expect(contracts.map((contract) => contract.id)).toEqual([
      "agent_atlas",
      "agent_oracle",
      "agent_artificer",
      "agent_scout",
      "agent_steward",
    ])
    expect(defaultRunesmithAgentContract.id).toBe("agent_atlas")
    expect(contractMap.agent_atlas.capabilities).toEqual(["typescript", "testing", "repository-maintenance"])
    expect(contractMap.agent_oracle.capabilities).toContain("testing")
    expect(contractMap.agent_artificer.capabilities).toContain("ui")
    expect(contractMap.agent_scout.capabilities).toContain("diagnostics")
    expect(contractMap.agent_steward.capabilities).toContain("repository-maintenance")

    const mutated = createRunesmithAgentContracts()
    mutated[0]!.capabilities.push("mutated")
    expect(createRunesmithAgentContractMap().agent_atlas.capabilities).not.toContain("mutated")
  })

  test("lets Dispatch Matrix route independent work across the default mesh", () => {
    const runtime = createRuntime({
      idFactory: deterministicIds(),
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    for (const contract of createRunesmithAgentContracts()) {
      runtime.registerContract(contract)
    }

    runtime.startMission({
      goal: "Route parallel OpenCode work",
      taskPlan: [
        {
          key: "ui",
          title: "Build the orchestration dashboard",
          description: "Create the operator UI surface.",
          requiredCapabilities: ["typescript", "ui"],
          requiredEvidence: ["file-change", "test-result"],
        },
        {
          key: "release",
          title: "Prepare the release checkpoint",
          description: "Package the direct-install repo state.",
          requiredCapabilities: ["repository-maintenance", "release"],
          requiredEvidence: ["decision"],
        },
      ],
    })

    const matrix = deriveDispatchMatrix(runtime.snapshot())

    expect(matrix).toMatchObject({
      status: "parallel",
      readySlotCount: 2,
      blockedSlotCount: 0,
      summary: "Dispatch Matrix parallel for mission_1: 2 ready slots can run across 2 agent contracts.",
    })
    expect(matrix.slots.map((slot) => [slot.key, slot.lane, slot.recommendedAgentId])).toEqual([
      ["ui", "ready", "agent_artificer"],
      ["release", "ready", "agent_steward"],
    ])
  })

  test("drives Covenant Review and Seal claims through Oracle and Steward", () => {
    const runtime = createRuntime({
      idFactory: deterministicIds(),
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    for (const contract of createRunesmithAgentContracts()) {
      runtime.registerContract(contract)
    }
    const started = runtime.startMission({
      goal: "Ship mesh routed Covenant work",
      taskPlan: createCovenantTaskPlan("Ship mesh routed Covenant work"),
    })
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const forgeClaim = runtime.claimTask({
      missionId: started.value.missionId,
      taskId: started.value.rootTaskId,
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-forge",
      ttlMs: 30_000,
    })
    expect(forgeClaim.ok).toBe(true)
    for (const evidence of [
      {
        id: "evidence_file",
        taskId: started.value.rootTaskId,
        type: "file-change" as const,
        summary: "Changed implementation",
        payload: { files: ["packages/core/src/runtime.ts"] },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
      {
        id: "evidence_test",
        taskId: started.value.rootTaskId,
        type: "test-result" as const,
        summary: "bun test passed",
        payload: { command: "bun test", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    ]) {
      const recorded = runtime.addTaskEvidence({
        missionId: started.value.missionId,
        evidence,
      })
      expect(recorded.ok).toBe(true)
    }

    const advanced = advanceRunicMissionLoop(runtime, {
      contract: defaultRunesmithAgentContract,
      holder: "mesh-loop",
      idempotencyScope: "mesh",
      evidenceIdFactory: ({ task, stage }) => `evidence_${task.key}_${stage}`,
    })

    expect(advanced.ok).toBe(true)
    const tasks = runtime.snapshot().graphs[started.value.missionId]?.tasks ?? {}
    expect(tasks[started.value.rootTaskId]?.assignedAgentId).toBe("agent_atlas")
    expect(tasks[`${started.value.rootTaskId}_review`]?.assignedAgentId).toBe("agent_oracle")
    expect(tasks[`${started.value.rootTaskId}_seal`]?.assignedAgentId).toBe("agent_steward")
    expect(runtime.snapshot().graphs[started.value.missionId]?.mission.status).toBe("complete")
  })
})

function deterministicIds(): IdFactory {
  const counts = new Map<string, number>()

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    return `${prefix}_${next}`
  }
}
