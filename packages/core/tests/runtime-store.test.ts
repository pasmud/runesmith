import { describe, expect, test } from "bun:test"

import { createRuntime } from "../src/runtime"
import {
  defaultProjectConfig,
  defaultProjectConfigPath,
  defaultRuntimeCapsulePath,
  loadProjectConfig,
  loadRuntimeCapsule,
  repairProjectConfig,
  repairRuntimeCapsule,
  runtimeCapsulePathFromConfig,
  saveRuntimeCapsule,
  type RuntimeStoreHost,
} from "../src/runtime-store"
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
  test("derives the runtime capsule path from project config", () => {
    expect(runtimeCapsulePathFromConfig(defaultProjectConfig)).toBe(defaultRuntimeCapsulePath)
    expect(runtimeCapsulePathFromConfig({
      ...defaultProjectConfig,
      runtimeDir: ".runesmith/custom-runtime",
    })).toBe(".runesmith/custom-runtime/capsule.json")
    expect(runtimeCapsulePathFromConfig({
      ...defaultProjectConfig,
      runtimeDir: ".runesmith/custom-runtime/",
    })).toBe(".runesmith/custom-runtime/capsule.json")
    expect(runtimeCapsulePathFromConfig({
      ...defaultProjectConfig,
      runtimeDir: ".runesmith\\custom-runtime\\",
    })).toBe(".runesmith/custom-runtime/capsule.json")
  })

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

  test("keeps the previous valid runtime capsule as last-good before overwriting", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.startMission({ goal: "Durable mission" })
    const host = createMemoryHost()

    await saveRuntimeCapsule(host, {
      path: ".runesmith/runtime/capsule.json",
      snapshot: runtime.snapshot(),
      now: fixedNow,
    })
    const secondRuntime = createRuntime({
      idFactory: (prefix) => `${prefix}_beta`,
      now: fixedNow,
    })
    secondRuntime.startMission({ goal: "Second mission" })
    await saveRuntimeCapsule(host, {
      path: ".runesmith/runtime/capsule.json",
      snapshot: secondRuntime.snapshot(),
      now: () => new Date("2026-05-27T00:01:00.000Z"),
    })

    const lastGood = await loadRuntimeCapsule(host, ".runesmith/runtime/capsule.json.runesmith.prev")
    const current = await loadRuntimeCapsule(host, ".runesmith/runtime/capsule.json")

    expect(lastGood.ok).toBe(true)
    expect(current.ok).toBe(true)
    if (!lastGood.ok || !current.ok) throw new Error("capsule load failed")
    expect(Object.keys(lastGood.value?.runtime.graphs ?? {})).toEqual(["mission_alpha"])
    expect(Object.keys(current.value?.runtime.graphs ?? {})).toEqual(["mission_beta"])
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

  test("repairs an invalid runtime capsule from the last-good capsule when available", async () => {
    const lastGoodRuntime = createRuntime({ idFactory: ids, now: fixedNow })
    lastGoodRuntime.startMission({ goal: "Recover preserved mission" })
    const lastGoodCapsule = {
      version: 1,
      updatedAt: "2026-05-27T00:00:00.000Z",
      runtime: lastGoodRuntime.snapshot(),
    }
    const host = createMemoryHost({
      ".runesmith/runtime/capsule.json": "{ broken",
      ".runesmith/runtime/capsule.json.runesmith.prev": `${JSON.stringify(lastGoodCapsule, null, 2)}\n`,
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
    expect(Object.keys(repaired.value.capsule.runtime.graphs)).toEqual(["mission_alpha"])
    expect(host.files.get(".runesmith/runtime/capsule.json")).toBe(host.files.get(".runesmith/runtime/capsule.json.runesmith.prev"))
  })

  test("repairs missing and invalid project config files", async () => {
    const missingHost = createMemoryHost()
    const created = await repairProjectConfig(missingHost, {
      path: defaultProjectConfigPath,
    })

    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.error.message)
    expect(created.value.status).toBe("repaired")
    expect(created.value.config).toEqual({
      version: 1,
      runtimeDir: ".runesmith/runtime",
      defaultStaleAfterMs: 120_000,
    })

    const invalidHost = createMemoryHost({
      [defaultProjectConfigPath]: "{bad config",
    })
    const repaired = await repairProjectConfig(invalidHost, {
      path: defaultProjectConfigPath,
    })
    const loaded = await loadProjectConfig(invalidHost, defaultProjectConfigPath)

    expect(repaired.ok).toBe(true)
    if (!repaired.ok) throw new Error(repaired.error.message)
    expect(repaired.value.status).toBe("repaired")
    expect(repaired.value.backupPath).toBe(`${defaultProjectConfigPath}.runesmith.bak`)
    expect(invalidHost.files.get(`${defaultProjectConfigPath}.runesmith.bak`)).toBe("{bad config")
    expect(loaded.ok).toBe(true)
    if (!loaded.ok || !loaded.value) throw new Error("expected repaired project config")
    expect(loaded.value.runtimeDir).toBe(".runesmith/runtime")
  })
})
