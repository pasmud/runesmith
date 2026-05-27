import { describe, expect, test } from "bun:test"

import {
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
})

function deterministicIds(): IdFactory {
  const counts = new Map<string, number>()

  return (prefix) => {
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    return `${prefix}_${next}`
  }
}
