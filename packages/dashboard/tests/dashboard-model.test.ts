import { describe, expect, test } from "bun:test"

import type { RuntimeCapsule } from "@runesmith/core"
import {
  buildDashboardModel,
  buildDashboardModelFromRuntimeCapsule,
  reduceDashboardModel,
} from "../src/dashboard-model"

const capsule: RuntimeCapsule = {
  version: 1,
  updatedAt: "2026-05-27T00:00:00.000Z",
  runtime: {
    graphs: {
      mission_live: {
        mission: {
          id: "mission_live",
          goal: "Ship live dashboard",
          status: "running",
          rootTaskId: "task_live",
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:05:00.000Z",
        },
        tasks: {
          task_live: {
            id: "task_live",
            missionId: "mission_live",
            title: "Wire capsule feed",
            description: "Render persisted OpenCode mission state in the dashboard.",
            status: "running",
            requiredCapabilities: ["typescript"],
            assignedAgentId: "agent_atlas",
            createdAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:05:00.000Z",
          },
          task_review: {
            id: "task_review",
            missionId: "mission_live",
            title: "Review dashboard adapter",
            description: "Check capsule mapping and UI behavior.",
            status: "complete",
            requiredCapabilities: ["testing"],
            assignedAgentId: "agent_oracle",
            createdAt: "2026-05-27T00:00:00.000Z",
            updatedAt: "2026-05-27T00:05:00.000Z",
          },
        },
        events: [
          {
            id: "event_live",
            type: "task.claimed",
            at: "2026-05-27T00:05:00.000Z",
            targetId: "task_live",
            message: "Atlas claimed the capsule adapter task",
          },
        ],
      },
    },
    ledgers: {
      mission_live: {
        evidence: {
          evidence_file: {
            id: "evidence_file",
            taskId: "task_live",
            type: "file-change",
            summary: "Added capsule adapter",
            payload: { filePath: "packages/dashboard/src/dashboard-model.ts" },
            createdAt: "2026-05-27T00:04:00.000Z",
          },
          evidence_test: {
            id: "evidence_test",
            taskId: "task_review",
            type: "test-result",
            summary: "Dashboard tests passed",
            payload: {},
            createdAt: "2026-05-27T00:05:00.000Z",
          },
        },
      },
    },
    leases: {
      leases: {
        lease_live: {
          id: "lease_live",
          targetId: "task_live",
          holder: "atlas",
          purpose: "task.claim",
          idempotencyKey: "claim-live",
          expiresAt: "2026-05-27T00:10:00.000Z",
          status: "active",
          createdAt: "2026-05-27T00:05:00.000Z",
        },
      },
    },
    contracts: {
      agent_atlas: {
        id: "agent_atlas",
        displayName: "Atlas",
        description: "Runtime implementer",
        capabilities: ["typescript"],
        allowedTools: ["read", "edit", "test"],
        modelPolicy: {
          primary: "gpt-5.1-codex",
          fallbacks: ["claude-sonnet"],
        },
        fileScope: ["packages/dashboard/**"],
        completionCriteria: ["Adapter renders capsule tasks"],
        requiredEvidence: ["file-change", "test-result"],
        fallbacks: ["agent_oracle"],
      },
      agent_oracle: {
        id: "agent_oracle",
        displayName: "Oracle",
        description: "Verification agent",
        capabilities: ["testing"],
        allowedTools: ["read", "test"],
        modelPolicy: {
          primary: "gpt-5.1-codex",
          fallbacks: [],
        },
        fileScope: ["packages/dashboard/**"],
        completionCriteria: ["Tests passed"],
        requiredEvidence: ["test-result"],
        fallbacks: [],
      },
    },
  },
}

describe("dashboard model", () => {
  test("derives mission counts from seeded mission tasks", () => {
    const model = buildDashboardModel()

    expect(model.metrics).toEqual({
      running: 2,
      verified: 2,
      stale: 1,
      blocked: 1,
    })
    expect(model.selectedTask.id).toBe("task_runtime_kernel")
    expect(model.timeline.at(0)?.label).toBe("Lease granted")
    expect(model.dispatchMatrix).toMatchObject({
      status: "serial",
      activeSlotCount: 2,
      blockedSlotCount: 2,
    })
    expect(model.dispatchMatrix.slots.map((slot) => [slot.taskId, slot.lane, slot.recommendedAgentId])).toEqual([
      ["task_runtime_kernel", "active", "agent_atlas"],
      ["task_contract_gate", "complete", "agent_oracle"],
      ["task_dashboard_shell", "active", "agent_artificer"],
      ["task_harness_tests", "complete", "agent_oracle"],
      ["task_publish_repo", "blocked", "agent_steward"],
      ["task_windows_paths", "blocked", "agent_scout"],
    ])
  })

  test("selects a mission task for inspection", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "select-task",
      taskId: "task_windows_paths",
    })

    expect(next.selectedTask.id).toBe("task_windows_paths")
    expect(next.selectedTaskId).toBe("task_windows_paths")
    expect(next.notice).toBe("Inspecting Windows path resolver.")
  })

  test("verifies the selected task and records evidence", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "verify-selected" })

    expect(next.selectedTask.status).toBe("verified")
    expect(next.selectedTask.lane).toBe("Verify")
    expect(next.selectedTask.evidence).toContain("test-result")
    expect(next.metrics).toEqual({
      running: 1,
      verified: 3,
      stale: 1,
      blocked: 1,
    })
    expect(next.timeline.at(0)?.label).toBe("Verification complete")
  })

  test("runs the selected proof plan in local fallback mode", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "run-proof-plan" })

    expect(next.selectedTask.status).toBe("verified")
    expect(next.selectedTask.evidence).toContain("test-result")
    expect(next.notice).toBe("Proof plan passed for Mission runtime kernel.")
    expect(next.commandLog.at(0)).toMatchObject({
      label: "Proof plan passed",
      tone: "verified",
    })
  })

  test("recovers stale work and updates the board metrics", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "recover-stale" })

    expect(next.tasks.find((task) => task.id === "task_windows_paths")?.status).toBe("running")
    expect(next.tasks.find((task) => task.id === "task_windows_paths")?.lane).toBe("Build")
    expect(next.metrics).toEqual({
      running: 3,
      verified: 2,
      stale: 0,
      blocked: 1,
    })
    expect(next.timeline.at(0)?.label).toBe("Recovery dispatched")
  })

  test("switches dashboard sections", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "select-view",
      view: "covenant",
    })

    expect(next.activeView).toBe("covenant")
    expect(next.notice).toBe("Showing Runic Covenant autonomous workflow.")
  })

  test("runs an autopilot cycle that recovers stale work before verification", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "run-autopilot-cycle" })

    expect(next.tasks.find((task) => task.id === "task_windows_paths")?.status).toBe("running")
    expect(next.metrics.stale).toBe(0)
    expect(next.timeline.at(0)?.label).toBe("Autopilot recovered")
    expect(next.commandLog.at(0)?.label).toBe("Recovered stale lease")
    expect(next.operationalScore).toBeGreaterThan(model.operationalScore)
    expect(next.loopPulse.nextAction.id).toBe("resolve-blocker")
    expect(next.missionMemory.status).toBe("blocked")
    expect(next.missionMemory.handoff).toBe(
      "Resolve blocker for task_publish_repo: The active task is blocked and needs explicit evidence, recovery, or user input.",
    )
  })

  test("forges a mission directive into a selected plan task", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "forge-directive",
      prompt: "Wire OpenCode session replay",
    })

    expect(next.selectedTask.title).toBe("Wire OpenCode session replay")
    expect(next.selectedTask.lane).toBe("Plan")
    expect(next.selectedTask.status).toBe("running")
    expect(next.tasks).toHaveLength(model.tasks.length + 1)
    expect(next.timeline.at(0)?.label).toBe("Directive forged")
  })

  test("toggles policy gates and records the command", () => {
    const model = buildDashboardModel()
    const policy = model.policies.find((item) => item.id === "policy_tool_scope")!

    const next = reduceDashboardModel(model, {
      type: "toggle-policy",
      policyId: policy.id,
    })

    expect(next.policies.find((item) => item.id === policy.id)?.enabled).toBe(false)
    expect(next.commandLog.at(0)?.label).toBe("Policy disabled")
    expect(next.notice).toBe("Disabled Tool scope firewall.")
  })

  test("creates a mission snapshot with current counts", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "create-snapshot" })

    expect(next.snapshots).toHaveLength(model.snapshots.length + 1)
    expect(next.snapshots.at(0)?.label).toBe("Manual checkpoint")
    expect(next.snapshots.at(0)?.tasks).toBe(model.tasks.length)
    expect(next.timeline.at(0)?.label).toBe("Snapshot sealed")
  })

  test("selects an agent and focuses the agent mesh", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "select-agent",
      agentId: "agent_scout",
    })

    expect(next.activeView).toBe("agents")
    expect(next.selectedAgentId).toBe("agent_scout")
    expect(next.notice).toBe("Focused Scout in the agent mesh.")
  })

  test("marks command notifications as read", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "mark-notifications-read" })

    expect(next.commandLog).toHaveLength(0)
    expect(next.notice).toBe("Marked command notifications read.")
  })

  test("advances the covenant loop and records the next autonomous stage", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "advance-covenant-stage" })

    expect(next.activeView).toBe("covenant")
    expect(next.activeCovenantStage.id).toBe("map")
    expect(next.commandLog.at(0)?.label).toBe("Covenant advanced")
    expect(next.notice).toBe("Runic Covenant advanced to Mission Map.")
  })

  test("builds dashboard state from a persisted runtime capsule", () => {
    const model = buildDashboardModelFromRuntimeCapsule(capsule)

    expect(model.tasks.map((task) => task.id)).toEqual(["task_live", "task_review"])
    expect(model.selectedTask.title).toBe("Wire capsule feed")
    expect(model.selectedTask.evidence).toEqual(["file-change"])
    expect(model.metrics).toEqual({
      running: 1,
      verified: 1,
      stale: 0,
      blocked: 0,
    })
    expect(model.agents.map((agent) => agent.name)).toEqual(["Atlas", "Oracle"])
    expect(model.agents[0]?.activeLease).toBe("task_live")
    expect(model.snapshots[0]?.label).toBe("Live capsule")
    expect(model.loopPulse.nextAction.label).toBe("Capture proof")
    expect(model.loopPulse.executionPlan.map((step) => step.label)).toEqual([
      "Run targeted verification",
      "Advance evidence gate",
    ])
    expect(model.loopPulse.runes.map((rune) => rune.name)).toContain("Proofwright")
    expect(model.runebook.activeCard).toMatchObject({
      id: "proofwright-proof-gate",
      title: "Proofwright proof gate",
      autonomy: "auto",
    })
    expect(model.protocolDeck.active).toMatchObject({
      id: "proofwright-proof-protocol",
      name: "Proofwright Proof Protocol",
      mode: "auto",
    })
    expect(model.missionMap).toMatchObject({
      status: "mapped",
      missionId: "mission_live",
      taskCount: 2,
      nextTaskId: "task_live",
    })
    expect(model.scopeSentinel).toMatchObject({
      status: "clear",
      missionId: "mission_live",
      taskId: "task_live",
      agentId: "agent_atlas",
      changes: [
        {
          path: "packages/dashboard/src/dashboard-model.ts",
          status: "in-scope",
        },
      ],
      findings: [],
    })
    expect(model.redlineProof).toMatchObject({
      status: "missing",
      missionId: "mission_live",
      taskId: "task_live",
      summary: "Redline Proof missing for task_live: implementation changed before focused failing proof was captured.",
      implementationChanges: ["packages/dashboard/src/dashboard-model.ts"],
    })
    expect(model.planContract).toMatchObject({
      status: "ready",
      missionId: "mission_live",
      taskCount: 2,
      implementationTaskCount: 1,
      summary: "Plan contract ready for mission_live: 1 focused implementation slice is mapped with proof evidence.",
    })
    expect(model.dispatchMatrix).toMatchObject({
      status: "serial",
      missionId: "mission_live",
      readySlotCount: 0,
      activeSlotCount: 1,
      blockedSlotCount: 0,
      summary: "Dispatch Matrix serial for mission_live: 1 dispatch slot is active or ready.",
    })
    expect(model.repairContract).toMatchObject({
      status: "idle",
      missionId: "mission_live",
      taskId: "task_live",
      summary: "No active failed diagnostic is waiting for repair on task_live.",
      repairChanges: [],
    })
    expect(model.reviewLens).toMatchObject({
      status: "waiting-for-proof",
      missionId: "mission_live",
      implementationTaskId: "task_live",
      findings: [
        {
          severity: "warning",
          summary: "Missing test-result evidence for task_live.",
        },
        {
          severity: "warning",
          summary: "Redline Proof missing for task_live: implementation changed before focused failing proof was captured.",
        },
      ],
    })
    expect(model.sealAudit).toMatchObject({
      status: "collecting-proof",
      missionId: "mission_live",
      implementationTaskId: "task_live",
      summary: "mission_live needs stronger proof before any completion claim.",
    })
    expect(model.sealAudit.checks.map((check) => [check.id, check.status])).toEqual([
      ["mission-state", "passed"],
      ["proof-gate", "attention"],
      ["redline-gate", "attention"],
      ["repair-gate", "passed"],
      ["scope-gate", "passed"],
      ["review-gate", "attention"],
      ["seal-decision", "blocked"],
    ])
    expect(model.runebook.activeCard.commands.map((command) => command.command)).toEqual(["bun test"])
    expect(model.missionMemory.status).toBe("needs-proof")
    expect(model.missionMemory.handoff).toBe(
      "Capture proof for task_live: record test-result evidence before completion.",
    )
    expect(model.proofPlan.status).toBe("needs-proof")
    expect(model.proofPlan.commands.map((command) => command.command)).toEqual(["bun test"])
    expect(model.notice).toBe("Loaded runtime capsule from 2026-05-27T00:00:00.000Z.")
  })

  test("places runtime tasks with failed verification into the repair lane", () => {
    const repairCapsule: RuntimeCapsule = {
      ...capsule,
      runtime: {
        ...capsule.runtime,
        ledgers: {
          mission_live: {
            evidence: {
              ...capsule.runtime.ledgers.mission_live.evidence,
              evidence_diagnostic: {
                id: "evidence_diagnostic",
                taskId: "task_live",
                type: "diagnostic",
                summary: "Dashboard capsule tests failed",
                payload: { command: "bun test packages/dashboard/tests", exitCode: 1 },
                createdAt: "2026-05-27T00:06:00.000Z",
              },
            },
          },
        },
      },
    }

    const model = buildDashboardModelFromRuntimeCapsule(repairCapsule)

    expect(model.selectedTask.id).toBe("task_live")
    expect(model.selectedTask.lane).toBe("Repair")
    expect(model.selectedTask.evidence).toContain("diagnostic")
    expect(model.loopPulse.stage.id).toBe("repair")
    expect(model.loopPulse.nextAction.label).toBe("Repair diagnostic")
    expect(model.loopPulse.diagnostics).toEqual(["Dashboard capsule tests failed"])
    expect(model.loopPulse.executionPlan.map((step) => step.id)).toEqual([
      "acknowledge-diagnostic",
      "repair-smallest-cause",
      "rerun-failing-command",
    ])
    expect(model.loopPulse.executionPlan[1]).toMatchObject({
      label: "Hypothesis repair",
      instruction: "State a falsifiable repair hypothesis, change one repair variable, and link the edit to the active diagnostic.",
    })
    expect(model.loopPulse.runes.map((rune) => rune.name)).toContain("Faultwright")
    expect(model.runebook.activeCard).toMatchObject({
      id: "faultwright-repair",
      title: "Faultwright repair loop",
      autonomy: "guarded",
    })
    expect(model.protocolDeck.active).toMatchObject({
      id: "faultwright-repair-protocol",
      name: "Faultwright Repair Protocol",
      mode: "guarded",
    })
    expect(model.runebook.activeCard.commands.map((command) => command.command)).toEqual([
      "bun test packages/dashboard/tests",
      "bun test",
    ])
    expect(model.missionMemory.status).toBe("needs-repair")
    expect(model.missionMemory.handoff).toBe(
      "Repair task_live: Dashboard capsule tests failed. State a falsifiable hypothesis, change one repair variable, then rerun proof.",
    )
    expect(model.proofPlan.commands.map((command) => command.command)).toEqual([
      "bun test packages/dashboard/tests",
      "bun test",
    ])
  })

  test("surfaces repeated failed repairs as a Faultline breakpoint", () => {
    const faultlineCapsule: RuntimeCapsule = {
      ...capsule,
      runtime: {
        ...capsule.runtime,
        ledgers: {
          mission_live: {
            evidence: {
              ...capsule.runtime.ledgers.mission_live.evidence,
              evidence_diagnostic_1: {
                id: "evidence_diagnostic_1",
                taskId: "task_live",
                type: "diagnostic",
                summary: "Dashboard capsule tests failed attempt 1",
                payload: { command: "bun test packages/dashboard/tests --attempt=1", exitCode: 1 },
                createdAt: "2026-05-27T00:06:00.000Z",
              },
              evidence_diagnostic_2: {
                id: "evidence_diagnostic_2",
                taskId: "task_live",
                type: "diagnostic",
                summary: "Dashboard capsule tests failed attempt 2",
                payload: { command: "bun test packages/dashboard/tests --attempt=2", exitCode: 1 },
                createdAt: "2026-05-27T00:07:00.000Z",
              },
              evidence_diagnostic_3: {
                id: "evidence_diagnostic_3",
                taskId: "task_live",
                type: "diagnostic",
                summary: "Dashboard capsule tests failed attempt 3",
                payload: { command: "bun test packages/dashboard/tests --attempt=3", exitCode: 1 },
                createdAt: "2026-05-27T00:08:00.000Z",
              },
            },
          },
        },
      },
    }

    const model = buildDashboardModelFromRuntimeCapsule(faultlineCapsule)

    expect(model.selectedTask.id).toBe("task_live")
    expect(model.selectedTask.lane).toBe("Repair")
    expect(model.loopPulse.stage.id).toBe("faultline")
    expect(model.loopPulse.nextAction).toMatchObject({
      id: "review-faultline",
      label: "Review faultline",
      priority: "critical",
    })
    expect(model.loopPulse.executionPlan.map((step) => step.id)).toEqual([
      "summarize-failed-repairs",
      "question-architecture",
      "choose-breakthrough-path",
    ])
    expect(model.loopPulse.runes.map((rune) => rune.name)).toContain("Faultline")
    expect(model.runebook.activeCard).toMatchObject({
      id: "faultline-breakpoint",
      title: "Faultline architecture breakpoint",
      autonomy: "guarded",
    })
    expect(model.protocolDeck.active).toMatchObject({
      id: "faultline-breakpoint-protocol",
      name: "Faultline Breakpoint Protocol",
      mode: "guarded",
    })
    expect(model.missionMemory.status).toBe("needs-architecture")
    expect(model.missionMemory.handoff).toBe(
      "Review faultline for task_live: 3 failed proof attempts. Question architecture before another repair.",
    )
    expect(model.proofPlan.commands[0]?.command).toBe("bun test packages/dashboard/tests --attempt=3")
  })

  test("hydrates the dashboard from a runtime capsule action", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, {
      type: "load-runtime-capsule",
      capsule,
    })

    expect(next.tasks).toHaveLength(2)
    expect(next.selectedTask.id).toBe("task_live")
    expect(next.commandLog.at(0)?.label).toBe("Capsule loaded")
    expect(next.timeline.at(0)?.detail).toContain("Ship live dashboard")
  })

  test("keeps seeded dashboard state when no runtime capsule is available", () => {
    const model = buildDashboardModel()

    const next = reduceDashboardModel(model, { type: "runtime-capsule-unavailable" })

    expect(next.tasks).toHaveLength(model.tasks.length)
    expect(next.selectedTask.id).toBe(model.selectedTask.id)
    expect(next.notice).toBe("No runtime capsule found; showing seeded mission control.")
  })
})
