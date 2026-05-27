import {
  acquireLease,
  createLeaseBook,
  createRuntime,
  type AgentContract,
} from "@runesmith/core"

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "anthropic/claude-sonnet-4.5",
    fallbacks: ["openai/gpt-5.1-codex"],
  },
  fileScope: ["packages/**"],
  completionCriteria: ["Code compiles", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: ["agent_oracle"],
}

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const later = () => new Date("2026-05-27T00:02:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

export function runDuplicatePromptScenario() {
  const first = acquireLease(createLeaseBook(), {
    targetId: "task_alpha",
    purpose: "prompt",
    holder: "atlas",
    idempotencyKey: "prompt-1",
    ttlMs: 30_000,
    now: fixedNow,
    idFactory: ids,
  })
  if (!first.ok) throw new Error(first.error.message)

  const second = acquireLease(first.value.book, {
    targetId: "task_alpha",
    purpose: "prompt",
    holder: "atlas",
    idempotencyKey: "prompt-1",
    ttlMs: 30_000,
    now: () => new Date("2026-05-27T00:00:05.000Z"),
    idFactory: () => "lease_beta",
  })
  if (!second.ok) throw new Error(second.error.message)

  return {
    firstLeaseId: first.value.lease.id,
    secondLeaseId: second.value.lease.id,
    replayed: second.value.replayed,
    leaseCount: Object.keys(second.value.book.leases).length,
  }
}

export function runStaleTaskScenario() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  const mission = runtime.startMission({
    goal: "Recover stale work",
    requiredCapabilities: ["typescript"],
  })
  if (!mission.ok) throw new Error(mission.error.message)

  const claimed = runtime.claimTask({
    missionId: "mission_alpha",
    taskId: "task_alpha",
    contractId: "agent_atlas",
    holder: "atlas",
    idempotencyKey: "claim-task-alpha",
    ttlMs: 30_000,
  })
  if (!claimed.ok) throw new Error(claimed.error.message)

  const recovered = runtime.recover({
    missionId: "mission_alpha",
    now: later,
    staleAfterMs: 60_000,
  })
  if (!recovered.ok) throw new Error(recovered.error.message)

  return {
    missionId: "mission_alpha",
    taskId: "task_alpha",
    status: recovered.value.graph.tasks.task_alpha?.status,
    staleEvents: recovered.value.graph.events.filter((event) => event.type === "task.stale").length,
  }
}

export function runEvidenceGateScenario() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  const mission = runtime.startMission({
    goal: "Prove completion",
    requiredCapabilities: ["typescript"],
  })
  if (!mission.ok) throw new Error(mission.error.message)

  const claimed = runtime.claimTask({
    missionId: "mission_alpha",
    taskId: "task_alpha",
    contractId: "agent_atlas",
    holder: "atlas",
    idempotencyKey: "claim-task-alpha",
    ttlMs: 30_000,
  })
  if (!claimed.ok) throw new Error(claimed.error.message)

  const before = runtime.completeTask({
    missionId: "mission_alpha",
    taskId: "task_alpha",
    contractId: "agent_atlas",
  })

  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_file",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed core files",
      payload: { files: ["packages/core/src/runtime.ts"] },
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  })
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_test",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Tests passed",
      payload: { command: "bun test packages/core/tests" },
      createdAt: "2026-05-27T00:01:00.000Z",
    },
  })

  const after = runtime.completeTask({
    missionId: "mission_alpha",
    taskId: "task_alpha",
    contractId: "agent_atlas",
  })
  if (!after.ok) throw new Error(after.error.message)

  return {
    beforeEvidence: before.ok ? before.value.task.status : before.error.code,
    afterEvidence: after.value.task.status,
    missionStatus: after.value.graph.mission.status,
  }
}
