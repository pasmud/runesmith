import { describe, expect, test } from "bun:test"

import type { RuntimeStoreHost } from "@runesmith/core"
import { resolveRuntimeCapsulePath } from "../vite.config"

function createMemoryHost(initialFiles: Record<string, string> = {}): RuntimeStoreHost {
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
})
