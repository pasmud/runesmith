import { describe, expect, test } from "bun:test"

import type { RuntimeCapsule } from "@runesmith/core"
import {
  buildDashboardModel,
  buildDashboardModelFromRuntimeCapsule,
  reduceDashboardModel,
} from "../src/dashboard-model"

const capsule: RuntimeCapsule = {
  version: 1,
  updatedAt: "2026-05-27T00:00:00.000Z",
  runtime: {
    graphs: {
      mission_live: {
        mission: {
          id: "mission_live",
          goal: "Ship live dashboard",
          status: "running",
          rootTaskId: "task_live",
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:05:00.000Z",
        },
        tasks: {
          task_live: {
            id: "task_live",
            missionId: "mission_live",
            title: "Wire capsule feed",
            description: "Render persisted OpenCode mission state in the dashboard.",
            status: "running",
            requiredCapabilities: ["typescript"],
            assignedAgentId: "agent_atlas",
            createdAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:05:00.000Z",
          },
          task_review: {
            id: "task_review",
            missionId: "mission_live",
            title: "Review dashboard adapter",
            description: "Check capsule mapping and UI behavior.",
            status: "complete",
            requiredCapabilities: ["testing"],
            assignedAgentId: "agent_oracle",
            createdAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:05:00.000Z",
          },
        },
        events: [
          {
            id: "event_live",
            type: "task.claimed",
            at: "2026-05-27T00:05:00.000Z",
            targetId: "task_live",
            message: "Atlas claimed the capsule adapter task",
          },
        ],
      },
    },
    ledgers: {
      mission_live: {
        evidence: {
          evidence_file: {
            id: "evidence_file",
            taskId: "task_live",
            type: "file-change",
            summary: "Added capsule adapter",
            payload: {},
            createdAt: "2026-05-27T00:04:00.000Z",
          },
          evidence_test: {
            id: "evidence_test",
            taskId: "task_review",
            type: "test-result",
            summary: "Dashboard tests passed",
            payload: {},
            createdAt: "2026-05-27T00:05:00.000Z",
          },
        },
      },
    },
    leases: {
      leases: {
        lease_live: {
          id: "lease_live",
          targetId: "task_live",
          holder: "atlas",
          purpose: "task.claim",
          idempotencyKey: "claim-live",
          expiresAt: "2026-05-27T00:10:00.000Z",
          status: "active",
          createdAt: "2026-05-27T00:05:00.000Z",
        },
      },
    },
    contracts: {
      agent_atlas: {
        id: "agent_atlas",
        displayName: "Atlas",
        description: "Runtime implementer",
        capabilities: ["typescript"],
        allowedTools: ["read", "edit", "test"],
        modelPolicy: {
          primary: "gpt-5.1-codex",
          fallbacks: ["claude-sonnet"],
        },
        fileScope: ["packages/dashboard/**"],
        completionCriteria: ["Adapter renders capsule tasks"],
        requiredEvidence: ["file-change", "test-result"],
        fallbacks: ["agent_oracle"],
      },
      agent_oracle: {
        id: "agent_oracle",
        displayName: "Oracle",
        description: "Verification agent",
        capabilities: ["testing"],
        allowedTools: ["read", "test"],
        modelPolicy: {
          primary: "gpt-5.1-codex",
          fallbacks: [],
        },
        fileScope: ["packages/dashboard/**"],
        completionCriteria: ["Tests passed"],
        requiredEvidence: ["test-result"],
        fallbacks: [],
      },
    },
  },
}

describe("dashboard model", () => {
  test("derives mission counts from seeded mission tasks", () => {
    const model = buildDashboardModel()

    expect(model.metrics).toEqual({
      running: 2,
      verified: 2,
      stale: 1,
      blocked: 1,
    })
    expect(model.selectedTask.id).toBe("task_runtime_kernel")
    expect(model.timeline.at(0)?.label).toBe("Lease granted")
  })

  test("selects a mission task for inspection", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "select-task",
      taskId: "task_windows_paths",
    })

    expect(next.selectedTask.id).toBe("task_windows_paths")
    expect(next.selectedTaskId).toBe("task_windows_paths")
    expect(next.notice).toBe("Inspecting Windows path resolver.")
  })

  test("verifies the selected task and records evidence", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "verify-selected" })

    expect(next.selectedTask.status).toBe("verified")
    expect(next.selectedTask.lane).toBe("Verify")
    expect(next.selectedTask.evidence).toContain("test-result")
    expect(next.metrics).toEqual({
      running: 1,
      verified: 3,
      stale: 1,
      blocked: 1,
    })
    expect(next.timeline.at(0)?.label).toBe("Verification complete")
  })

  test("recovers stale work and updates the board metrics", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "recover-stale" })

    expect(next.tasks.find((task) => task.id === "task_windows_paths")?.status).toBe("running")
    expect(next.tasks.find((task) => task.id === "task_windows_paths")?.lane).toBe("Build")
    expect(next.metrics).toEqual({
      running: 3,
      verified: 2,
      stale: 0,
      blocked: 1,
    })
    expect(next.timeline.at(0)?.label).toBe("Recovery dispatched")
  })

  test("switches dashboard sections", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "select-view",
      view: "covenant",
    })

    expect(next.activeView).toBe("covenant")
    expect(next.notice).toBe("Showing Runic Covenant autonomous workflow.")
  })

  test("runs an autopilot cycle that recovers stale work before verification", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "run-autopilot-cycle" })

    expect(next.tasks.find((task) => task.id === "task_windows_paths")?.status).toBe("running")
    expect(next.metrics.stale).toBe(0)
    expect(next.timeline.at(0)?.label).toBe("Autopilot recovered")
    expect(next.commandLog.at(0)?.label).toBe("Recovered stale lease")
    expect(next.operationalScore).toBeGreaterThan(model.operationalScore)
  })

  test("forges a mission directive into a selected plan task", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "forge-directive",
      prompt: "Wire OpenCode session replay",
    })

    expect(next.selectedTask.title).toBe("Wire OpenCode session replay")
    expect(next.selectedTask.lane).toBe("Plan")
    expect(next.selectedTask.status).toBe("running")
    expect(next.tasks).toHaveLength(model.tasks.length + 1)
    expect(next.timeline.at(0)?.label).toBe("Directive forged")
  })

  test("toggles policy gates and records the command", () => {
    const model = buildDashboardModel()
    const policy = model.policies.find((item) => item.id === "policy_tool_scope")!

    const next = reduceDashboardModel(model, {
      type: "toggle-policy",
      policyId: policy.id,
    })

    expect(next.policies.find((item) => item.id === policy.id)?.enabled).toBe(false)
    expect(next.commandLog.at(0)?.label).toBe("Policy disabled")
    expect(next.notice).toBe("Disabled Tool scope firewall.")
  })

  test("creates a mission snapshot with current counts", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "create-snapshot" })

    expect(next.snapshots).toHaveLength(model.snapshots.length + 1)
    expect(next.snapshots.at(0)?.label).toBe("Manual checkpoint")
    expect(next.snapshots.at(0)?.tasks).toBe(model.tasks.length)
    expect(next.timeline.at(0)?.label).toBe("Snapshot sealed")
  })

  test("selects an agent and focuses the agent mesh", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "select-agent",
      agentId: "agent_scout",
    })

    expect(next.activeView).toBe("agents")
    expect(next.selectedAgentId).toBe("agent_scout")
    expect(next.notice).toBe("Focused Scout in the agent mesh.")
  })

  test("marks command notifications as read", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "mark-notifications-read" })

    expect(next.commandLog).toHaveLength(0)
    expect(next.notice).toBe("Marked command notifications read.")
  })

  test("advances the covenant loop and records the next autonomous stage", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "advance-covenant-stage" })

    expect(next.activeView).toBe("covenant")
    expect(next.activeCovenantStage.id).toBe("map")
    expect(next.commandLog.at(0)?.label).toBe("Covenant advanced")
    expect(next.notice).toBe("Runic Covenant advanced to Mission Map.")
  })

  test("builds dashboard state from a persisted runtime capsule", () => {
    const model = buildDashboardModelFromRuntimeCapsule(capsule)

    expect(model.tasks.map((task) => task.id)).toEqual(["task_live", "task_review"])
    expect(model.selectedTask.title).toBe("Wire capsule feed")
    expect(model.selectedTask.evidence).toEqual(["file-change"])
    expect(model.metrics).toEqual({
      running: 1,
      verified: 1,
      stale: 0,
      blocked: 0,
    })
    expect(model.agents.map((agent) => agent.name)).toEqual(["Atlas", "Oracle"])
    expect(model.agents[0]?.activeLease).toBe("task_live")
    expect(model.snapshots[0]?.label).toBe("Live capsule")
    expect(model.loopPulse.nextAction.label).toBe("Capture proof")
    expect(model.loopPulse.runes.map((rune) => rune.name)).toContain("Proofwright")
    expect(model.notice).toBe("Loaded runtime capsule from 2026-05-27T00:00:00.000Z.")
  })

  test("places runtime tasks with failed verification into the repair lane", () => {
    const repairCapsule: RuntimeCapsule = {
      ...capsule,
      runtime: {
        ...capsule.runtime,
        ledgers: {
          mission_live: {
            evidence: {
              ...capsule.runtime.ledgers.mission_live.evidence,
              evidence_diagnostic: {
                id: "evidence_diagnostic",
                taskId: "task_live",
                type: "diagnostic",
                summary: "Dashboard capsule tests failed",
                payload: { command: "bun test packages/dashboard/tests", exitCode: 1 },
                createdAt: "2026-05-27T00:06:00.000Z",
              },
            },
          },
        },
      },
    }

    const model = buildDashboardModelFromRuntimeCapsule(repairCapsule)

    expect(model.selectedTask.id).toBe("task_live")
    expect(model.selectedTask.lane).toBe("Repair")
    expect(model.selectedTask.evidence).toContain("diagnostic")
    expect(model.loopPulse.stage.id).toBe("repair")
    expect(model.loopPulse.nextAction.label).toBe("Repair diagnostic")
    expect(model.loopPulse.diagnostics).toEqual(["Dashboard capsule tests failed"])
    expect(model.loopPulse.runes.map((rune) => rune.name)).toContain("Faultwright")
  })

  test("hydrates the dashboard from a runtime capsule action", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "load-runtime-capsule",
      capsule,
    })

    expect(next.tasks).toHaveLength(2)
    expect(next.selectedTask.id).toBe("task_live")
    expect(next.commandLog.at(0)?.label).toBe("Capsule loaded")
    expect(next.timeline.at(0)?.detail).toContain("Ship live dashboard")
  })

  test("keeps seeded dashboard state when no runtime capsule is available", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "runtime-capsule-unavailable" })

    expect(next.tasks).toHaveLength(model.tasks.length)
    expect(next.selectedTask.id).toBe(model.selectedTask.id)
    expect(next.notice).toBe("No runtime capsule found; showing seeded mission control.")
  })
})
