import { describe, expect, test } from "bun:test"

import {
  createCovenantTaskPlan,
  createRunesmithAgentContracts,
  createRuntime,
  deriveDispatchMatrix,
  derivePlanContract,
  runRunebookNext,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const later = () => new Date("2026-05-27T00:04:00.000Z")
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
  test("automatically refines a thin Covenant plan before broad Forge work", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    for (const contract of createRunesmithAgentContracts()) {
      runtime.registerContract(contract)
    }
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

    const result = await runRunebookNext(runtime, {
      contract: atlas,
      holder: "runesmith-test",
      idempotencyScope: "test-next",
      ttlMs: 30_000,
      nextEvidenceId: () => "evidence_plan",
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "plan-refined",
        actionId: "refine-plan",
        card: {
          title: "Pathfinder plan refinery",
        },
        missionId: "mission_alpha",
        taskId: "task_alpha",
        nextStatus: "waiting-for-evidence",
        missingEvidence: ["file-change", "test-result"],
        planRefinement: {
          evidenceId: "evidence_plan",
          rootTaskId: "task_alpha",
          taskCount: 5,
          implementationTaskCount: 2,
          activeSlotCount: 2,
        },
        loopPulse: {
          nextAction: {
            id: "continue-forge",
          },
        },
      },
    })
    if (!result.ok) return

    const snapshot = runtime.snapshot()
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha).toMatchObject({
      title: "Plan: Build install-direct orchestration",
      status: "complete",
      requiredEvidence: ["decision"],
    })
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha_runtime_forge).toMatchObject({
      title: "Forge: orchestration engine path",
      status: "running",
      assignedAgentId: "agent_atlas",
    })
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha_install_forge).toMatchObject({
      title: "Forge: direct install surface",
      status: "running",
      assignedAgentId: "agent_atlas",
    })
    expect(snapshot.ledgers.mission_alpha.evidence.evidence_plan).toMatchObject({
      taskId: "task_alpha",
      type: "decision",
      payload: {
        mode: "runesmith-plan-refinery",
        taskCount: 5,
      },
    })
    expect(derivePlanContract(snapshot)).toMatchObject({
      status: "ready",
      taskCount: 5,
      implementationTaskCount: 2,
    })
    expect(deriveDispatchMatrix(snapshot)).toMatchObject({
      activeSlotCount: 2,
      blockedSlotCount: 2,
    })
  })

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

  test("reports held autonomous decisions when Review Lens blocks approval", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Hold blocked review",
      taskPlan: createCovenantTaskPlan("Hold blocked review"),
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
        summary: "Changed runtime and environment",
        payload: { files: ["packages/core/src/runebook-next.ts", ".env"] },
        createdAt: fixedNow().toISOString(),
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Runebook next tests passed",
        payload: { command: "bun test packages/core/tests/runebook-next.test.ts", exitCode: 0 },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await runRunebookNext(runtime, {
      contract: atlas,
      holder: "runesmith-test",
      idempotencyScope: "test-next",
      ttlMs: 30_000,
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "decision-held",
        actionId: "review-change",
        missionId: "mission_alpha",
        taskId: "task_alpha_review",
        nextStatus: "waiting-for-evidence",
        missingEvidence: ["decision"],
        decisionGuard: {
          stage: "review",
          status: "blocked",
          findings: [".env is outside agent_atlas file scope."],
        },
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_review.status).toBe("running")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha_review",
          type: "decision",
        }),
      ]),
    )
  })

  test("resolves the current Faultline card with a supplied architecture path", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Resolve next Faultline card",
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
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    for (const index of [1, 2, 3]) {
      runtime.addTaskEvidence({
        missionId: "mission_alpha",
        evidence: {
          id: `evidence_diagnostic_${index}`,
          taskId: "task_alpha",
          type: "diagnostic",
          summary: `Runebook next failed attempt ${index}`,
          payload: { command: `bun test packages/core/tests/runebook-next.test.ts --attempt=${index}`, exitCode: 1 },
          createdAt: `2026-05-27T00:0${index}:00.000Z`,
        },
      })
    }

    const result = await runRunebookNext(runtime, {
      contract: atlas,
      holder: "runesmith-test",
      idempotencyScope: "test-next",
      ttlMs: 30_000,
      faultline: {
        summary: "Separate proof execution from loop advancement before the next repair",
        evidenceIdFactory: () => "evidence_faultline",
      },
      now: later,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: "faultline-resolved",
        actionId: "review-faultline",
        card: {
          title: "Faultline architecture breakpoint",
        },
        missionId: "mission_alpha",
        taskId: "task_alpha",
        nextStatus: "waiting-for-evidence",
        missingEvidence: ["test-result"],
        faultlineResolution: {
          evidenceId: "evidence_faultline",
          nextStatus: "waiting-for-evidence",
          diagnostics: [
            "Runebook next failed attempt 1",
            "Runebook next failed attempt 2",
            "Runebook next failed attempt 3",
          ],
        },
        loopPulse: {
          nextAction: {
            id: "repair-diagnostic",
          },
        },
      },
    })
    expect(runtime.snapshot().ledgers.mission_alpha.evidence.evidence_faultline).toMatchObject({
      taskId: "task_alpha",
      type: "decision",
      summary: "Faultline path: Separate proof execution from loop advancement before the next repair",
    })
  })
})
