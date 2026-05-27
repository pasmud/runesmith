import { describe, expect, test } from "bun:test"

import { createRuntime, runRunebookNext, type AgentContract } from "../src/index"

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

describe("runebook next action", () => {
  test("executes the current proof card and advances the mission through the shared loop", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Execute next proof card",
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
        summary: "Changed next action",
        payload: { filePath: "packages/core/src/runebook-next.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await runRunebookNext(runtime, {
      contract: atlas,
      holder: "runesmith-test",
      idempotencyScope: "test-next",
      ttlMs: 30_000,
      proofCommandRunner(command) {
        return {
          exitCode: 0,
          stdout: `${command.command} passed`,
          stderr: "",
        }
      },
      nextEvidenceId: () => "evidence_proof",
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "proof-passed",
        actionId: "capture-proof",
        card: {
          title: "Proofwright proof gate",
        },
        proofStatus: "passed",
        nextStatus: "completed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            evidenceId: "evidence_proof",
            evidenceType: "test-result",
          },
        ],
        loopPulse: {
          nextAction: {
            id: "wait-for-goal",
          },
        },
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(runtime.snapshot().ledgers.mission_alpha.evidence.evidence_proof).toMatchObject({
      taskId: "task_alpha",
      type: "test-result",
      summary: "Run tests passed: bun test",
    })
  })
})
