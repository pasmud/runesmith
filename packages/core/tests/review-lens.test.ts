import { describe, expect, test } from "bun:test"

import {
  advanceRunicMissionLoop,
  buildReviewLensPrompt,
  createCovenantTaskPlan,
  createRuntime,
  deriveReviewLens,
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

function loopDefaults() {
  return {
    contract: atlas,
    holder: "review-lens-loop",
    idempotencyScope: "review-lens",
    ttlMs: 30_000,
  }
}

function createPlannedRuntime() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  runtime.startMission({
    goal: "Build review discipline",
    taskPlan: createCovenantTaskPlan("Build review discipline"),
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

describe("review lens", () => {
  test("holds review until implementation proof is complete", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed OpenCode adapter",
        payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })

    const lens = deriveReviewLens(runtime.snapshot())

    expect(lens).toMatchObject({
      status: "waiting-for-proof",
      missionId: "mission_alpha",
      implementationTaskId: "task_alpha",
      reviewTaskId: "task_alpha_review",
      nextAction: "Capture missing proof before review can approve the mission.",
      findings: [
        {
          severity: "warning",
          summary: "Missing test-result evidence for task_alpha.",
        },
        {
          severity: "warning",
          summary: "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
        },
      ],
    })
    expect(lens.checklist.map((item) => [item.id, item.status])).toEqual([
      ["diff-scope", "passed"],
      ["proof-freshness", "blocked"],
      ["redline-proof", "attention"],
      ["risk-resolution", "passed"],
      ["review-decision", "blocked"],
    ])
  })

  test("marks verified Forge work ready for autonomous review", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed OpenCode adapter",
        payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const lens = deriveReviewLens(runtime.snapshot())
    const prompt = buildReviewLensPrompt(runtime.snapshot())

    expect(lens).toMatchObject({
      status: "ready",
      missionId: "mission_alpha",
      implementationTaskId: "task_alpha",
      reviewTaskId: "task_alpha_review",
      nextAction: "Approve review or record a risk before seal.",
      findings: [
        {
          severity: "warning",
          summary: "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
        },
      ],
    })
    expect(prompt).toContain("## Runesmith Review Lens")
    expect(prompt).toContain("Status: ready")
    expect(prompt).toContain("Next action: Approve review or record a risk before seal.")
    expect(prompt).toContain("diff-scope: passed")
    expect(prompt).toContain("proof-freshness: passed")
    expect(prompt).toContain("Lead with findings before approval")
  })

  test("surfaces missing Redline Proof when implementation changes precede focused failing proof", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed OpenCode adapter implementation",
        payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const lens = deriveReviewLens(runtime.snapshot())
    const prompt = buildReviewLensPrompt(runtime.snapshot())

    expect(lens.status).toBe("ready")
    expect(lens.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "redline-proof",
          status: "attention",
          detail: "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
        }),
      ]),
    )
    expect(lens.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "warning",
          summary: "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
        },
      ]),
    )
    expect(prompt).toContain("redline-proof: attention")
  })

  test("passes Redline Proof when a failing diagnostic precedes implementation changes", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_red",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "OpenCode adapter focused test failed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed OpenCode adapter implementation",
        payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const lens = deriveReviewLens(runtime.snapshot())

    expect(lens.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "redline-proof",
          status: "passed",
          detail: "Redline Proof satisfied for task_alpha: focused failing proof preceded implementation changes.",
        }),
      ]),
    )
    expect(lens.findings.map((finding) => finding.summary)).not.toContain(
      "Redline Proof missing for task_alpha: implementation changed before focused failing proof was captured.",
    )
  })

  test("passes Redline Proof when a test edit precedes implementation changes", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Added OpenCode adapter proof",
        payload: { filePath: "packages/opencode-adapter/tests/plugin.test.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_source_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed OpenCode adapter implementation",
        payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const lens = deriveReviewLens(runtime.snapshot())

    expect(lens.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "redline-proof",
          status: "passed",
          detail: "Redline Proof satisfied for task_alpha: focused proof file changed before implementation.",
        }),
      ]),
    )
  })

  test("blocks review when implementation evidence leaves the contract file scope", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runtime and env",
        payload: { files: ["packages/core/src/runtime.ts", ".env"] },
        createdAt: "2026-05-27T00:00:00.000Z",
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
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const lens = deriveReviewLens(runtime.snapshot())

    expect(lens.status).toBe("blocked")
    expect(lens.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "critical",
          summary: ".env is outside agent_atlas file scope.",
        },
      ]),
    )
    expect(lens.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "diff-scope",
          status: "blocked",
          detail: ".env is outside agent_atlas file scope.",
        }),
      ]),
    )
  })

  test("embeds the Review Lens in autonomous review decision evidence", () => {
    const runtime = createPlannedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed OpenCode adapter",
        payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const advanced = advanceRunicMissionLoop(runtime, loopDefaults())
    expect(advanced.ok).toBe(true)
    if (!advanced.ok) return

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha_review",
          type: "decision",
          payload: expect.objectContaining({
            stage: "review",
            reviewLens: expect.objectContaining({
              status: "ready",
              implementationTaskId: "task_alpha",
              findingCount: 1,
            }),
          }),
        }),
      ]),
    )
  })
})
