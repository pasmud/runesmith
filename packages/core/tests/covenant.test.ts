import { describe, expect, test } from "bun:test"

import {
  buildCovenantControlBrief,
  buildCovenantPrompt,
  createRunicCovenant,
  getNextCovenantStage,
} from "../src/covenant"
import { createRuntime, type AgentContract } from "../src/index"

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

describe("runic covenant", () => {
  test("defines an autonomous end-to-end coding loop", () => {
    const covenant = createRunicCovenant()

    expect(covenant.name).toBe("Runic Covenant")
    expect(covenant.installMode).toBe("automatic")
    expect(covenant.stages.map((stage) => stage.id)).toEqual([
      "frame",
      "map",
      "claim",
      "forge",
      "prove",
      "repair",
      "review",
      "seal",
      "recover",
    ])
    expect(covenant.stages.every((stage) => stage.gates.length > 0)).toBe(true)
    expect(covenant.stages.every((stage) => stage.evidence.length > 0)).toBe(true)
  })

  test("builds a branded system prompt without external workflow naming", () => {
    const prompt = buildCovenantPrompt(createRunicCovenant())

    expect(prompt).toContain("Runic Covenant")
    expect(prompt).toContain("operate end to end")
    expect(prompt).toContain("required evidence")
    expect(prompt).toContain("recover stale or blocked work")
    expect(prompt).not.toContain("Superpowers")
  })

  test("advances through the covenant stages and loops recovery back to framing", () => {
    const covenant = createRunicCovenant()

    expect(getNextCovenantStage(covenant, "frame")?.id).toBe("map")
    expect(getNextCovenantStage(covenant, "seal")?.id).toBe("recover")
    expect(getNextCovenantStage(covenant, "recover")?.id).toBe("frame")
  })

  test("builds a state-aware control brief that rejects failed proof", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Harden evidence gates",
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
        summary: "Changed evidence ledger",
        payload: { filePath: "packages/core/src/evidence-ledger.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Core tests failed",
        payload: { command: "bun test packages/core/tests", exitCode: 1 },
        createdAt: fixedNow().toISOString(),
      },
    })

    const brief = buildCovenantControlBrief(runtime.snapshot())

    expect(brief).toContain("## Runesmith Control Brief")
    expect(brief).toContain("Active mission: mission_alpha")
    expect(brief).toContain("Next stage: Repair Gate")
    expect(brief).toContain("missing evidence: test-result")
    expect(brief).toContain("Diagnostics:")
    expect(brief).toContain("Core tests failed")
    expect(brief).toContain("Active runes:")
    expect(brief).toContain("Faultwright")
    expect(brief).toContain("Repair the smallest likely cause, then rerun the exact failing command.")
  })

  test("selects a recovery rune when the active task is stale", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Recover stale runebook work",
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
    runtime.recover({
      missionId: "mission_alpha",
      now: () => new Date("2026-05-27T00:02:00.000Z"),
      staleAfterMs: 60_000,
    })

    const brief = buildCovenantControlBrief(runtime.snapshot())

    expect(brief).toContain("Next stage: Recovery Sweep")
    expect(brief).toContain("Recovery Loom")
    expect(brief).toContain("Reclaim dependency-ready stale work with a fresh lease before unrelated edits.")
  })
})
