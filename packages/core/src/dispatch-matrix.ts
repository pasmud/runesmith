import { deriveMissionMap, type MissionMapTask } from "./mission-map.js"
import type { RuntimeSnapshot } from "./runtime.js"
import type { AgentContract, EvidenceType, TaskStatus } from "./types.js"

export type DispatchMatrixStatus = "idle" | "serial" | "parallel" | "blocked" | "drained"

export type DispatchLane = "ready" | "active" | "blocked" | "complete"

export type DispatchSlot = {
  taskId: string
  key: string
  title: string
  status: TaskStatus
  lane: DispatchLane
  ready: boolean
  requiredCapabilities: string[]
  requiredEvidence: EvidenceType[]
  candidateAgentIds: string[]
  blockers: string[]
  dependsOn: string[]
  activeLeaseId?: string
  activeHolder?: string
  recommendedAgentId?: string
}

export type DispatchMatrix = {
  status: DispatchMatrixStatus
  summary: string
  readySlotCount: number
  activeSlotCount: number
  blockedSlotCount: number
  slots: DispatchSlot[]
  missionId?: string
  goal?: string
}

type ActiveLease = {
  id: string
  holder: string
}

export function deriveDispatchMatrix(snapshot: RuntimeSnapshot): DispatchMatrix {
  const map = deriveMissionMap(snapshot)
  if (map.status === "idle") {
    return {
      status: "idle",
      summary: "No active mission is ready for Dispatch Matrix.",
      readySlotCount: 0,
      activeSlotCount: 0,
      blockedSlotCount: 0,
      slots: [],
    }
  }

  const activeLeases = collectActiveTaskLeases(snapshot)
  const slots = assignReadyAgents(
    map.tasks.map((task) => buildDispatchSlot(task, snapshot, activeLeases.get(task.id))),
    snapshot,
  )
  const readySlotCount = slots.filter((slot) => slot.lane === "ready").length
  const activeSlotCount = slots.filter((slot) => slot.lane === "active").length
  const blockedSlotCount = slots.filter((slot) => slot.lane === "blocked").length
  const status = selectDispatchStatus({ activeSlotCount, blockedSlotCount, readySlotCount, slots })

  return {
    status,
    missionId: map.missionId,
    goal: map.goal,
    readySlotCount,
    activeSlotCount,
    blockedSlotCount,
    slots,
    summary: buildDispatchSummary(map.missionId, status, { activeSlotCount, blockedSlotCount, readySlotCount, slots }),
  }
}

export function buildDispatchMatrixPrompt(snapshot: RuntimeSnapshot): string {
  const matrix = deriveDispatchMatrix(snapshot)
  const slotLines = matrix.slots.length > 0
    ? matrix.slots.map((slot) => {
        return [
          `- ${slot.lane} ${slot.key} ${slot.taskId}: ${slot.title}`,
          `agent: ${slot.recommendedAgentId ?? "none"}`,
          `candidates: ${formatList(slot.candidateAgentIds)}`,
          `lease: ${slot.activeLeaseId ?? "none"}`,
          `blockers: ${formatList(slot.blockers)}`,
        ].join("; ")
      })
    : ["none"]

  return [
    "## Runesmith Dispatch Matrix",
    `Status: ${matrix.status}`,
    `Mission: ${matrix.missionId ?? "none"}`,
    `Goal: ${matrix.goal ?? "none"}`,
    `Ready slots: ${matrix.readySlotCount}`,
    `Active slots: ${matrix.activeSlotCount}`,
    `Blocked slots: ${matrix.blockedSlotCount}`,
    `Summary: ${matrix.summary}`,
    "Slots:",
    ...slotLines,
    "Directive: Use Dispatch Matrix as the engine-owned agent routing signal. Claim only ready slots, respect active leases, and use parallel execution only when independent ready slots have matching agent contracts.",
  ].join("\n")
}

function buildDispatchSlot(task: MissionMapTask, snapshot: RuntimeSnapshot, activeLease: ActiveLease | undefined): DispatchSlot {
  const effectiveLease = task.status === "complete" ? undefined : activeLease
  const candidateAgentIds = findCandidateAgents(task, snapshot.contracts)
  const recommendedAgentId = selectRecommendedAgent(task, candidateAgentIds, snapshot)
  const blockers = collectDispatchBlockers(task, candidateAgentIds, effectiveLease)
  const lane = selectLane(task, blockers, effectiveLease)

  return {
    taskId: task.id,
    key: task.key,
    title: task.title,
    status: task.status,
    lane,
    ready: task.ready && blockers.length === 0,
    requiredCapabilities: [...task.requiredCapabilities],
    requiredEvidence: [...task.requiredEvidence],
    candidateAgentIds,
    recommendedAgentId,
    blockers,
    dependsOn: [...task.dependsOn],
    activeLeaseId: effectiveLease?.id,
    activeHolder: effectiveLease?.holder,
  }
}

function assignReadyAgents(slots: DispatchSlot[], snapshot: RuntimeSnapshot): DispatchSlot[] {
  const activeCounts = countActiveAssignments(snapshot)
  const readySlots = slots
    .filter((slot) => slot.lane === "ready" && slot.candidateAgentIds.length > 0)
    .sort((left, right) => {
      return left.candidateAgentIds.length - right.candidateAgentIds.length || left.key.localeCompare(right.key)
    })
  const recommendations = new Map<string, string>()

  for (const slot of readySlots) {
    const agentId = [...slot.candidateAgentIds].sort((left, right) => {
      return (activeCounts.get(left) ?? 0) - (activeCounts.get(right) ?? 0) || left.localeCompare(right)
    })[0]
    if (!agentId) continue

    recommendations.set(slot.taskId, agentId)
    activeCounts.set(agentId, (activeCounts.get(agentId) ?? 0) + 1)
  }

  return slots.map((slot) => {
    const recommendedAgentId = recommendations.get(slot.taskId)
    return recommendedAgentId ? { ...slot, recommendedAgentId } : slot
  })
}

function selectLane(task: MissionMapTask, blockers: string[], activeLease: ActiveLease | undefined): DispatchLane {
  if (task.status === "complete") return "complete"
  if (activeLease || ["running", "verifying"].includes(task.status)) return "active"
  if (blockers.length > 0) return "blocked"
  return "ready"
}

function collectDispatchBlockers(
  task: MissionMapTask,
  candidateAgentIds: string[],
  activeLease: ActiveLease | undefined,
): string[] {
  if (task.status === "complete" || activeLease || ["running", "verifying"].includes(task.status)) return []

  const blockers = [...task.blockedBy.map((dependencyId) => `blocked by ${dependencyId}`)]
  if (candidateAgentIds.length === 0) blockers.push("no matching agent contract")
  if (!task.ready && task.blockedBy.length === 0) blockers.push(`task status ${task.status}`)

  return blockers
}

function findCandidateAgents(task: MissionMapTask, contracts: Record<string, AgentContract>): string[] {
  return Object.values(contracts)
    .filter((contract) => task.requiredCapabilities.every((capability) => contract.capabilities.includes(capability)))
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((contract) => contract.id)
}

function selectRecommendedAgent(
  task: MissionMapTask,
  candidateAgentIds: string[],
  snapshot: RuntimeSnapshot,
): string | undefined {
  if (task.assignedAgentId && candidateAgentIds.includes(task.assignedAgentId)) return task.assignedAgentId
  if (candidateAgentIds.length === 0) return undefined

  const activeCounts = countActiveAssignments(snapshot)
  return [...candidateAgentIds].sort((left, right) => {
    return (activeCounts.get(left) ?? 0) - (activeCounts.get(right) ?? 0) || left.localeCompare(right)
  })[0]
}

function collectActiveTaskLeases(snapshot: RuntimeSnapshot): Map<string, ActiveLease> {
  return new Map(
    Object.values(snapshot.leases.leases)
      .filter((lease) => lease.status === "active" && lease.purpose === "task.claim")
      .map((lease) => [lease.targetId, { id: lease.id, holder: lease.holder }]),
  )
}

function countActiveAssignments(snapshot: RuntimeSnapshot): Map<string, number> {
  const counts = new Map<string, number>()
  for (const graph of Object.values(snapshot.graphs)) {
    for (const task of Object.values(graph.tasks)) {
      if (!task.assignedAgentId || !["running", "verifying"].includes(task.status)) continue
      counts.set(task.assignedAgentId, (counts.get(task.assignedAgentId) ?? 0) + 1)
    }
  }

  return counts
}

function selectDispatchStatus(input: {
  activeSlotCount: number
  blockedSlotCount: number
  readySlotCount: number
  slots: DispatchSlot[]
}): DispatchMatrixStatus {
  if (input.readySlotCount > 1) return "parallel"
  if (input.readySlotCount === 1 || input.activeSlotCount > 0) return "serial"
  if (input.blockedSlotCount > 0) return "blocked"
  if (input.slots.length > 0 && input.slots.every((slot) => slot.lane === "complete")) return "drained"
  return "idle"
}

function buildDispatchSummary(
  missionId: string | undefined,
  status: DispatchMatrixStatus,
  input: {
    activeSlotCount: number
    blockedSlotCount: number
    readySlotCount: number
    slots: DispatchSlot[]
  },
): string {
  if (!missionId) return "No active mission is ready for Dispatch Matrix."
  if (status === "parallel") {
    const agentCount = new Set(input.slots.filter((slot) => slot.lane === "ready").map((slot) => slot.recommendedAgentId).filter(Boolean)).size
    return `Dispatch Matrix parallel for ${missionId}: ${input.readySlotCount} ready slots can run across ${agentCount} agent contracts.`
  }
  if (status === "serial") {
    const count = input.readySlotCount + input.activeSlotCount
    return `Dispatch Matrix serial for ${missionId}: ${count} dispatch slot${count === 1 ? "" : "s"} ${count === 1 ? "is" : "are"} active or ready.`
  }
  if (status === "blocked") {
    return `Dispatch Matrix blocked for ${missionId}: no claimable slots; ${input.blockedSlotCount} task${input.blockedSlotCount === 1 ? "" : "s"} ${input.blockedSlotCount === 1 ? "needs" : "need"} dependencies, contracts, or recovery.`
  }
  if (status === "drained") {
    return `Dispatch Matrix drained for ${missionId}: no claimable work remains.`
  }

  return "No active mission is ready for Dispatch Matrix."
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none"
}
