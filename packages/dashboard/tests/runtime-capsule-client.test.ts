import { describe, expect, test } from "bun:test"

import type { RuntimeCapsule } from "@runesmith/core"
import { loadDashboardRuntimeCapsule } from "../src/runtime-capsule-client"

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
})
