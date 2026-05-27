import { describe, expect, test } from "bun:test"

import {
  buildRunebookPrompt,
  createCovenantTaskPlan,
  createRuntime,
  deriveRunebook,
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

describe("runebook", () => {
  test("derives an automatic Pathfinder Plan Refinery card for thin Covenant maps", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Build install-direct orchestration",
      taskPlan: createCovenantTaskPlan("Build install-direct orchestration"),
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })

    const runebook = deriveRunebook(runtime.snapshot())
    const prompt = buildRunebookPrompt(runtime.snapshot())

    expect(runebook.activeCard).toMatchObject({
      id: "pathfinder-plan-refinery",
      title: "Pathfinder plan refinery",
      nextActionId: "refine-plan",
      autonomy: "auto",
      requiredEvidence: ["decision"],
      toolHints: ["runesmith_plan_refine", "runesmith_next"],
    })
    expect(runebook.activeCard.steps).toContain("Replace the thin Forge/Review/Seal map with proof-backed runtime, interface, review, and seal slices.")
    expect(runebook.activeCard.stopConditions).toContain("Do not start broad Forge work while the Plan Contract is thin and evidence-free.")
    expect(prompt).toContain("Active card: Pathfinder plan refinery [auto]")
    expect(prompt).toContain("Tool hints: runesmith_plan_refine, runesmith_next")
  })

  test("derives a proof-first Forge Trace card for implementation work", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Implement proof-first forge",
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

    const runebook = deriveRunebook(runtime.snapshot())
    const prompt = buildRunebookPrompt(runtime.snapshot())

    expect(runebook.activeCard).toMatchObject({
      id: "forge-trace",
      title: "Forge Trace implementation loop",
      nextActionId: "continue-forge",
      autonomy: "auto",
      requiredEvidence: ["file-change", "test-result"],
    })
    expect(runebook.activeCard.steps).toContain("Create or update a focused failing proof before production edits when behavior is testable.")
    expect(runebook.activeCard.steps).toContain("Apply the smallest scoped implementation change that makes the focused proof pass.")
    expect(runebook.activeCard.stopConditions).toContain("Do not skip a focused proof path for testable behavior.")
    expect(prompt).toContain("Create or update a focused failing proof before production edits")
  })

  test("derives a guarded Faultwright repair card with exact proof commands", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Repair runebook proof",
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
        summary: "Changed runebook",
        payload: { filePath: "packages/core/src/runebook.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "Runebook tests failed",
        payload: { command: "bun test packages/core/tests/runebook.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const runebook = deriveRunebook(runtime.snapshot(), {
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: {
          test: "bun test",
        },
      },
    })
    const prompt = buildRunebookPrompt(runtime.snapshot(), {
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: {
          test: "bun test",
        },
      },
    })

    expect(runebook.activeCard).toMatchObject({
      id: "faultwright-repair",
      title: "Faultwright repair loop",
      nextActionId: "repair-diagnostic",
      autonomy: "guarded",
      requiredEvidence: ["test-result"],
      toolHints: ["runesmith_proof_run"],
    })
    expect(runebook.activeCard.steps[0]).toContain("Runebook tests failed")
    expect(runebook.activeCard.steps).toContain("State a falsifiable repair hypothesis from the latest diagnostic before editing.")
    expect(runebook.activeCard.steps).toContain("Change one repair variable at a time and explain why it should change the failing output.")
    expect(runebook.activeCard.commands.map((command) => command.command)).toEqual([
      "bun test packages/core/tests/runebook.test.ts",
      "bun test",
    ])
    expect(runebook.activeCard.stopConditions).toContain("Hold completion until the rerun records passing test-result evidence.")
    expect(runebook.activeCard.stopConditions).toContain("Do not patch symptoms without linking the edit to the active diagnostic.")
    expect(prompt).toContain("## Runesmith Runebook")
    expect(prompt).toContain("Active card: Faultwright repair loop [guarded]")
    expect(prompt).toContain("State a falsifiable repair hypothesis from the latest diagnostic before editing.")
    expect(prompt).toContain("1. Rerun failing command: bun test packages/core/tests/runebook.test.ts")
  })

  test("derives a Faultline breakpoint card after repeated failed repairs", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Escalate repeated runebook diagnostics",
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
        summary: "Changed runebook",
        payload: { filePath: "packages/core/src/runebook.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    for (const index of [1, 2, 3]) {
      runtime.addTaskEvidence({
        missionId: "mission_alpha",
        evidence: {
          id: `evidence_diagnostic_${index}`,
          taskId: "task_alpha",
          type: "diagnostic",
          summary: `Runebook tests failed attempt ${index}`,
          payload: { command: `bun test packages/core/tests/runebook.test.ts --attempt=${index}`, exitCode: 1 },
          createdAt: `2026-05-27T00:0${index + 1}:00.000Z`,
        },
      })
    }

    const runebook = deriveRunebook(runtime.snapshot(), {
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: { test: "bun test" },
      },
    })
    const prompt = buildRunebookPrompt(runtime.snapshot(), {
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: { test: "bun test" },
      },
    })

    expect(runebook.activeCard).toMatchObject({
      id: "faultline-breakpoint",
      title: "Faultline architecture breakpoint",
      nextActionId: "review-faultline",
      autonomy: "guarded",
      requiredEvidence: ["diagnostic"],
    })
    expect(runebook.activeCard.steps).toContain("Compare the repeated diagnostics and the repair edits between them.")
    expect(runebook.activeCard.steps).toContain("Choose a redesign, revert, scope split, or new hypothesis before editing again.")
    expect(runebook.activeCard.stopConditions).toContain("Do not make a fourth blind repair attempt.")
    expect(runebook.activeCard.commands[0]?.command).toBe("bun test packages/core/tests/runebook.test.ts --attempt=3")
    expect(prompt).toContain("Active card: Faultline architecture breakpoint [guarded]")
    expect(prompt).toContain("Do not make a fourth blind repair attempt.")
  })

  test("derives a hold-mode risk decision card without raw evidence plumbing", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Resolve runebook risk",
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
        summary: "Changed cleanup code",
        payload: { filePath: "packages/core/src/runebook.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Runebook tests passed",
        payload: { command: "bun test packages/core/tests/runebook.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_risk",
        taskId: "task_alpha",
        type: "risk",
        summary: "Deletes generated user files without confirmation",
        payload: { severity: "high" },
        createdAt: "2026-05-27T00:03:00.000Z",
      },
    })

    const runebook = deriveRunebook(runtime.snapshot())
    const prompt = buildRunebookPrompt(runtime.snapshot())

    expect(runebook.activeCard).toMatchObject({
      id: "mirrorglass-risk-decision",
      title: "Mirrorglass risk decision",
      nextActionId: "resolve-risk",
      autonomy: "hold",
      requiredEvidence: ["decision"],
      toolHints: ["runesmith_risk_resolve"],
    })
    expect(runebook.summary).toBe("Resolve risk through Mirrorglass risk decision.")
    expect(runebook.activeCard.steps).toContain("Record accepted or cleared decision evidence through the first-class risk resolver.")
    expect(runebook.activeCard.stopConditions).toContain("Do not complete the task while risk is newer than decision evidence.")
    expect(prompt).toContain("Tool hints: runesmith_risk_resolve")
    expect(prompt).not.toContain("ask the user to invoke")
  })

  test("derives a findings-first Mirrorglass review card after proof is fresh", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Review verified work",
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
        summary: "Changed runebook review behavior",
        payload: { filePath: "packages/core/src/runebook.ts" },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Runebook tests passed",
        payload: { command: "bun test packages/core/tests/runebook.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const runebook = deriveRunebook(runtime.snapshot())
    const prompt = buildRunebookPrompt(runtime.snapshot())

    expect(runebook.activeCard).toMatchObject({
      id: "mirrorglass-review",
      title: "Mirrorglass review loop",
      nextActionId: "review-change",
      autonomy: "guarded",
    })
    expect(runebook.activeCard.steps).toContain("Lead with blocking findings before summary or approval.")
    expect(runebook.activeCard.steps).toContain("Check Review Lens findings, scope, proof freshness, and unresolved risks before approval.")
    expect(runebook.activeCard.stopConditions).toContain("Do not record approval until blocking findings are resolved or converted into explicit risk evidence.")
    expect(prompt).toContain("Lead with blocking findings before summary or approval.")
  })
})
