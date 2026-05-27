import { describe, expect, test } from "bun:test"

import { createMissionGraph, transitionTask } from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const fixedIds = (prefix: string) => `${prefix}_alpha`

describe("mission graph", () => {
  test("creates a mission with one queued root task", () => {
    const result = createMissionGraph({
      goal: "Refactor the OpenCode harness",
      idFactory: fixedIds,
      now: fixedNow,
      requiredCapabilities: ["typescript", "testing"],
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({
      mission: {
        id: "mission_alpha",
        goal: "Refactor the OpenCode harness",
        status: "running",
        rootTaskId: "task_alpha",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
      tasks: {
        task_alpha: {
          id: "task_alpha",
          missionId: "mission_alpha",
          title: "Mission root",
          description: "Refactor the OpenCode harness",
          status: "queued",
          requiredCapabilities: ["typescript", "testing"],
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:00:00.000Z",
        },
      },
      events: [
        {
          id: "event_alpha",
          type: "mission.created",
          at: "2026-05-27T00:00:00.000Z",
          targetId: "mission_alpha",
          message: "Mission created",
          data: { rootTaskId: "task_alpha" },
        },
      ],
    })
  })

  test("transitions queued tasks to running", () => {
    const created = createMissionGraph({
      goal: "Add leases",
      idFactory: fixedIds,
      now: fixedNow,
    })
    if (!created.ok) throw new Error("mission creation failed")

    const transitioned = transitionTask(created.value, {
      taskId: "task_alpha",
      nextStatus: "running",
      now: fixedNow,
      reason: "Agent claimed task",
      eventId: "event_claimed",
    })

    expect(transitioned.ok).toBe(true)
    if (!transitioned.ok) return

    expect(transitioned.value.tasks.task_alpha?.status).toBe("running")
    expect(transitioned.value.events.at(-1)).toEqual({
      id: "event_claimed",
      type: "task.transitioned",
      at: "2026-05-27T00:00:00.000Z",
      targetId: "task_alpha",
      message: "Agent claimed task",
      data: {
        from: "queued",
        to: "running",
      },
    })
  })

  test("rejects invalid terminal transitions", () => {
    const created = createMissionGraph({
      goal: "Finish task",
      idFactory: fixedIds,
      now: fixedNow,
    })
    if (!created.ok) throw new Error("mission creation failed")

    const running = transitionTask(created.value, {
      taskId: "task_alpha",
      nextStatus: "running",
      now: fixedNow,
      reason: "Task started",
      eventId: "event_running",
    })
    if (!running.ok) throw new Error("running transition failed")

    const completed = transitionTask(running.value, {
      taskId: "task_alpha",
      nextStatus: "complete",
      now: fixedNow,
      reason: "Task finished",
      eventId: "event_complete",
    })
    if (!completed.ok) throw new Error("completion transition failed")

    const restarted = transitionTask(completed.value, {
      taskId: "task_alpha",
      nextStatus: "running",
      now: fixedNow,
      reason: "Restart completed task",
      eventId: "event_restart",
    })

    expect(restarted).toEqual({
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Cannot transition task from complete to running",
        details: {
          taskId: "task_alpha",
          from: "complete",
          to: "running",
        },
      },
    })
  })
})
