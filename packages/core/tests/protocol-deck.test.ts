import { describe, expect, test } from "bun:test"

import {
  buildRunicProtocolPrompt,
  createRuntime,
  deriveRunicProtocolDeck,
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

describe("runic protocol deck", () => {
  test("selects a proof-first Forge protocol without exposing manual workflow names", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Forge with proof-first protocol",
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

    const deck = deriveRunicProtocolDeck(runtime.snapshot())
    const prompt = buildRunicProtocolPrompt(runtime.snapshot())

    expect(deck.active).toMatchObject({
      id: "forge-trace-protocol",
      name: "Forge Trace Protocol",
      mode: "auto",
    })
    expect(deck.active.procedure).toContain("Create or update a focused failing proof before production edits when behavior is testable.")
    expect(deck.active.forbiddenMoves).toContain("Do not skip the focused proof-first loop for behavior that can be tested.")
    expect(prompt).toContain("Active protocol: Forge Trace Protocol [auto]")
    expect(prompt).toContain("Create or update a focused failing proof before production edits")
    expect(prompt).not.toContain("Superpowers")
  })

  test("selects a branded repair protocol from failed proof without user-invoked workflows", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Repair protocol deck proof",
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
        summary: "Changed protocol deck",
        payload: { filePath: "packages/core/src/protocol-deck.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "Protocol deck tests failed",
        payload: { command: "bun test packages/core/tests/protocol-deck.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const options = {
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: {
          test: "bun test",
        },
      },
    }
    const deck = deriveRunicProtocolDeck(runtime.snapshot(), options)
    const prompt = buildRunicProtocolPrompt(runtime.snapshot(), options)

    expect(deck.active).toMatchObject({
      id: "faultwright-repair-protocol",
      name: "Faultwright Repair Protocol",
      mode: "guarded",
      toolHints: ["runesmith_proof_run"],
    })
    expect(deck.summary).toBe("Repair diagnostic through Faultwright Repair Protocol.")
    expect(deck.active.procedure[0]).toContain("Protocol deck tests failed")
    expect(deck.active.verification).toEqual([
      "Rerun failing command: bun test packages/core/tests/protocol-deck.test.ts",
      "Run tests: bun test",
    ])
    expect(deck.active.forbiddenMoves).toContain("Do not rerun the same failing proof before a repair edit is captured.")
    expect(prompt).toContain("## Runesmith Protocol Deck")
    expect(prompt).toContain("Active protocol: Faultwright Repair Protocol [guarded]")
    expect(prompt).toContain("Engine-selected protocol; do not ask the user to invoke a workflow by name.")
    expect(prompt).not.toContain("Superpowers")
  })

  test("selects a proof protocol with exact commands when implementation evidence is ready", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Prove protocol deck work",
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
        summary: "Changed protocol deck",
        payload: { filePath: "packages/core/src/protocol-deck.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const deck = deriveRunicProtocolDeck(runtime.snapshot(), {
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: {
          typecheck: "tsc --noEmit",
          test: "bun test",
        },
      },
    })

    expect(deck.active).toMatchObject({
      id: "proofwright-proof-protocol",
      name: "Proofwright Proof Protocol",
      mode: "auto",
      toolHints: ["runesmith_proof_run"],
    })
    expect(deck.active.verification).toEqual([
      "Run typecheck: bun run typecheck",
      "Run tests: bun test",
    ])
    expect(deck.active.forbiddenMoves).toContain("Do not mark completion from transcript confidence alone.")
  })
})
