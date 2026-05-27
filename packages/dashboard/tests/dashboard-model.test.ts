import { describe, expect, test } from "bun:test"

import { buildDashboardModel } from "../src/dashboard-model"

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
})
