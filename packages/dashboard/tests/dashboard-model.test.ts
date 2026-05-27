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
})
