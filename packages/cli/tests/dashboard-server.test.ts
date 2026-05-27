import { describe, expect, test } from "bun:test"

import { createRuntime, saveRuntimeCapsule, type RuntimeStoreHost } from "@runesmith/core"
import { createDashboardRequestHandler } from "../src/dashboard-server"

function createMemoryHost(initialFiles: Record<string, string> = {}): RuntimeStoreHost & { files: Map<string, string> } {
  const files = new Map(Object.entries(initialFiles))

  return {
    exists(path) {
      return files.has(path)
    },
    readText(path) {
      const value = files.get(path)
      if (value === undefined) throw new Error(`missing file: ${path}`)

      return value
    },
    writeText(path, text) {
      files.set(path, text)
    },
    files,
  }
}

describe("dashboard server", () => {
  test("serves the configured runtime capsule over the dashboard API", async () => {
    const runtime = createRuntime({
      idFactory: (prefix) => `${prefix}_alpha`,
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    runtime.startMission({ goal: "Serve dashboard capsule" })
    const host = createMemoryHost()
    await saveRuntimeCapsule(host, {
      path: ".runesmith/runtime/capsule.json",
      snapshot: runtime.snapshot(),
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    const handler = createDashboardRequestHandler({
      distDir: "packages/dashboard/dist",
      host,
      runtimePath: ".runesmith/runtime/capsule.json",
    })

    const response = await handler(new Request("http://127.0.0.1:4888/api/runtime-capsule"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(Object.keys(body.runtime.graphs)).toEqual(["mission_alpha"])
  })

  test("runs runtime control actions and persists dashboard mutations", async () => {
    const host = createMemoryHost()
    await saveRuntimeCapsule(host, {
      path: ".runesmith/runtime/capsule.json",
      snapshot: {
        graphs: {},
        ledgers: {},
        leases: { leases: {} },
        contracts: {},
      },
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    const handler = createDashboardRequestHandler({
      distDir: "packages/dashboard/dist",
      host,
      idFactory: (prefix) => `${prefix}_server`,
      now: () => new Date("2026-05-27T00:01:00.000Z"),
      runtimePath: ".runesmith/runtime/capsule.json",
    })

    const response = await handler(new Request("http://127.0.0.1:4888/api/runtime-control", {
      body: JSON.stringify({ type: "forge-directive", prompt: "Forge from packaged dashboard" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    }))
    const body = await response.json()
    const saved = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(Object.keys(body.value.capsule.runtime.graphs)).toEqual(["mission_server"])
    expect(saved.runtime.graphs.mission_server.mission.goal).toBe("Forge from packaged dashboard")
  })
})
