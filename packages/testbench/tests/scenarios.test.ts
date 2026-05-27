import { describe, expect, test } from "bun:test"

import { runDuplicatePromptScenario, runEvidenceGateScenario, runStaleTaskScenario } from "../src/index"

describe("runesmith testbench scenarios", () => {
  test("duplicate prompt scenario replays the original lease", () => {
    expect(runDuplicatePromptScenario()).toEqual({
      firstLeaseId: "lease_alpha",
      secondLeaseId: "lease_alpha",
      replayed: true,
      leaseCount: 1,
    })
  })

  test("stale task scenario marks missing-heartbeat work stale", () => {
    expect(runStaleTaskScenario()).toEqual({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      status: "stale",
      staleEvents: 1,
    })
  })

  test("evidence gate scenario blocks completion before proof and allows it after proof", () => {
    expect(runEvidenceGateScenario()).toEqual({
      beforeEvidence: "EVIDENCE_REQUIRED",
      afterEvidence: "complete",
      missionStatus: "complete",
    })
  })
})
