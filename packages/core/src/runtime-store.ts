import { runtimeError } from "./errors"
import { err, ok, type Clock, type Result } from "./types"
import type { RuntimeSnapshot } from "./runtime"

export const defaultRuntimeCapsulePath = ".runesmith/runtime/capsule.json"
export const defaultProjectConfigPath = ".runesmith/config.json"

export type ProjectConfig = {
  version: 1
  runtimeDir: string
  defaultStaleAfterMs: number
}

export type RuntimeCapsule = {
  version: 1
  updatedAt: string
  runtime: RuntimeSnapshot
}

export type RuntimeStoreHost = {
  exists(path: string): boolean | Promise<boolean>
  readText(path: string): string | Promise<string>
  writeText(path: string, text: string): void | Promise<void>
}

export type SaveRuntimeCapsuleInput = {
  path: string
  snapshot: RuntimeSnapshot
  now?: Clock
  lastGoodPath?: string
}

export type RepairRuntimeCapsuleInput = SaveRuntimeCapsuleInput & {
  backupPath?: string
}

export type RepairRuntimeCapsuleValue = {
  status: "ok" | "repaired"
  capsule: RuntimeCapsule
  backupPath?: string
  lastGoodPath?: string
}

export type RepairProjectConfigInput = {
  path?: string
  config?: ProjectConfig
  backupPath?: string
}

export type RepairProjectConfigValue = {
  status: "ok" | "repaired"
  config: ProjectConfig
  backupPath?: string
}

export const defaultProjectConfig: ProjectConfig = {
  version: 1,
  runtimeDir: ".runesmith/runtime",
  defaultStaleAfterMs: 120_000,
}

export function runtimeCapsulePathFromConfig(config: ProjectConfig = defaultProjectConfig): string {
  const runtimeDir = normalizeRuntimeDir(config.runtimeDir) || normalizeRuntimeDir(defaultProjectConfig.runtimeDir)

  return `${runtimeDir}/capsule.json`
}

export async function loadProjectConfig(
  host: RuntimeStoreHost,
  path = defaultProjectConfigPath,
): Promise<Result<ProjectConfig | undefined>> {
  if (!(await host.exists(path))) {
    return ok(undefined)
  }

  const raw = await host.readText(path)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return err(runtimeError("SNAPSHOT_INVALID", "Project config is not valid JSON", { path }))
  }

  if (!isProjectConfig(parsed)) {
    return err(runtimeError("SNAPSHOT_INVALID", "Project config is missing required records", { path }))
  }

  return ok(parsed)
}

export async function repairProjectConfig(
  host: RuntimeStoreHost,
  input: RepairProjectConfigInput = {},
): Promise<Result<RepairProjectConfigValue>> {
  const path = input.path ?? defaultProjectConfigPath
  const config = input.config ?? defaultProjectConfig
  const loaded = await loadProjectConfig(host, path)
  if (loaded.ok && loaded.value) {
    return ok({
      status: "ok",
      config: loaded.value,
    })
  }

  let backupPath: string | undefined
  if (!loaded.ok && await host.exists(path)) {
    backupPath = input.backupPath ?? `${path}.runesmith.bak`
    await host.writeText(backupPath, await host.readText(path))
  }

  await saveProjectConfig(host, { path, config })

  return ok({
    status: "repaired",
    config,
    backupPath,
  })
}

export type SaveProjectConfigInput = {
  path?: string
  config?: ProjectConfig
}

export async function saveProjectConfig(
  host: RuntimeStoreHost,
  input: SaveProjectConfigInput = {},
): Promise<ProjectConfig> {
  const config = input.config ?? defaultProjectConfig

  await host.writeText(input.path ?? defaultProjectConfigPath, `${JSON.stringify(config, null, 2)}\n`)
  return config
}

export async function loadRuntimeCapsule(
  host: RuntimeStoreHost,
  path = defaultRuntimeCapsulePath,
): Promise<Result<RuntimeCapsule | undefined>> {
  if (!(await host.exists(path))) {
    return ok(undefined)
  }

  const raw = await host.readText(path)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return err(runtimeError("SNAPSHOT_INVALID", "Runtime capsule is not valid JSON", { path }))
  }

  if (!isRuntimeCapsule(parsed)) {
    return err(runtimeError("SNAPSHOT_INVALID", "Runtime capsule is missing required snapshot records", { path }))
  }

  return ok(parsed)
}

export async function repairRuntimeCapsule(
  host: RuntimeStoreHost,
  input: RepairRuntimeCapsuleInput,
): Promise<Result<RepairRuntimeCapsuleValue>> {
  const loaded = await loadRuntimeCapsule(host, input.path)
  if (loaded.ok && loaded.value) {
    return ok({
      status: "ok",
      capsule: loaded.value,
    })
  }

  let backupPath: string | undefined
  if (!loaded.ok && await host.exists(input.path)) {
    backupPath = input.backupPath ?? `${input.path}.runesmith.bak`
    await host.writeText(backupPath, await host.readText(input.path))
  }

  const lastGoodPath = input.lastGoodPath ?? lastGoodRuntimeCapsulePath(input.path)
  const lastGood = await loadRuntimeCapsule(host, lastGoodPath)
  if (lastGood.ok && lastGood.value) {
    await host.writeText(input.path, await host.readText(lastGoodPath))

    return ok({
      status: "repaired",
      capsule: lastGood.value,
      backupPath,
      lastGoodPath,
    })
  }

  const capsule = await saveRuntimeCapsule(host, input)

  return ok({
    status: "repaired",
    capsule,
    backupPath,
  })
}

export async function saveRuntimeCapsule(
  host: RuntimeStoreHost,
  input: SaveRuntimeCapsuleInput,
): Promise<RuntimeCapsule> {
  const capsule: RuntimeCapsule = {
    version: 1,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    runtime: input.snapshot,
  }

  await preserveLastGoodRuntimeCapsule(host, input.path, input.lastGoodPath)
  await host.writeText(input.path, `${JSON.stringify(capsule, null, 2)}\n`)
  return capsule
}

async function preserveLastGoodRuntimeCapsule(
  host: RuntimeStoreHost,
  path: string,
  lastGoodPath = lastGoodRuntimeCapsulePath(path),
): Promise<void> {
  if (!(await host.exists(path))) return

  const loaded = await loadRuntimeCapsule(host, path)
  if (!loaded.ok || !loaded.value) return

  await host.writeText(lastGoodPath, await host.readText(path))
}

function lastGoodRuntimeCapsulePath(path: string): string {
  return `${path}.runesmith.prev`
}

function isRuntimeCapsule(value: unknown): value is RuntimeCapsule {
  if (!value || typeof value !== "object") return false
  const capsule = value as Partial<RuntimeCapsule>
  if (capsule.version !== 1 || typeof capsule.updatedAt !== "string") return false
  const runtime = capsule.runtime as Partial<RuntimeSnapshot> | undefined
  if (!runtime || typeof runtime !== "object") return false

  return (
    isRecord(runtime.graphs)
    && isRecord(runtime.ledgers)
    && isLeaseBook(runtime.leases)
    && isRecord(runtime.contracts)
  )
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const config = value as Partial<ProjectConfig>

  return config.version === 1
    && typeof config.runtimeDir === "string"
    && typeof config.defaultStaleAfterMs === "number"
}

function normalizeRuntimeDir(path: string): string {
  return path.trim().replaceAll("\\", "/").replace(/\/+$/, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isLeaseBook(value: unknown): boolean {
  return isRecord(value) && isRecord((value as { leases?: unknown }).leases)
}
