import { describe, expect, test } from "bun:test"

import { createRuntime, type RuntimeSnapshot } from "@runesmith/core"
import { applyDashboardRuntimeAction } from "../src/runtime-control-plane"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
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
    expect(graph.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
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
        taskId: "task_alpha",
      },
    })
    if (!result.ok) return

    expect(result.value.snapshot.graphs.mission_alpha.mission.status).toBe("complete")
    expect(result.value.snapshot.graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
  })
})
