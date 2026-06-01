import { deriveDispatchMatrix, type DispatchSlot } from "./dispatch-matrix.js"
import { runtimeError } from "./errors.js"
import type { ClaimTaskValue, RunesmithRuntime, RuntimeSnapshot } from "./runtime.js"
import { err, ok, type AgentContract, type EvidenceType, type Lease, type Result } from "./types.js"

export type WorkerDispatchStatus = "idle" | "blocked" | "ready" | "parallel-ready" | "active"

export type WorkerDispatchPacketState = "claimable" | "leased"

export type WorkerDispatchClaim = {
  missionId: string
  taskId: string
  contractId: string
  holder: string
  idempotencyKey: string
  ttlMs: number
}

export type WorkerDispatchPacket = {
  id: string
  state: WorkerDispatchPacketState
  missionId: string
  taskId: string
  taskKey: string
  title: string
  objective: string
  agentId: string
  agentName: string
  model: string
  allowedTools: string[]
  fileScope: string[]
  requiredEvidence: EvidenceType[]
  completionCriteria: string[]
  handoff: string
  leaseId?: string
  holder?: string
  claim?: WorkerDispatchClaim
}

export type WorkerDispatch = {
  status: WorkerDispatchStatus
  summary: string
  packetCount: number
  packets: WorkerDispatchPacket[]
  blockers: string[]
  missionId?: string
  goal?: string
}

export type ClaimWorkerDispatchPacketInput = {
  packetId?: string
  holder?: string
  ttlMs?: number
}

export type ClaimWorkerDispatchPacketValue = {
  packetId: string
  missionId: string
  taskId: string
  agentId: string
  holder: string
  leaseId: string
  lease: Lease
  replayed: boolean
  packet: WorkerDispatchPacket
  workerDispatch: WorkerDispatch
  claim?: ClaimTaskValue
}

const defaultWorkerLeaseTtlMs = 120_000

export function deriveWorkerDispatch(snapshot: RuntimeSnapshot): WorkerDispatch {
  const matrix = deriveDispatchMatrix(snapshot)
  const packets = matrix.slots.flatMap((slot) => buildWorkerDispatchPacket(slot, snapshot, matrix.missionId))
  const blockers = matrix.slots
    .filter((slot) => slot.lane === "blocked")
    .flatMap((slot) => slot.blockers.map((blocker) => `${slot.key}: ${blocker}`))
  const status = selectWorkerDispatchStatus(packets, blockers)

  return {
    status,
    missionId: matrix.missionId,
    goal: matrix.goal,
    packetCount: packets.length,
    packets,
    blockers,
    summary: buildWorkerDispatchSummary(matrix.missionId, status, packets, blockers),
  }
}

export function buildWorkerDispatchPrompt(snapshot: RuntimeSnapshot): string {
  const dispatch = deriveWorkerDispatch(snapshot)
  const packetLines = dispatch.packets.length > 0
    ? dispatch.packets.map((packet) => {
        return [
          `- ${packet.state} ${packet.id}: ${packet.title}`,
          `agent: ${packet.agentName} (${packet.agentId})`,
          `model: ${packet.model}`,
          `tools: ${formatList(packet.allowedTools)}`,
          `scope: ${formatList(packet.fileScope)}`,
          `lease: ${packet.leaseId ?? "none"}`,
          `claim: ${packet.claim?.idempotencyKey ?? "none"}`,
          `evidence: ${formatList(packet.requiredEvidence)}`,
          `handoff: ${packet.handoff}`,
        ].join("; ")
      })
    : ["none"]

  return [
    "## Runesmith Worker Dispatch",
    `Status: ${dispatch.status}`,
    `Mission: ${dispatch.missionId ?? "none"}`,
    `Goal: ${dispatch.goal ?? "none"}`,
    `Packets: ${dispatch.packetCount}`,
    `Summary: ${dispatch.summary}`,
    `Blockers: ${formatList(dispatch.blockers)}`,
    "Packets:",
    ...packetLines,
    "Directive: Execute worker packets independently only when their file scopes do not overlap and their dependencies are complete.",
  ].join("\n")
}

export function claimWorkerDispatchPacket(
  runtime: RunesmithRuntime,
  input: ClaimWorkerDispatchPacketInput = {},
): Result<ClaimWorkerDispatchPacketValue> {
  const dispatch = deriveWorkerDispatch(runtime.snapshot())
  const packet = input.packetId
    ? dispatch.packets.find((candidate) => candidate.id === input.packetId)
    : dispatch.packets.find((candidate) => candidate.state === "claimable")

  if (!packet) {
    return err(
      runtimeError("INVALID_TRANSITION", "No claimable Worker Dispatch packet is available", {
        packetId: input.packetId,
        status: dispatch.status,
        blockers: dispatch.blockers,
      }),
    )
  }

  if (packet.state === "leased") {
    const lease = runtime.snapshot().leases.leases[packet.leaseId ?? ""]
    if (!lease) {
      return err(
        runtimeError("INVALID_TRANSITION", "Worker Dispatch packet lease is missing", {
          packetId: packet.id,
          leaseId: packet.leaseId,
        }),
      )
    }

    return ok({
      packetId: packet.id,
      missionId: packet.missionId,
      taskId: packet.taskId,
      agentId: packet.agentId,
      holder: lease.holder,
      leaseId: lease.id,
      lease,
      replayed: true,
      packet,
      workerDispatch: dispatch,
    })
  }

  if (!packet.claim) {
    return err(
      runtimeError("INVALID_TRANSITION", "Worker Dispatch packet is not claimable", {
        packetId: packet.id,
        state: packet.state,
      }),
    )
  }

  const claimed = runtime.claimTask({
    missionId: packet.claim.missionId,
    taskId: packet.claim.taskId,
    contractId: packet.claim.contractId,
    holder: input.holder ?? packet.claim.holder,
    idempotencyKey: packet.claim.idempotencyKey,
    ttlMs: input.ttlMs ?? packet.claim.ttlMs,
  })
  if (!claimed.ok) return claimed

  return ok({
    packetId: packet.id,
    missionId: packet.missionId,
    taskId: packet.taskId,
    agentId: packet.agentId,
    holder: claimed.value.lease.holder,
    leaseId: claimed.value.lease.id,
    lease: claimed.value.lease,
    replayed: claimed.value.replayed,
    packet,
    workerDispatch: deriveWorkerDispatch(runtime.snapshot()),
    claim: claimed.value,
  })
}

function buildWorkerDispatchPacket(
  slot: DispatchSlot,
  snapshot: RuntimeSnapshot,
  missionId: string | undefined,
): WorkerDispatchPacket[] {
  if (!missionId || !["ready", "active"].includes(slot.lane)) return []

  const agentId = slot.recommendedAgentId
  const contract = agentId ? snapshot.contracts[agentId] : undefined
  if (!agentId || !contract) return []

  const state: WorkerDispatchPacketState = slot.lane === "active" ? "leased" : "claimable"
  const base = {
    id: buildPacketId(missionId, slot.taskId, agentId),
    state,
    missionId,
    taskId: slot.taskId,
    taskKey: slot.key,
    title: slot.title,
    objective: resolveTaskDescription(snapshot, missionId, slot.taskId),
    agentId,
    agentName: contract.displayName,
    model: contract.modelPolicy.primary,
    allowedTools: [...contract.allowedTools],
    fileScope: [...contract.fileScope],
    requiredEvidence: [...slot.requiredEvidence],
    completionCriteria: [...contract.completionCriteria],
    handoff: buildHandoff(slot, contract, snapshot, missionId),
    leaseId: slot.activeLeaseId,
    holder: slot.activeHolder,
    claim: undefined,
  }

  return [
    state === "claimable"
      ? {
          ...base,
          claim: {
            missionId,
            taskId: slot.taskId,
            contractId: agentId,
            holder: `runesmith-worker:${contract.id}`,
            idempotencyKey: `worker-dispatch:${missionId}:${slot.taskId}:${agentId}`,
            ttlMs: defaultWorkerLeaseTtlMs,
          },
        }
      : base,
  ]
}

function selectWorkerDispatchStatus(
  packets: WorkerDispatchPacket[],
  blockers: string[],
): WorkerDispatchStatus {
  const claimableCount = packets.filter((packet) => packet.state === "claimable").length
  const leasedCount = packets.filter((packet) => packet.state === "leased").length
  if (claimableCount > 1) return "parallel-ready"
  if (claimableCount === 1) return "ready"
  if (leasedCount > 0) return "active"
  if (blockers.length > 0) return "blocked"

  return "idle"
}

function buildWorkerDispatchSummary(
  missionId: string | undefined,
  status: WorkerDispatchStatus,
  packets: WorkerDispatchPacket[],
  blockers: string[],
): string {
  if (!missionId) return "No active mission is ready for Worker Dispatch."
  if (status === "parallel-ready") {
    const claimablePackets = packets.filter((packet) => packet.state === "claimable")
    const agentCount = new Set(claimablePackets.map((packet) => packet.agentId)).size
    return `Worker Dispatch has ${claimablePackets.length} claimable packets for ${missionId} across ${agentCount} agent contracts.`
  }
  if (status === "ready") return `Worker Dispatch has 1 claimable packet for ${missionId}.`
  if (status === "active") return `Worker Dispatch has ${packets.length} leased packet${packets.length === 1 ? "" : "s"} for ${missionId}.`
  if (status === "blocked") return `Worker Dispatch blocked for ${missionId}: no executable packets are available.`

  return blockers.length > 0
    ? `Worker Dispatch blocked for ${missionId}: ${blockers.length} blocker${blockers.length === 1 ? "" : "s"} remain.`
    : `Worker Dispatch idle for ${missionId}: no executable packets are available.`
}

function buildHandoff(
  slot: DispatchSlot,
  contract: AgentContract,
  snapshot: RuntimeSnapshot,
  missionId: string,
): string {
  const objective = resolveTaskDescription(snapshot, missionId, slot.taskId)
  return `${contract.displayName} should execute ${slot.taskId}: ${objective} Required evidence: ${formatList(slot.requiredEvidence)}.`
}

function resolveTaskDescription(snapshot: RuntimeSnapshot, missionId: string, taskId: string): string {
  return snapshot.graphs[missionId]?.tasks[taskId]?.description ?? "Execute the assigned Runesmith task."
}

function buildPacketId(missionId: string, taskId: string, agentId: string): string {
  return normalizeId(`worker_${missionId}_${taskId}_${agentId}`)
}

function normalizeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "worker_dispatch"
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
