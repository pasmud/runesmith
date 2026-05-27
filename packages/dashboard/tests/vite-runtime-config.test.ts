import { describe, expect, test } from "bun:test"

import { createRuntime, type RuntimeStoreHost } from "@runesmith/core"
import { resolveRuntimeCapsulePath, saveDashboardRuntimeCapsule } from "../vite.config"

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

describe("dashboard vite runtime config", () => {
  test("resolves the runtime capsule from project config runtimeDir", async () => {
    const previousEnvPath = process.env.RUNESMITH_RUNTIME_CAPSULE
    delete process.env.RUNESMITH_RUNTIME_CAPSULE
    const host = createMemoryHost({
      ".runesmith/config.json": JSON.stringify({
        version: 1,
        runtimeDir: ".runesmith/dashboard-runtime",
        defaultStaleAfterMs: 120000,
      }),
    })

    try {
      await expect(resolveRuntimeCapsulePath(host)).resolves.toBe(".runesmith/dashboard-runtime/capsule.json")
    } finally {
      if (previousEnvPath === undefined) {
        delete process.env.RUNESMITH_RUNTIME_CAPSULE
      } else {
        process.env.RUNESMITH_RUNTIME_CAPSULE = previousEnvPath
      }
    }
  })

  test("saves dashboard runtime capsules through the shared last-good store", async () => {
    const firstRuntime = createRuntime({
      idFactory: (prefix) => `${prefix}_alpha`,
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    firstRuntime.startMission({ goal: "Preserve dashboard mission" })
    const secondRuntime = createRuntime({
      idFactory: (prefix) => `${prefix}_beta`,
      now: () => new Date("2026-05-27T00:01:00.000Z"),
    })
    secondRuntime.startMission({ goal: "Write dashboard mission" })
    const host = createMemoryHost()
    const path = ".runesmith/runtime/capsule.json"

    await saveDashboardRuntimeCapsule(host, path, firstRuntime.snapshot(), {
      now: () => new Date("2026-05-27T00:00:00.000Z"),
    })
    await saveDashboardRuntimeCapsule(host, path, secondRuntime.snapshot(), {
      now: () => new Date("2026-05-27T00:01:00.000Z"),
    })

    const current = JSON.parse(host.files.get(path) ?? "{}")
    const lastGood = JSON.parse(host.files.get(`${path}.runesmith.prev`) ?? "{}")

    expect(Object.keys(current.runtime.graphs)).toEqual(["mission_beta"])
    expect(Object.keys(lastGood.runtime.graphs)).toEqual(["mission_alpha"])
  })
})
