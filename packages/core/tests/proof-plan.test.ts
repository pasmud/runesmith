import { describe, expect, test } from "bun:test"

import {
  buildProofPlanPrompt,
  createRuntime,
  deriveProofPlan,
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

const scripts = {
  build: "bun run build:packages && bun run --cwd packages/dashboard build",
  test: "bun test",
  typecheck: "tsc -b packages/core packages/opencode-adapter packages/cli packages/testbench packages/dashboard",
}

const scriptsWithLint = {
  ...scripts,
  lint: "eslint .",
}

describe("proof plan", () => {
  test("stays idle when no mission exists", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })
    const prompt = buildProofPlanPrompt(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })

    expect(plan).toMatchObject({
      status: "idle",
      commands: [],
      handoff: "No proof run is needed until a mission has active work.",
    })
    expect(prompt).toContain("## Runesmith Proof Plan")
    expect(prompt).toContain("Status: idle")
  })

  test("builds a full proof recipe when implementation proof is missing", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Prove automatic runbook",
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
        summary: "Changed proof planner",
        payload: { files: ["packages/core/src/proof-plan.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })

    expect(plan).toMatchObject({
      status: "needs-proof",
      missionId: "mission_alpha",
      taskId: "task_alpha",
      missingEvidence: ["test-result"],
      handoff: "Run proof for task_alpha: bun run typecheck -> bun test -> bun run build.",
    })
    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
    expect(plan.commands.map((command) => command.kind)).toEqual(["typecheck", "test", "build"])
    expect(plan.commands.every((command) => command.evidenceType === "test-result")).toBe(true)
  })

  test("starts missing proof with impacted tests from changed test files", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Run impacted proof before broad verification",
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
        summary: "Changed proof planner tests",
        payload: { files: ["packages/core/tests/proof-plan.test.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })
    const prompt = buildProofPlanPrompt(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })

    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun test packages/core/tests/proof-plan.test.ts",
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
    expect(plan.commands[0]).toMatchObject({
      kind: "impact-test",
      label: "Run impacted test",
      reason: "Run the nearest proof target for changed file packages/core/tests/proof-plan.test.ts before broad verification.",
      evidenceType: "test-result",
    })
    expect(plan.handoff).toBe("Run proof for task_alpha: bun test packages/core/tests/proof-plan.test.ts -> bun run typecheck -> bun test -> bun run build.")
    expect(prompt).toContain("1. Run impacted test: bun test packages/core/tests/proof-plan.test.ts")
  })

  test("maps changed source files to repository-known impacted tests", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Map source change to impacted proof",
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
        summary: "Changed proof planner source",
        payload: { filePath: "packages/core/src/proof-plan.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const plan = deriveProofPlan(runtime.snapshot(), {
      packageManager: "bun@1.3.13",
      scripts,
      repositoryFiles: [
        "packages/core/src/proof-plan.ts",
        "packages/core/tests/proof-plan.test.ts",
      ],
    })

    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun test packages/core/tests/proof-plan.test.ts",
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
    expect(plan.commands[0]).toMatchObject({
      kind: "impact-test",
      label: "Run impacted test",
      reason: "Run the nearest proof target for changed file packages/core/src/proof-plan.ts before broad verification.",
    })
  })

  test("includes lint when the repository exposes a lint proof script", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Prove lint inside the proof ladder",
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
        summary: "Changed proof planner",
        payload: { files: ["packages/core/src/proof-plan.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts: scriptsWithLint })

    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun run typecheck",
      "bun run lint",
      "bun test",
      "bun run build",
    ])
    expect(plan.commands.map((command) => command.kind)).toEqual(["typecheck", "lint", "test", "build"])
    expect(plan.handoff).toBe("Run proof for task_alpha: bun run typecheck -> bun run lint -> bun test -> bun run build.")
  })

  test("starts with the latest failing command during repair", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Repair automatic runbook",
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
        summary: "Changed proof planner",
        payload: { files: ["packages/core/src/proof-plan.ts"] },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "Core proof planner tests failed",
        payload: { command: "bun test packages/core/tests/proof-plan.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })
    const prompt = buildProofPlanPrompt(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })

    expect(plan.status).toBe("needs-repair")
    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun test packages/core/tests/proof-plan.test.ts",
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
    expect(plan.commands[0]).toMatchObject({
      kind: "rerun-diagnostic",
      label: "Rerun failing command",
      evidenceType: "test-result",
    })
    expect(prompt).toContain("1. Rerun failing command: bun test packages/core/tests/proof-plan.test.ts")
  })

  test("keeps the latest failing command available at a Faultline breakpoint", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Break repeated proof planner repairs",
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
        summary: "Changed proof planner",
        payload: { files: ["packages/core/src/proof-plan.ts"] },
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
          summary: `Proof planner tests failed attempt ${index}`,
          payload: { command: `bun test packages/core/tests/proof-plan.test.ts --attempt=${index}`, exitCode: 1 },
          createdAt: `2026-05-27T00:0${index + 1}:00.000Z`,
        },
      })
    }

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })
    const prompt = buildProofPlanPrompt(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })

    expect(plan.status).toBe("needs-repair")
    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun test packages/core/tests/proof-plan.test.ts --attempt=3",
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
    expect(plan.diagnostics).toEqual([
      "Proof planner tests failed attempt 3",
      "Proof planner tests failed attempt 2",
      "Proof planner tests failed attempt 1",
    ])
    expect(prompt).toContain("Status: needs-repair")
    expect(prompt).toContain("1. Rerun failing command: bun test packages/core/tests/proof-plan.test.ts --attempt=3")
  })

  test("starts with the stale targeted proof command after later edits invalidate passing proof", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Rerun stale targeted proof",
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
        id: "evidence_file_initial",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed proof planner",
        payload: { files: ["packages/core/src/proof-plan.ts"] },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test_targeted",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Proof planner tests passed",
        payload: { command: "bun test packages/core/tests/proof-plan.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file_later",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed proof planner again",
        payload: { files: ["packages/core/src/proof-plan.ts"] },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const plan = deriveProofPlan(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })
    const prompt = buildProofPlanPrompt(runtime.snapshot(), { packageManager: "bun@1.3.13", scripts })

    expect(plan.status).toBe("needs-proof")
    expect(plan.commands.map((command) => command.command)).toEqual([
      "bun test packages/core/tests/proof-plan.test.ts",
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
    expect(plan.commands[0]).toMatchObject({
      kind: "rerun-stale-proof",
      label: "Rerun stale proof",
      evidenceType: "test-result",
    })
    expect(prompt).toContain("1. Rerun stale proof: bun test packages/core/tests/proof-plan.test.ts")
  })
})
