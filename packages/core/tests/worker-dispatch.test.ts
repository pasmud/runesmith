import { describe, expect, test } from "bun:test"

import {
  buildWorkerDispatchPrompt,
  claimWorkerDispatchPacket,
  createRuntime,
  deriveWorkerDispatch,
  selectWorkerEvidenceTarget,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing", "repository-maintenance"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: ["anthropic/claude-sonnet-4.5"],
  },
  fileScope: ["packages/**", "docs/**"],
  completionCriteria: ["Code compiles", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: ["agent_artificer"],
}

const artificer: AgentContract = {
  id: "agent_artificer",
  displayName: "Artificer",
  description: "UI implementation agent",
  capabilities: ["typescript", "testing", "ui"],
  allowedTools: ["read", "edit", "test"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["packages/dashboard/**"],
  completionCriteria: ["UI renders", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

const steward: AgentContract = {
  id: "agent_steward",
  displayName: "Steward",
  description: "Planning and release agent",
  capabilities: ["repository-maintenance"],
  allowedTools: ["read", "edit"],
  modelPolicy: {
    primary: "openai/gpt-5.1-codex",
    fallbacks: [],
  },
  fileScope: ["docs/**"],
  completionCriteria: ["Decision recorded"],
  requiredEvidence: ["decision"],
  fallbacks: [],
}

describe("worker dispatch", () => {
  test("builds independent execution packets for parallel-ready slices", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.registerContract(artificer)
    runtime.registerContract(steward)
    runtime.startMission({
      goal: "Ship parallel OpenCode orchestration",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: parallel orchestration",
          description: "Record the dispatch boundary.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: adapter dispatch surface",
          description: "Expose worker dispatch state to OpenCode.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard dispatch panel",
          description: "Show worker dispatch state in the dashboard.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "review",
          title: "Review: dispatch",
          description: "Review the dispatch proof.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
          dependsOn: ["adapter-forge", "dashboard-forge"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "claim-plan",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_alpha",
        taskId: "task_alpha",
        type: "decision",
        summary: "Dispatch boundary approved",
        payload: {},
        createdAt: "2026-05-27T00:00:01.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_steward",
    })

    const dispatch = deriveWorkerDispatch(runtime.snapshot())
    const prompt = buildWorkerDispatchPrompt(runtime.snapshot())

    expect(dispatch).toMatchObject({
      status: "parallel-ready",
      missionId: "mission_alpha",
      packetCount: 2,
      summary: "Worker Dispatch has 2 claimable packets for mission_alpha across 2 agent contracts.",
    })
    expect(dispatch.packets.map((packet) => [packet.taskKey, packet.state, packet.agentId, packet.model])).toEqual([
      ["adapter-forge", "claimable", "agent_atlas", "openai/gpt-5.1-codex"],
      ["dashboard-forge", "claimable", "agent_artificer", "openai/gpt-5.1-codex"],
    ])
    expect(dispatch.packets[0]).toMatchObject({
      id: "worker_mission_alpha_task_alpha_adapter_forge_agent_atlas",
      taskId: "task_alpha_adapter_forge",
      allowedTools: ["read", "edit", "bash", "test"],
      fileScope: ["packages/**", "docs/**"],
      requiredEvidence: ["file-change", "test-result"],
      claim: {
        idempotencyKey: "worker-dispatch:mission_alpha:task_alpha_adapter_forge:agent_atlas",
        ttlMs: 120000,
      },
      handoff: "Atlas should execute task_alpha_adapter_forge: Expose worker dispatch state to OpenCode. Required evidence: file-change, test-result.",
    })
    expect(prompt).toContain("## Runesmith Worker Dispatch")
    expect(prompt).toContain("Status: parallel-ready")
    expect(prompt).toContain("worker_mission_alpha_task_alpha_adapter_forge_agent_atlas")
    expect(prompt).toContain("Directive: Execute worker packets independently only when their file scopes do not overlap and their dependencies are complete.")
  })

  test("keeps leased active worker packets tied to their current holder", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Ship active worker dispatch",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: active worker",
          description: "Implement worker dispatch state.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas-worker",
      idempotencyKey: "claim-worker",
      ttlMs: 30_000,
    })

    const dispatch = deriveWorkerDispatch(runtime.snapshot())

    expect(dispatch).toMatchObject({
      status: "active",
      packetCount: 1,
      packets: [
        {
          state: "leased",
          leaseId: "lease_alpha",
          holder: "atlas-worker",
          agentId: "agent_atlas",
          claim: undefined,
        },
      ],
    })
  })

  test("counts only claimable packets in parallel-ready summaries", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.registerContract(artificer)
    runtime.registerContract(steward)
    runtime.startMission({
      goal: "Ship mixed worker dispatch",
      taskPlan: [
        {
          key: "adapter-forge",
          title: "Forge: adapter dispatch surface",
          description: "Expose worker dispatch state to OpenCode.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard dispatch panel",
          description: "Show worker dispatch state in the dashboard.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
        },
        {
          key: "docs-forge",
          title: "Forge: dispatch docs",
          description: "Document worker dispatch.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas-worker",
      idempotencyKey: "claim-worker",
      ttlMs: 30_000,
    })

    const dispatch = deriveWorkerDispatch(runtime.snapshot())

    expect(dispatch).toMatchObject({
      status: "parallel-ready",
      packetCount: 3,
      summary: "Worker Dispatch has 2 claimable packets for mission_alpha across 2 agent contracts.",
    })
    expect(dispatch.packets.map((packet) => packet.state)).toEqual(["leased", "claimable", "claimable"])
  })

  test("claims worker packets without requiring mission or task ids", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.registerContract(artificer)
    runtime.registerContract(steward)
    runtime.startMission({
      goal: "Ship packet claim orchestration",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: packet claim",
          description: "Record the packet claim boundary.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: adapter packet claim",
          description: "Expose packet claim to OpenCode.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard packet claim",
          description: "Expose packet claim to the dashboard.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "claim-plan",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_alpha",
        taskId: "task_alpha",
        type: "decision",
        summary: "Packet claim boundary approved",
        payload: {},
        createdAt: "2026-05-27T00:00:01.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_steward",
    })

    const packetId = deriveWorkerDispatch(runtime.snapshot()).packets[0]?.id
    const claimed = claimWorkerDispatchPacket(runtime, { packetId, ttlMs: 45_000 })
    if (!claimed.ok) throw new Error(claimed.error.message)
    const replayed = claimWorkerDispatchPacket(runtime, { packetId, ttlMs: 45_000 })
    if (!replayed.ok) throw new Error(replayed.error.message)

    expect(claimed.value).toMatchObject({
      packetId: "worker_mission_alpha_task_alpha_adapter_forge_agent_atlas",
      missionId: "mission_alpha",
      taskId: "task_alpha_adapter_forge",
      agentId: "agent_atlas",
      holder: "runesmith-worker:agent_atlas",
      replayed: false,
    })
    expect(claimed.value.lease).toMatchObject({
      holder: "runesmith-worker:agent_atlas",
      idempotencyKey: "worker-dispatch:mission_alpha:task_alpha_adapter_forge:agent_atlas",
    })
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_adapter_forge).toMatchObject({
      status: "running",
      assignedAgentId: "agent_atlas",
    })
    expect(replayed.value).toMatchObject({
      packetId,
      leaseId: claimed.value.leaseId,
      replayed: true,
    })
  })

  test("records a durable focused worker packet for evidence routing", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Route proof to focused worker",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: focused proof",
          description: "Capture proof on the focused worker packet.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
        },
      ],
    })

    const claimed = claimWorkerDispatchPacket(runtime)
    if (!claimed.ok) throw new Error(claimed.error.message)
    const target = selectWorkerEvidenceTarget(runtime.snapshot())

    expect(target).toEqual({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      packetId: "worker_mission_alpha_task_alpha_agent_atlas",
      agentId: "agent_atlas",
      holder: "runesmith-worker:agent_atlas",
      leaseId: "lease_alpha",
    })
    expect(runtime.snapshot().graphs.mission_alpha.events.at(-1)).toMatchObject({
      type: "worker.dispatch.claimed",
      targetId: "task_alpha",
      message: "Worker Dispatch packet claimed",
      data: {
        packetId: "worker_mission_alpha_task_alpha_agent_atlas",
        agentId: "agent_atlas",
        holder: "runesmith-worker:agent_atlas",
        leaseId: "lease_alpha",
        replayed: false,
      },
    })
  })

  test("reports blocked worker dispatch when no packet can execute", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Ship unavailable worker",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: Rust compiler",
          description: "Needs an unavailable agent capability.",
          requiredCapabilities: ["rust"],
          requiredEvidence: ["file-change", "test-result"],
        },
      ],
    })

    const dispatch = deriveWorkerDispatch(runtime.snapshot())

    expect(dispatch).toMatchObject({
      status: "blocked",
      packetCount: 0,
      blockers: ["forge: no matching agent contract"],
      summary: "Worker Dispatch blocked for mission_alpha: no executable packets are available.",
    })
  })
})
