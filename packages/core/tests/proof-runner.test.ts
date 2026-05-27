import { describe, expect, test } from "bun:test"

import { createRuntime, deriveProofPlan, runProofPlan, type RuntimeSnapshot } from "../src"

const snapshot: RuntimeSnapshot = {
  graphs: {
    mission_alpha: {
      mission: {
        id: "mission_alpha",
        goal: "Build proof runner",
        status: "running",
        rootTaskId: "task_alpha",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
      tasks: {
        task_alpha: {
          id: "task_alpha",
          missionId: "mission_alpha",
          title: "Forge proof runner",
          description: "Build proof runner",
          status: "running",
          requiredCapabilities: ["typescript"],
          requiredEvidence: ["file-change", "test-result"],
          assignedAgentId: "agent_atlas",
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:00:00.000Z",
        },
      },
      events: [],
    },
  },
  ledgers: {
    mission_alpha: {
      evidence: {
        evidence_file: {
          id: "evidence_file",
          taskId: "task_alpha",
          type: "file-change",
          summary: "Changed proof runner",
          payload: { files: ["packages/core/src/proof-runner.ts"] },
          createdAt: "2026-05-27T00:01:00.000Z",
        },
      },
    },
  },
  leases: { leases: {} },
  contracts: {},
}

describe("proof runner", () => {
  test("records passing proof evidence for every planned command", async () => {
    const runtime = createRuntime({ snapshot })
    const plan = deriveProofPlan(snapshot, {
      packageManager: "bun@1.3.13",
      scripts: {
        typecheck: "tsc -b",
        test: "bun test",
        build: "vite build",
      },
    })
    const commands: string[] = []
    let evidenceIndex = 0

    const result = await runProofPlan(runtime, plan, {
      nextEvidenceId: () => `evidence_proof_${++evidenceIndex}`,
      now: () => new Date("2026-05-27T00:02:00.000Z"),
      async runCommand(command) {
        commands.push(command.command)
        return {
          exitCode: 0,
          stdout: `${command.command} ok`,
          stderr: "",
        }
      },
    })

    expect(result).toMatchObject({
      status: "passed",
      missionId: "mission_alpha",
      taskId: "task_alpha",
      commands: [
        { command: "bun run typecheck", evidenceType: "test-result", exitCode: 0 },
        { command: "bun test", evidenceType: "test-result", exitCode: 0 },
        { command: "bun run build", evidenceType: "test-result", exitCode: 0 },
      ],
    })
    expect(commands).toEqual(["bun run typecheck", "bun test", "bun run build"])
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence_proof_1",
          taskId: "task_alpha",
          type: "test-result",
          summary: "Run typecheck passed: bun run typecheck",
          payload: expect.objectContaining({
            command: "bun run typecheck",
            exitCode: 0,
            stdout: "bun run typecheck ok",
          }),
        }),
        expect.objectContaining({
          id: "evidence_proof_3",
          type: "test-result",
          summary: "Run build passed: bun run build",
        }),
      ]),
    )
  })

  test("records the first failing proof command as a diagnostic and stops", async () => {
    const runtime = createRuntime({ snapshot })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "Unit proof failed",
        payload: { command: "bun test packages/core/tests/proof-runner.test.ts", exitCode: 1 },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })
    const plan = deriveProofPlan(runtime.snapshot())
    const commands: string[] = []

    const result = await runProofPlan(runtime, plan, {
      nextEvidenceId: () => "evidence_failed_proof",
      now: () => new Date("2026-05-27T00:03:00.000Z"),
      async runCommand(command) {
        commands.push(command.command)
        return {
          exitCode: 1,
          stdout: "",
          stderr: "1 fail",
        }
      },
    })

    expect(result).toMatchObject({
      status: "failed",
      missionId: "mission_alpha",
      taskId: "task_alpha",
      commands: [
        {
          command: "bun test packages/core/tests/proof-runner.test.ts",
          evidenceType: "diagnostic",
          exitCode: 1,
        },
      ],
    })
    expect(commands).toEqual(["bun test packages/core/tests/proof-runner.test.ts"])
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence_failed_proof",
          taskId: "task_alpha",
          type: "diagnostic",
          summary: "Rerun failing command failed: bun test packages/core/tests/proof-runner.test.ts",
          payload: expect.objectContaining({
            command: "bun test packages/core/tests/proof-runner.test.ts",
            exitCode: 1,
            stderr: "1 fail",
          }),
        }),
      ]),
    )
  })
})
