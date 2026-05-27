import { describe, expect, test } from "bun:test"

import { acquireLease, createLeaseBook } from "../src/index"

const at = (iso: string) => () => new Date(iso)
const ids = (prefix: string) => `${prefix}_alpha`

describe("lease scheduler", () => {
  test("grants an active lease for a target and purpose", () => {
    const result = acquireLease(createLeaseBook(), {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "atlas",
      idempotencyKey: "prompt-1",
      ttlMs: 30_000,
      now: at("2026-05-27T00:00:00.000Z"),
      idFactory: ids,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value).toEqual({
      book: {
        leases: {
          lease_alpha: {
            id: "lease_alpha",
            targetId: "task_alpha",
            holder: "atlas",
            purpose: "prompt",
            idempotencyKey: "prompt-1",
            expiresAt: "2026-05-27T00:00:30.000Z",
            status: "active",
            createdAt: "2026-05-27T00:00:00.000Z",
          },
        },
      },
      lease: {
        id: "lease_alpha",
        targetId: "task_alpha",
        holder: "atlas",
        purpose: "prompt",
        idempotencyKey: "prompt-1",
        expiresAt: "2026-05-27T00:00:30.000Z",
        status: "active",
        createdAt: "2026-05-27T00:00:00.000Z",
      },
      replayed: false,
    })
  })

  test("replays the same active idempotency key", () => {
    const first = acquireLease(createLeaseBook(), {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "atlas",
      idempotencyKey: "prompt-1",
      ttlMs: 30_000,
      now: at("2026-05-27T00:00:00.000Z"),
      idFactory: ids,
    })
    if (!first.ok) throw new Error("first lease failed")

    const second = acquireLease(first.value.book, {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "atlas",
      idempotencyKey: "prompt-1",
      ttlMs: 30_000,
      now: at("2026-05-27T00:00:05.000Z"),
      idFactory: () => "lease_beta",
    })

    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.value.replayed).toBe(true)
    expect(second.value.lease.id).toBe("lease_alpha")
    expect(Object.keys(second.value.book.leases)).toEqual(["lease_alpha"])
  })

  test("rejects competing active leases", () => {
    const first = acquireLease(createLeaseBook(), {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "atlas",
      idempotencyKey: "prompt-1",
      ttlMs: 30_000,
      now: at("2026-05-27T00:00:00.000Z"),
      idFactory: ids,
    })
    if (!first.ok) throw new Error("first lease failed")

    const second = acquireLease(first.value.book, {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "oracle",
      idempotencyKey: "prompt-2",
      ttlMs: 30_000,
      now: at("2026-05-27T00:00:05.000Z"),
      idFactory: () => "lease_beta",
    })

    expect(second).toEqual({
      ok: false,
      error: {
        code: "LEASE_CONFLICT",
        message: "Active lease already exists for target and purpose",
        details: {
          targetId: "task_alpha",
          purpose: "prompt",
          existingLeaseId: "lease_alpha",
          existingHolder: "atlas",
        },
      },
    })
  })

  test("replaces an expired lease", () => {
    const first = acquireLease(createLeaseBook(), {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "atlas",
      idempotencyKey: "prompt-1",
      ttlMs: 1_000,
      now: at("2026-05-27T00:00:00.000Z"),
      idFactory: ids,
    })
    if (!first.ok) throw new Error("first lease failed")

    const second = acquireLease(first.value.book, {
      targetId: "task_alpha",
      purpose: "prompt",
      holder: "oracle",
      idempotencyKey: "prompt-2",
      ttlMs: 30_000,
      now: at("2026-05-27T00:00:02.000Z"),
      idFactory: () => "lease_beta",
    })

    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.value.book.leases.lease_alpha?.status).toBe("expired")
    expect(second.value.lease).toMatchObject({
      id: "lease_beta",
      holder: "oracle",
      status: "active",
    })
  })
})
