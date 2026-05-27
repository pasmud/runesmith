import { describe, expect, test } from "bun:test"

import { createRuntime, type RuntimeSnapshot } from "@runesmith/core"
import { applyDashboardRuntimeAction } from "../src/runtime-control-plane"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const later = () => new Date("2026-05-27T00:03:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const emptySnapshot: RuntimeSnapshot = {
  graphs: {},
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
}

describe("dashboard runtime control plane", () => {
  test("forges a dashboard directive into a persisted mission and claimed root task", async () => {
    const result = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Build runtime backed dashboard controls",
    }, {
      idFactory: ids,
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "forge-directive",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        status: "running",
      },
    })
    if (!result.ok) return

    const graph = result.value.snapshot.graphs.mission_alpha
    expect(graph.mission.goal).toBe("Build runtime backed dashboard controls")
    expect(Object.keys(graph.tasks)).toEqual(["task_alpha", "task_alpha_review", "task_alpha_seal"])
    expect(graph.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
    expect(graph.tasks.task_alpha_review.dependsOn).toEqual(["task_alpha"])
    expect(result.value.snapshot.contracts.agent_atlas?.displayName).toBe("Atlas")
    expect(result.value.snapshot.leases.leases.lease_alpha?.holder).toBe("runesmith-dashboard")
  })

  test("runs an evidence-gated autopilot cycle against the persisted mission", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Complete from dashboard autopilot",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const hydrated = createRuntime({
      snapshot: forged.value.snapshot,
      idFactory: ids,
      now: fixedNow,
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed dashboard runtime control plane",
        payload: { filePath: "packages/dashboard/src/runtime-control-plane.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Dashboard tests passed",
        payload: { command: "bun test packages/dashboard/tests", exitCode: 0 },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await applyDashboardRuntimeAction(hydrated.snapshot(), {
      type: "run-autopilot-cycle",
    }, {
      idFactory: ids,
      now: fixedNow,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        status: "completed",
        missionId: "mission_alpha",
        taskId: "task_alpha_seal",
      },
    })
    if (!result.ok) return

    const graph = result.value.snapshot.graphs.mission_alpha
    const evidence = Object.values(result.value.snapshot.ledgers.mission_alpha.evidence)
    expect(graph.mission.status).toBe("complete")
    expect(graph.tasks.task_alpha.status).toBe("complete")
    expect(graph.tasks.task_alpha_review.status).toBe("complete")
    expect(graph.tasks.task_alpha_seal.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha_review",
          type: "decision",
          payload: expect.objectContaining({
            stage: "review",
            verdict: "approved",
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha_seal",
          type: "decision",
          payload: expect.objectContaining({
            stage: "seal",
            verdict: "sealed",
          }),
        }),
      ]),
    )
  })

  test("runs the proof plan from dashboard control and advances persisted work", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Run proof from dashboard",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const hydrated = createRuntime({
      snapshot: forged.value.snapshot,
      idFactory: ids,
      now: fixedNow,
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed dashboard proof runner",
        payload: { filePath: "packages/dashboard/src/runtime-control-plane.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await applyDashboardRuntimeAction(hydrated.snapshot(), {
      type: "run-proof-plan",
    }, {
      idFactory: ids,
      now: fixedNow,
      async runProofCommand(command) {
        return {
          exitCode: 0,
          stdout: `${command.command} passed`,
          stderr: "",
        }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "run-proof-plan",
        status: "completed",
        proofStatus: "passed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            exitCode: 0,
            evidenceType: "test-result",
          },
        ],
      },
    })
    if (!result.ok) return

    const graph = result.value.snapshot.graphs.mission_alpha
    const evidence = Object.values(result.value.snapshot.ledgers.mission_alpha.evidence)
    expect(graph.mission.status).toBe("complete")
    expect(graph.tasks.task_alpha.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          summary: "Run tests passed: bun test",
          payload: expect.objectContaining({
            command: "bun test",
            exitCode: 0,
          }),
        }),
      ]),
    )
  })

  test("runs the current Runebook next action from dashboard control", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Run next from dashboard",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const hydrated = createRuntime({
      snapshot: forged.value.snapshot,
      idFactory: ids,
      now: fixedNow,
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed dashboard next control",
        payload: { filePath: "packages/dashboard/src/runtime-control-plane.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await applyDashboardRuntimeAction(hydrated.snapshot(), {
      type: "run-next-action",
    }, {
      idFactory: ids,
      now: fixedNow,
      async runProofCommand(command) {
        return {
          exitCode: 0,
          stdout: `${command.command} passed`,
          stderr: "",
        }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "run-next-action",
        status: "completed",
        proofStatus: "passed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            evidenceType: "test-result",
            exitCode: 0,
          },
        ],
      },
    })
    if (!result.ok) return

    expect(result.value.snapshot.graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("runs the Runeweave OS loop from dashboard control", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Run OS loop from dashboard",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const hydrated = createRuntime({
      snapshot: forged.value.snapshot,
      idFactory: ids,
      now: fixedNow,
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed dashboard OS loop",
        payload: { filePath: "packages/dashboard/src/runtime-control-plane.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const result = await applyDashboardRuntimeAction(hydrated.snapshot(), {
      type: "run-os-loop",
      maxSteps: 4,
    }, {
      idFactory: ids,
      now: fixedNow,
      async runProofCommand(command) {
        return {
          exitCode: 0,
          stdout: `${command.command} passed`,
          stderr: "",
        }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "run-os-loop",
        status: "completed",
        loopStatus: "sealed",
        proofStatus: "passed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            evidenceType: "test-result",
            exitCode: 0,
          },
        ],
      },
    })
    if (!result.ok) return

    expect(result.value.snapshot.graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("resolves an active risk from dashboard control", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Resolve risk from dashboard",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const hydrated = createRuntime({
      snapshot: forged.value.snapshot,
      idFactory: ids,
      now: fixedNow,
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed dashboard runtime control plane",
        payload: { filePath: "packages/dashboard/src/runtime-control-plane.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Dashboard tests passed",
        payload: { command: "bun test packages/dashboard/tests", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_risk",
        taskId: "task_alpha",
        type: "risk",
        summary: "Deletes generated user files without confirmation",
        payload: { severity: "high" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const result = await applyDashboardRuntimeAction(hydrated.snapshot(), {
      type: "resolve-risk",
      verdict: "accepted",
      summary: "Operator accepts generated-file deletion after review",
    }, {
      idFactory: ids,
      now: later,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "resolve-risk",
        status: "completed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        riskResolution: {
          evidenceId: "evidence_alpha",
          verdict: "accepted",
          nextStatus: "completed",
        },
      },
    })
    if (!result.ok) return

    const graph = result.value.snapshot.graphs.mission_alpha
    const evidence = Object.values(result.value.snapshot.ledgers.mission_alpha.evidence)
    expect(graph.mission.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence_alpha",
          taskId: "task_alpha",
          type: "decision",
          summary: "Risk accepted: Operator accepts generated-file deletion after review",
        }),
      ]),
    )
  })

  test("resolves an active Faultline from dashboard control", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Resolve Faultline from dashboard",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const hydrated = createRuntime({
      snapshot: forged.value.snapshot,
      idFactory: ids,
      now: fixedNow,
    })
    hydrated.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed dashboard runtime control plane",
        payload: { filePath: "packages/dashboard/src/runtime-control-plane.ts" },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    for (const index of [1, 2, 3]) {
      hydrated.addTaskEvidence({
        missionId: "mission_alpha",
        evidence: {
          id: `evidence_diagnostic_${index}`,
          taskId: "task_alpha",
          type: "diagnostic",
          summary: `Dashboard tests failed attempt ${index}`,
          payload: { command: `bun test packages/dashboard/tests --attempt=${index}`, exitCode: 1 },
          createdAt: `2026-05-27T00:0${index}:00.000Z`,
        },
      })
    }

    const result = await applyDashboardRuntimeAction(hydrated.snapshot(), {
      type: "resolve-faultline",
      summary: "Split runtime control proof routing before another repair",
    }, {
      idFactory: ids,
      now: later,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "resolve-faultline",
        status: "waiting-for-evidence",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        faultlineResolution: {
          evidenceId: "evidence_alpha",
          nextStatus: "waiting-for-evidence",
          diagnostics: [
            "Dashboard tests failed attempt 1",
            "Dashboard tests failed attempt 2",
            "Dashboard tests failed attempt 3",
          ],
        },
      },
    })
    if (!result.ok) return

    expect(result.value.snapshot.ledgers.mission_alpha.evidence.evidence_alpha).toMatchObject({
      taskId: "task_alpha",
      type: "decision",
      summary: "Faultline path: Split runtime control proof routing before another repair",
    })
  })

  test("records dashboard proof failures as diagnostics without advancing completion", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Repair proof from dashboard",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const result = await applyDashboardRuntimeAction(forged.value.snapshot, {
      type: "run-proof-plan",
    }, {
      idFactory: ids,
      now: fixedNow,
      async runProofCommand(command) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `${command.command} failed`,
        }
      },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "run-proof-plan",
        status: "waiting-for-evidence",
        proofStatus: "failed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            exitCode: 1,
            evidenceType: "diagnostic",
          },
        ],
      },
    })
    if (!result.ok) return

    const graph = result.value.snapshot.graphs.mission_alpha
    const evidence = Object.values(result.value.snapshot.ledgers.mission_alpha.evidence)
    expect(graph.mission.status).toBe("running")
    expect(graph.tasks.task_alpha.status).toBe("running")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "diagnostic",
          summary: "Run tests failed: bun test",
        }),
      ]),
    )
  })

  test("recovers and reclaims stale dashboard work before checking evidence", async () => {
    const forged = await applyDashboardRuntimeAction(emptySnapshot, {
      type: "forge-directive",
      prompt: "Recover from dashboard autopilot",
    }, {
      idFactory: ids,
      now: fixedNow,
    })
    if (!forged.ok) throw new Error("forge failed")

    const result = await applyDashboardRuntimeAction(forged.value.snapshot, {
      type: "run-autopilot-cycle",
    }, {
      idFactory: ids,
      now: later,
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        action: "run-autopilot-cycle",
        status: "recovered",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        nextTaskStatus: "running",
      },
    })
    if (!result.ok) return

    const graph = result.value.snapshot.graphs.mission_alpha
    expect(graph.tasks.task_alpha.status).toBe("running")
    expect(graph.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
    expect(graph.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["task.stale", "task.requeued", "task.transitioned"]),
    )
  })
})
