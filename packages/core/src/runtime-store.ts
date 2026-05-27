import { runtimeError } from "./errors"
import { err, ok, type Clock, type Result } from "./types"
import type { RuntimeSnapshot } from "./runtime"

export const defaultRuntimeCapsulePath = ".runesmith/runtime/capsule.json"

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

export async function saveRuntimeCapsule(
  host: RuntimeStoreHost,
  input: SaveRuntimeCapsuleInput,
): Promise<RuntimeCapsule> {
  const capsule: RuntimeCapsule = {
    version: 1,
    updatedAt: (input.now ?? (() => new Date()))().toISOString(),
    runtime: input.snapshot,
  }

  await host.writeText(input.path, `${JSON.stringify(capsule, null, 2)}\n`)
  return capsule
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function isLeaseBook(value: unknown): boolean {
  return isRecord(value) && isRecord((value as { leases?: unknown }).leases)
}
