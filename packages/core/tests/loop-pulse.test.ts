import { describe, expect, test } from "bun:test"

import { createRuntime, deriveLoopPulse, buildLoopPulsePrompt, type AgentContract } from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const later = () => new Date("2026-05-27T00:02:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

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

describe("loop pulse", () => {
  test("waits for a goal when no mission is active", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })

    const pulse = deriveLoopPulse(runtime.snapshot())

    expect(pulse).toMatchObject({
      status: "idle",
      health: "clear",
      nextAction: {
        id: "wait-for-goal",
        label: "Wait for goal",
        priority: "low",
      },
    })
    expect(pulse.runes.map((rune) => rune.name)).toContain("Pathfinder")
  })

  test("prioritizes recovery when the active task is stale", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Recover loop pulse work",
      requiredCapabilities: ["typescript"],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    runtime.recover({
      missionId: "mission_alpha",
      now: later,
      staleAfterMs: 60_000,
    })

    const pulse = deriveLoopPulse(runtime.snapshot())
    const prompt = buildLoopPulsePrompt(runtime.snapshot())

    expect(pulse).toMatchObject({
      status: "active",
      health: "critical",
      missionId: "mission_alpha",
      taskId: "task_alpha",
      nextAction: {
        id: "recover-stale",
        label: "Recover stale work",
        priority: "critical",
      },
    })
    expect(pulse.runes.map((rune) => rune.name)).toContain("Recovery Loom")
    expect(pulse.blockers).toContain("task_alpha is stale")
    expect(prompt).toContain("## Runesmith Loop Pulse")
    expect(prompt).toContain("Next action: Recover stale work")
    expect(prompt).toContain("Health: critical")
  })

  test("asks for proof when file changes exist but passing tests are missing", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Prove loop pulse work",
      requiredCapabilities: ["typescript"],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed loop pulse",
        payload: { filePath: "packages/core/src/loop-pulse.ts" },
        createdAt: fixedNow().toISOString(),
      },
    })

    const pulse = deriveLoopPulse(runtime.snapshot())

    expect(pulse).toMatchObject({
      status: "active",
      health: "attention",
      nextAction: {
        id: "capture-proof",
        label: "Capture proof",
        priority: "high",
      },
      missingEvidence: ["test-result"],
    })
    expect(pulse.runes.map((rune) => rune.name)).toContain("Proofwright")
  })

  test("prioritizes stale recovery before blocked work", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Rank loop pulse recovery",
      taskPlan: [
        {
          key: "stale",
          title: "Stale task",
          description: "Recover this first.",
        },
        {
          key: "blocked",
          title: "Blocked task",
          description: "Hold until stale recovery is handled.",
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-stale",
      ttlMs: 30_000,
    })
    runtime.recover({
      missionId: "mission_alpha",
      now: later,
      staleAfterMs: 60_000,
    })
    const graph = runtime.getMission("mission_alpha")
    if (!graph.ok) throw new Error("mission missing")
    const blockedGraph = {
      ...graph.value,
      tasks: {
        ...graph.value.tasks,
        task_alpha_blocked: {
          ...graph.value.tasks.task_alpha_blocked!,
          status: "blocked" as const,
        },
      },
    }

    const pulse = deriveLoopPulse({
      ...runtime.snapshot(),
      graphs: {
        mission_alpha: blockedGraph,
      },
    })

    expect(pulse.nextAction.id).toBe("recover-stale")
    expect(pulse.taskId).toBe("task_alpha")
  })
})
