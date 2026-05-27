import { runtimeError } from "./errors.js"
import { err, ok, type Clock, type IdFactory, type Lease } from "./types.js"

export type LeaseBook = {
  leases: Record<string, Lease>
}

export type AcquireLeaseInput = {
  targetId: string
  purpose: string
  holder: string
  idempotencyKey: string
  ttlMs: number
  now?: Clock
  idFactory?: IdFactory
}

export type AcquireLeaseValue = {
  book: LeaseBook
  lease: Lease
  replayed: boolean
}

function defaultClock(): Date {
  return new Date()
}

function defaultIdFactory(prefix: Parameters<IdFactory>[0]): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export function createLeaseBook(): LeaseBook {
  return { leases: {} }
}

export function acquireLease(book: LeaseBook, input: AcquireLeaseInput) {
  const nowDate = input.now ? input.now() : defaultClock()
  const existing = findActiveLease(book, input.targetId, input.purpose, nowDate)

  if (existing && existing.idempotencyKey === input.idempotencyKey) {
    return ok<AcquireLeaseValue>({
      book,
      lease: existing,
      replayed: true,
    })
  }

  if (existing) {
    return err(
      runtimeError("LEASE_CONFLICT", "Active lease already exists for target and purpose", {
        targetId: input.targetId,
        purpose: input.purpose,
        existingLeaseId: existing.id,
        existingHolder: existing.holder,
      }),
    )
  }

  const nextBook = expireElapsedLeases(book, input.targetId, input.purpose, nowDate)
  const createdAt = nowDate.toISOString()
  const lease: Lease = {
    id: (input.idFactory ?? defaultIdFactory)("lease"),
    targetId: input.targetId,
    holder: input.holder,
    purpose: input.purpose,
    idempotencyKey: input.idempotencyKey,
    expiresAt: new Date(nowDate.getTime() + input.ttlMs).toISOString(),
    status: "active",
    createdAt,
  }

  return ok<AcquireLeaseValue>({
    book: {
      leases: {
        ...nextBook.leases,
        [lease.id]: lease,
      },
    },
    lease,
    replayed: false,
  })
}

function findActiveLease(book: LeaseBook, targetId: string, purpose: string, now: Date): Lease | undefined {
  return Object.values(book.leases).find((lease) => {
    return (
      lease.targetId === targetId
      && lease.purpose === purpose
      && lease.status === "active"
      && new Date(lease.expiresAt).getTime() > now.getTime()
    )
  })
}

function expireElapsedLeases(book: LeaseBook, targetId: string, purpose: string, now: Date): LeaseBook {
  const leases = Object.fromEntries(
    Object.entries(book.leases).map(([leaseId, lease]) => {
      const shouldExpire =
        lease.targetId === targetId
        && lease.purpose === purpose
        && lease.status === "active"
        && new Date(lease.expiresAt).getTime() <= now.getTime()

      return [leaseId, shouldExpire ? { ...lease, status: "expired" as const } : lease]
    }),
  )

  return { leases }
}
