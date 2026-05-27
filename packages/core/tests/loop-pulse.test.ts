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
    expect(pulse.executionPlan).toEqual([
      {
        id: "wait-for-user-goal",
        label: "Wait for user goal",
        status: "active",
        instruction: "Wait for a concrete coding goal, then prepare or resume a mission before mutating files.",
        evidence: [],
        runes: ["Pathfinder"],
      },
    ])
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
    expect(pulse.executionPlan.map((step) => step.id)).toEqual([
      "run-targeted-verification",
      "advance-evidence-gate",
    ])
    expect(pulse.executionPlan[0]).toMatchObject({
      status: "active",
      evidence: ["test-result"],
      runes: ["Proofwright"],
    })
  })

  test("prioritizes diagnostic repair when verification failed", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Repair failed verification",
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
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_diagnostic",
        taskId: "task_alpha",
        type: "diagnostic",
        summary: "bun test packages/core/tests failed",
        payload: { command: "bun test packages/core/tests", exitCode: 1 },
        createdAt: fixedNow().toISOString(),
      },
    })

    const pulse = deriveLoopPulse(runtime.snapshot())
    const prompt = buildLoopPulsePrompt(runtime.snapshot())

    expect(pulse).toMatchObject({
      status: "active",
      health: "attention",
      nextAction: {
        id: "repair-diagnostic",
        label: "Repair diagnostic",
        priority: "high",
      },
      missingEvidence: ["test-result"],
    })
    expect(pulse.runes.map((rune) => rune.name)).toContain("Faultwright")
    expect(pulse.blockers).toContain("diagnostic: bun test packages/core/tests failed")
    expect(pulse.executionPlan.map((step) => step.id)).toEqual([
      "acknowledge-diagnostic",
      "repair-smallest-cause",
      "rerun-failing-command",
    ])
    expect(pulse.executionPlan[0]).toMatchObject({
      status: "active",
      evidence: ["diagnostic"],
      runes: ["Faultwright"],
    })
    expect(pulse.executionPlan[1]).toMatchObject({
      label: "Hypothesis repair",
      instruction: "State a falsifiable repair hypothesis, change one repair variable, and link the edit to the active diagnostic.",
      evidence: ["file-change"],
      runes: ["Faultwright"],
    })
    expect(pulse.executionPlan[2]).toMatchObject({
      status: "blocked",
      evidence: ["test-result"],
      runes: ["Proofwright"],
    })
    expect(prompt).toContain("Next action: Repair diagnostic")
    expect(prompt).toContain("Execution plan:")
    expect(prompt).toContain("1. active - Acknowledge diagnostic")
    expect(prompt).toContain("2. queued - Hypothesis repair")
    expect(prompt).toContain("Active runes: Faultwright, Proofwright")
  })

  test("holds unresolved risk for an explicit decision", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    runtime.registerContract(atlas)
    runtime.startMission({
      goal: "Hold risky automation",
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
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "Loop pulse tests passed",
        payload: { command: "bun test packages/core/tests/loop-pulse.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_risk",
        taskId: "task_alpha",
        type: "risk",
        summary: "Deletes generated user files without confirmation",
        payload: { severity: "high" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })

    const pulse = deriveLoopPulse(runtime.snapshot())
    const prompt = buildLoopPulsePrompt(runtime.snapshot())

    expect(pulse).toMatchObject({
      status: "active",
      health: "critical",
      risks: ["Deletes generated user files without confirmation"],
      missingEvidence: ["decision"],
      nextAction: {
        id: "resolve-risk",
        label: "Resolve risk",
        priority: "critical",
      },
    })
    expect(pulse.blockers).toContain("risk: Deletes generated user files without confirmation")
    expect(pulse.executionPlan.map((step) => step.id)).toEqual([
      "inspect-risk",
      "clear-or-hold-risk",
    ])
    expect(prompt).toContain("Risks: Deletes generated user files without confirmation")
    expect(prompt).toContain("Next action: Resolve risk")
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
