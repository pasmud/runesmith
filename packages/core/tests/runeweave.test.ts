import { describe, expect, test } from "bun:test"

import { createRuntime, runRuneweave, type AgentContract } from "../src/index"

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

describe("runeweave OS loop", () => {
  test("weaves Runebook actions until verified work is sealed", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Run the OS loop to seal proof-ready work",
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
        summary: "Changed Runeweave",
        payload: { filePath: "packages/core/src/runeweave.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await runRuneweave(runtime, {
      contract: atlas,
      holder: "runesmith-test",
      idempotencyScope: "test-runeweave",
      ttlMs: 30_000,
      proofCommandRunner(command) {
        return {
          exitCode: 0,
          stdout: `${command.command} passed`,
          stderr: "",
        }
      },
      nextEvidenceId: () => "evidence_proof",
      maxSteps: 4,
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "sealed",
        stopReason: "No active mission remains after verified work was sealed.",
        stepCount: 1,
        finalActionId: "wait-for-goal",
        finalPulse: {
          nextAction: {
            id: "wait-for-goal",
          },
        },
        commands: [
          {
            command: "bun test",
            evidenceId: "evidence_proof",
            evidenceType: "test-result",
          },
        ],
      },
    })
    if (!result.ok) return

    expect(result.value.steps.map((step) => step.actionId)).toEqual(["capture-proof"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("stops cleanly when the loop reaches implementation work", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Run the OS loop until implementation is needed",
      requiredCapabilities: ["typescript"],
    })

    const result = await runRuneweave(runtime, {
      contract: atlas,
      holder: "runesmith-test",
      idempotencyScope: "test-runeweave",
      ttlMs: 30_000,
      proofCommandRunner() {
        throw new Error("proof should not run before implementation evidence exists")
      },
      maxSteps: 4,
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "needs-work",
        stopReason: "The active Runebook card requires implementation evidence before Runesmith can continue autonomously.",
        stepCount: 1,
        finalActionId: "continue-forge",
      },
    })
    if (!result.ok) return

    expect(result.value.steps.map((step) => step.actionId)).toEqual(["claim-task"])
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
  })
})
