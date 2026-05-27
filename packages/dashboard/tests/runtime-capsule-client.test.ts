import { describe, expect, test } from "bun:test"

import type { RuntimeCapsule } from "@runesmith/core"
import { loadDashboardRuntimeCapsule, runDashboardRuntimeAction, runtimeCapsuleHasMissions } from "../src/runtime-capsule-client"

const capsule: RuntimeCapsule = {
  version: 1,
  updatedAt: "2026-05-27T00:00:00.000Z",
  runtime: {
    graphs: {},
    ledgers: {},
    leases: { leases: {} },
    contracts: {},
  },
}

describe("runtime capsule client", () => {
  test("loads a runtime capsule from the dashboard API", async () => {
    const loaded = await loadDashboardRuntimeCapsule(async (input) => {
      expect(input).toBe("/api/runtime-capsule")
      return new Response(JSON.stringify(capsule), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    })

    expect(loaded).toEqual(capsule)
  })

  test("returns undefined when the dashboard API has no capsule", async () => {
    const loaded = await loadDashboardRuntimeCapsule(async () => {
      return new Response(null, { status: 204 })
    })

    expect(loaded).toBeUndefined()
  })

  test("posts dashboard runtime actions and returns the updated capsule", async () => {
    const updated = await runDashboardRuntimeAction({ type: "run-autopilot-cycle" }, async (input, init) => {
      expect(input).toBe("/api/runtime-control")
      expect(init?.method).toBe("POST")
      expect(init?.headers).toEqual({ "content-type": "application/json" })
      expect(init?.body).toBe(JSON.stringify({ type: "run-autopilot-cycle" }))

      return new Response(JSON.stringify({
        ok: true,
        value: {
          action: "run-autopilot-cycle",
          status: "idle",
          snapshot: capsule.runtime,
          capsule,
        },
      }), {
        status: 200,
        headers: {
          "content-type": "application/json",
        },
      })
    })

    expect(updated).toEqual(capsule)
  })

  test("detects whether a runtime capsule can drive visible dashboard state", () => {
    expect(runtimeCapsuleHasMissions(capsule)).toBe(false)
    expect(runtimeCapsuleHasMissions({
      ...capsule,
      runtime: {
        ...capsule.runtime,
        graphs: {
          mission_alpha: {
            mission: {
              id: "mission_alpha",
              goal: "Visible runtime mission",
              status: "running",
              rootTaskId: "task_alpha",
              createdAt: "2026-05-27T00:00:00.000Z",
              updatedAt: "2026-05-27T00:00:00.000Z",
            },
            tasks: {},
            events: [],
          },
        },
      },
    })).toBe(true)
  })
})
