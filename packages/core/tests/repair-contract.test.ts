import { describe, expect, test } from "bun:test"

import {
  buildRepairContractPrompt,
  createRuntime,
  deriveRepairContract,
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
  fallbacks: [],
}

function createClaimedRuntime() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  runtime.startMission({
    goal: "Repair with discipline",
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
      id: "evidence_initial_change",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Initial implementation edit",
      payload: { filePath: "packages/core/src/runebook.ts" },
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  })

  return runtime
}

function addDiagnostic(runtime: ReturnType<typeof createClaimedRuntime>, id = "evidence_diagnostic", createdAt = "2026-05-27T00:01:00.000Z") {
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id,
      taskId: "task_alpha",
      type: "diagnostic",
      summary: "Runebook tests failed",
      payload: { command: "bun test packages/core/tests/runebook.test.ts", exitCode: 1 },
      createdAt,
    },
  })
}

describe("repair contract", () => {
  test("waits for a repair edit after the latest failed diagnostic", () => {
    const runtime = createClaimedRuntime()
    addDiagnostic(runtime)

    const contract = deriveRepairContract(runtime.snapshot())
    const prompt = buildRepairContractPrompt(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "awaiting-repair",
      missionId: "mission_alpha",
      taskId: "task_alpha",
      diagnostic: "Runebook tests failed",
      failingCommand: "bun test packages/core/tests/runebook.test.ts",
      failedAttempts: 1,
      repairChanges: [],
      summary: "Repair contract waiting for task_alpha: state a hypothesis, change one repair variable, then rerun bun test packages/core/tests/runebook.test.ts.",
    })
    expect(prompt).toContain("## Runesmith Repair Contract")
    expect(prompt).toContain("Status: awaiting-repair")
    expect(prompt).toContain("Repair changes: none")
  })

  test("marks a single post-diagnostic implementation edit ready for proof", () => {
    const runtime = createClaimedRuntime()
    addDiagnostic(runtime)
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_repair_change",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runebook repair path",
        payload: { filePath: "packages/core/src/runebook.ts" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const contract = deriveRepairContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "ready-for-proof",
      repairChanges: ["packages/core/src/runebook.ts"],
      summary: "Repair contract ready for task_alpha: one repair variable changed after the diagnostic; rerun bun test packages/core/tests/runebook.test.ts.",
    })
  })

  test("flags broad repair edits before proof reruns", () => {
    const runtime = createClaimedRuntime()
    addDiagnostic(runtime)
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_broad_repair",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed multiple repair surfaces",
        payload: {
          files: [
            "packages/core/src/runebook.ts",
            "packages/core/src/protocol-deck.ts",
          ],
        },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const contract = deriveRepairContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "over-broad",
      repairChanges: [
        "packages/core/src/runebook.ts",
        "packages/core/src/protocol-deck.ts",
      ],
      summary: "Repair contract over-broad for task_alpha: 2 implementation files changed before proof reran.",
      warnings: ["Keep Faultwright repairs to one variable before rerunning the failing proof."],
    })
  })

  test("marks repair proven after passing proof follows the diagnostic and repair edit", () => {
    const runtime = createClaimedRuntime()
    addDiagnostic(runtime)
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_repair_change",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runebook repair path",
        payload: { filePath: "packages/core/src/runebook.ts" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_repair_proof",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Runebook tests passed",
        payload: { command: "bun test packages/core/tests/runebook.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:03:00.000Z",
      },
    })

    const contract = deriveRepairContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "proven",
      repairChanges: ["packages/core/src/runebook.ts"],
      passingProof: "Runebook tests passed",
      summary: "Repair contract proven for task_alpha: passing proof followed the diagnostic and repair edit.",
    })
  })

  test("marks repeated failed repair diagnostics as a Faultline contract", () => {
    const runtime = createClaimedRuntime()
    addDiagnostic(runtime, "evidence_diagnostic_1", "2026-05-27T00:01:00.000Z")
    addDiagnostic(runtime, "evidence_diagnostic_2", "2026-05-27T00:02:00.000Z")
    addDiagnostic(runtime, "evidence_diagnostic_3", "2026-05-27T00:03:00.000Z")

    const contract = deriveRepairContract(runtime.snapshot())

    expect(contract).toMatchObject({
      status: "faultline",
      failedAttempts: 3,
      summary: "Repair contract escalated for task_alpha: 3 failed proof attempts require Faultline architecture review before another patch.",
    })
  })
})
