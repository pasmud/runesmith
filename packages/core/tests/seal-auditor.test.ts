import { describe, expect, test } from "bun:test"

import {
  advanceRunicMissionLoop,
  buildSealAuditPrompt,
  createCovenantTaskPlan,
  createRuntime,
  deriveSealAudit,
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

function createClaimedRuntime() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  runtime.startMission({
    goal: "Ship with proof",
    taskPlan: createCovenantTaskPlan("Ship with proof"),
  })
  runtime.claimTask({
    missionId: "mission_alpha",
    taskId: "task_alpha",
    contractId: "agent_atlas",
    holder: "atlas",
    idempotencyKey: "claim-task-alpha",
    ttlMs: 30_000,
  })

  return runtime
}

function addFileChange(runtime: ReturnType<typeof createClaimedRuntime>, filePath = "packages/core/src/runtime.ts") {
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_file",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed runtime files",
      payload: { filePath },
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  })
}

function addPassingProof(runtime: ReturnType<typeof createClaimedRuntime>) {
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_test",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Core tests passed",
      payload: { command: "bun test packages/core/tests/runtime.test.ts", exitCode: 0 },
      createdAt: "2026-05-27T00:01:00.000Z",
    },
  })
}

describe("seal audit", () => {
  test("collects missing proof into a pre-completion audit", () => {
    const runtime = createClaimedRuntime()
    addFileChange(runtime)

    const audit = deriveSealAudit(runtime.snapshot(), {
      packageManager: "bun",
      scripts: { test: "bun test", typecheck: "tsc -b" },
    })
    const prompt = buildSealAuditPrompt(runtime.snapshot(), {
      packageManager: "bun",
      scripts: { test: "bun test", typecheck: "tsc -b" },
    })

    expect(audit).toMatchObject({
      status: "collecting-proof",
      missionId: "mission_alpha",
      implementationTaskId: "task_alpha",
      summary: "mission_alpha needs stronger proof before any completion claim.",
      nextAction: "Run the Proof Plan before review or seal.",
    })
    expect(audit.checks.map((check) => [check.id, check.status])).toEqual([
      ["mission-state", "passed"],
      ["proof-gate", "attention"],
      ["redline-gate", "attention"],
      ["repair-gate", "passed"],
      ["scope-gate", "passed"],
      ["review-gate", "attention"],
      ["seal-decision", "blocked"],
    ])
    expect(prompt).toContain("## Runesmith Seal Audit")
    expect(prompt).toContain("Status: collecting-proof")
    expect(prompt).toContain("Directive: Do not claim completion or seal the mission until the Seal Audit is ready or sealed.")
  })

  test("blocks completion claims when scope drift reaches review", () => {
    const runtime = createClaimedRuntime()
    addFileChange(runtime, ".env")
    addPassingProof(runtime)

    const audit = deriveSealAudit(runtime.snapshot())

    expect(audit.status).toBe("blocked")
    expect(audit.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "critical",
          summary: ".env is outside agent_atlas file scope.",
        },
      ]),
    )
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "scope-gate",
          status: "blocked",
        }),
      ]),
    )
  })

  test("marks verified work ready for Sealmark when proof review and scope are clear", () => {
    const runtime = createClaimedRuntime()
    addFileChange(runtime)
    addPassingProof(runtime)

    const audit = deriveSealAudit(runtime.snapshot())

    expect(audit).toMatchObject({
      status: "ready",
      missionId: "mission_alpha",
      implementationTaskId: "task_alpha",
      reviewTaskId: "task_alpha_review",
      sealTaskId: "task_alpha_seal",
      summary: "mission_alpha is ready for Sealmark checkpoint.",
      nextAction: "Record the seal decision and persist the final capsule.",
      findings: [
        {
          severity: "warning",
          summary: "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
        },
      ],
    })
    expect(audit.checks.map((check) => [check.id, check.status])).toEqual([
      ["mission-state", "passed"],
      ["proof-gate", "passed"],
      ["redline-gate", "attention"],
      ["repair-gate", "passed"],
      ["scope-gate", "passed"],
      ["review-gate", "passed"],
      ["seal-decision", "attention"],
    ])
    expect(audit.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "warning",
          summary: "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
        },
      ]),
    )
  })

  test("marks Redline Proof passed when focused failing proof came first", () => {
    const runtime = createClaimedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_red",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "Core focused test failed",
        payload: { command: "bun test packages/core/tests/runtime.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runtime files",
        payload: { filePath: "packages/core/src/runtime.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Core tests passed",
        payload: { command: "bun test packages/core/tests/runtime.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const audit = deriveSealAudit(runtime.snapshot())
    const prompt = buildSealAuditPrompt(runtime.snapshot())

    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "redline-gate",
          status: "passed",
          detail: "Redline Proof satisfied for task_alpha: focused failing proof preceded implementation changes.",
        }),
      ]),
    )
    expect(prompt).toContain("redline-gate: passed")
  })

  test("carries over-broad Faultwright repair edits into seal findings", () => {
    const runtime = createClaimedRuntime()
    addFileChange(runtime, "packages/core/src/runebook.ts")
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "Runebook tests failed",
        payload: { command: "bun test packages/core/tests/runebook.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_broad_repair",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed two repair surfaces",
        payload: {
          files: [
            "packages/core/src/runebook.ts",
            "packages/core/src/protocol-deck.ts",
          ],
        },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const audit = deriveSealAudit(runtime.snapshot())

    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "repair-gate",
          status: "blocked",
          detail: "Repair contract over-broad for task_alpha: 2 implementation files changed before proof reran.",
        }),
      ]),
    )
    expect(audit.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "warning",
          summary: "Repair contract over-broad for task_alpha: 2 implementation files changed before proof reran.",
        },
      ]),
    )
  })

  test("reports sealed missions as finished after the shared loop completes", () => {
    const runtime = createClaimedRuntime()
    addFileChange(runtime)
    addPassingProof(runtime)

    const advanced = advanceRunicMissionLoop(runtime, {
      contract: atlas,
      holder: "seal-audit-loop",
      idempotencyScope: "seal-audit",
      ttlMs: 30_000,
    })
    expect(advanced.ok).toBe(true)

    const audit = deriveSealAudit(runtime.snapshot())
    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)

    expect(audit).toMatchObject({
      status: "sealed",
      missionId: "mission_alpha",
      sealTaskId: "task_alpha_seal",
      summary: "mission_alpha is sealed with completion evidence.",
      nextAction: "No completion action remains.",
    })
    expect(audit.checks.every((check) => check.status === "passed")).toBe(true)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha_seal",
          type: "decision",
          payload: expect.objectContaining({
            sealAudit: expect.objectContaining({
              status: "ready",
              missionId: "mission_alpha",
              findingCount: 1,
            }),
          }),
        }),
      ]),
    )
  })
})
