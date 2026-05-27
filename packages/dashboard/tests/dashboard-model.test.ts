import { describe, expect, test } from "bun:test"

import { buildDashboardModel, reduceDashboardModel } from "../src/dashboard-model"

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
      view: "agents",
    })

    expect(next.activeView).toBe("agents")
    expect(next.notice).toBe("Showing agent capacity and leases.")
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
})
