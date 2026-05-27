import { describe, expect, test } from "bun:test"

import { createRuntime } from "../src/runtime"
import { loadRuntimeCapsule, repairRuntimeCapsule, saveRuntimeCapsule, type RuntimeStoreHost } from "../src/runtime-store"
import type { RuntimeSnapshot } from "../src/runtime"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

function createMemoryHost(initialFiles: Record<string, string> = {}): RuntimeStoreHost & { files: Map<string, string> } {
  const files = new Map(Object.entries(initialFiles))

  return {
    files,
    exists(path) {
      return files.has(path)
    },
    readText(path) {
      const value = files.get(path)
      if (value === undefined) throw new Error(`Missing file: ${path}`)
      return value
    },
    writeText(path, text) {
      files.set(path, text)
    },
  }
}

describe("runtime capsule store", () => {
  test("saves and loads versioned runtime snapshots", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.startMission({ goal: "Durable mission" })
    const host = createMemoryHost()

    await saveRuntimeCapsule(host, {
      path: ".runesmith/runtime/capsule.json",
      snapshot: runtime.snapshot(),
      now: fixedNow,
    })

    const loaded = await loadRuntimeCapsule(host, ".runesmith/runtime/capsule.json")

    expect(loaded.ok).toBe(true)
    if (!loaded.ok) throw new Error("capsule load failed")
    expect(loaded.value?.version).toBe(1)
    expect(loaded.value?.updatedAt).toBe("2026-05-27T00:00:00.000Z")
    expect(Object.keys(loaded.value?.runtime.graphs ?? {})).toEqual(["mission_alpha"])
  })

  test("returns no snapshot when the default capsule does not exist", async () => {
    const loaded = await loadRuntimeCapsule(createMemoryHost(), ".runesmith/runtime/capsule.json")

    expect(loaded).toEqual({
      ok: true,
      value: undefined,
    })
  })

  test("rejects invalid capsule JSON with a snapshot error", async () => {
    const loaded = await loadRuntimeCapsule(createMemoryHost({
      ".runesmith/runtime/capsule.json": "{ not json",
    }), ".runesmith/runtime/capsule.json")

    expect(loaded).toEqual({
      ok: false,
      error: {
        code: "SNAPSHOT_INVALID",
        message: "Runtime capsule is not valid JSON",
        details: {
          path: ".runesmith/runtime/capsule.json",
        },
      },
    })
  })

  test("rejects capsules without runtime snapshot records", async () => {
    const loaded = await loadRuntimeCapsule(createMemoryHost({
      ".runesmith/runtime/capsule.json": JSON.stringify({ version: 1, updatedAt: "now", runtime: {} }),
    }), ".runesmith/runtime/capsule.json")

    expect(loaded.ok).toBe(false)
  })

  test("backs up an invalid capsule and writes a fresh runtime snapshot", async () => {
    const host = createMemoryHost({
      ".runesmith/runtime/capsule.json": "{ broken",
    })

    const repaired = await repairRuntimeCapsule(host, {
      path: ".runesmith/runtime/capsule.json",
      snapshot: {
        graphs: {},
        ledgers: {},
        leases: { leases: {} },
        contracts: {},
      },
      now: fixedNow,
    })

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) throw new Error(repaired.error.message)
    expect(repaired.value.status).toBe("repaired")
    expect(repaired.value.backupPath).toBe(".runesmith/runtime/capsule.json.runesmith.bak")
    expect(host.files.get(".runesmith/runtime/capsule.json.runesmith.bak")).toBe("{ broken")
    expect(repaired.value.capsule.runtime.graphs).toEqual({})
    expect(repaired.value.capsule.updatedAt).toBe("2026-05-27T00:00:00.000Z")
  })
})
