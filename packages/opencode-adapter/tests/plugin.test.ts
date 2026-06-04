import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  createRuntime,
  createCovenantTaskPlan,
  defaultProjectConfigPath,
  defaultRuntimeCapsulePath,
  deriveReviewLens,
  loadProjectConfig,
  loadRuntimeCapsule,
  saveRuntimeCapsule,
  type RuntimeStoreHost,
} from "@runesmith/core"
import {
  createRunesmithOpenCodePlugin,
  createRunesmithPlugin,
  runOpenCodeShellProofCommand,
  type PluginRuntimeStore,
} from "../src/plugin"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

function countingIds() {
  const counts = new Map<string, number>()

  return (prefix: string) => {
    const next = (counts.get(prefix) ?? 0) + 1
    counts.set(prefix, next)
    return `${prefix}_${next}`
  }
}

function createMemoryRuntimeHost(
  initialFiles: Record<string, string> = {},
): RuntimeStoreHost & { files: Map<string, string> } {
  const files = new Map(Object.entries(initialFiles))

  return {
    files,
    exists(path) {
      return files.has(path)
    },
    readText(path) {
      const value = files.get(path)
      if (value === undefined) throw new Error(`missing file: ${path}`)

      return value
    },
    writeText(path, text) {
      files.set(path, text)
    },
  }
}

describe("opencode adapter", () => {
  test("registers the default Runesmith agent mesh without user-authored contracts", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    createRunesmithPlugin({ runtime })

    expect(Object.keys(runtime.snapshot().contracts)).toEqual([
      "agent_atlas",
      "agent_oracle",
      "agent_artificer",
      "agent_scout",
      "agent_steward",
    ])
  })

  test("infers implementation file scopes for clean OpenCode app repos", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: {
        repositoryFiles: [
          "package.json",
          "src/math.js",
          "test/math.test.js",
        ],
      },
    })

    expect(runtime.snapshot().contracts.agent_atlas.fileScope).toEqual(
      expect.arrayContaining(["src/**", "test/**"]),
    )

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Add multiply support to a clean app repo",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: {
          filePath: "E:\\dev\\Oh-my\\clean-app\\src\\math.js",
        },
      },
      { output: "Edit applied successfully." } as OpenCodeToolOutput,
    )
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: {
          filePath: "E:\\dev\\Oh-my\\clean-app\\test\\math.test.js",
        },
      },
      { output: "Edit applied successfully." } as OpenCodeToolOutput,
    )
    await plugin["tool.execute.after"]?.(
      {
        tool: "bash",
        args: {
          command: "npm test",
          workdir: "E:\\dev\\Oh-my\\clean-app",
        },
      },
      {
        output: "# pass 2 # fail 0",
        metadata: {
          exit: 0,
          output: "# pass 2 # fail 0",
        },
      } as OpenCodeToolOutput,
    )

    const reviewLens = deriveReviewLens(runtime.snapshot())
    expect(reviewLens.status).not.toBe("blocked")
    expect(reviewLens.findings.map((finding) => finding.summary)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("outside agent_atlas file scope"),
      ]),
    )
  })

  test("infers vanilla static app scopes for root HTML CSS and JS projects", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: {
        repositoryFiles: [
          "package.json",
          "index.html",
          "js/2048.js",
          "js/game.js",
          "css/2048.css",
          "tests/game.test.js",
        ],
      },
    })

    expect(runtime.snapshot().contracts.agent_atlas.fileScope).toEqual(
      expect.arrayContaining(["js/**", "css/**", "tests/**", "index.html", "package.json"]),
    )

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Build a polished 2048 game",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: {
          filePath: "E:\\dev\\up_code\\js\\2048.js",
        },
      },
      { output: "Edit applied successfully." } as OpenCodeToolOutput,
    )
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: {
          filePath: "E:\\dev\\up_code\\css\\2048.css",
        },
      },
      { output: "Edit applied successfully." } as OpenCodeToolOutput,
    )
    await plugin["tool.execute.after"]?.(
      {
        tool: "bash",
        args: {
          command: "node --test tests/game.test.js",
          workdir: "E:\\dev\\up_code",
        },
      },
      {
        output: "# pass 20 # fail 0",
        metadata: {
          exit: 0,
          output: "# pass 20 # fail 0",
        },
      } as OpenCodeToolOutput,
    )

    const reviewLens = deriveReviewLens(runtime.snapshot())
    expect(reviewLens.findings.map((finding) => finding.summary)).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("outside agent_atlas file scope"),
      ]),
    )
  })

  test("infers implementation file scopes from package manifests with a UTF-8 BOM", async () => {
    const originalCwd = process.cwd()
    const directory = await mkdtemp(join(tmpdir(), "runesmith-bom-app-"))

    try {
      await mkdir(join(directory, "src"), { recursive: true })
      await mkdir(join(directory, "test"), { recursive: true })
      await writeFile(
        join(directory, "package.json"),
        '\ufeff{"name":"runesmith-bom-app","type":"module","scripts":{"test":"node --test"}}\n',
      )
      await writeFile(join(directory, "src", "math.js"), "export const value = 1\n")
      await writeFile(join(directory, "test", "math.test.js"), "import 'node:test'\n")

      process.chdir(directory)
      const runtime = createRuntime({ idFactory: ids, now: fixedNow })
      createRunesmithPlugin({ runtime })

      expect(runtime.snapshot().contracts.agent_atlas.fileScope).toEqual(
        expect.arrayContaining(["src/**", "test/**", "package.json"]),
      )
    } finally {
      process.chdir(originalCwd)
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("keeps documentation paths inside project-aware implementation review scopes", () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    createRunesmithPlugin({
      runtime,
      proofPlanOptions: {
        repositoryFiles: [
          "package.json",
          "src/plugin/session-status-normalizer.ts",
          "src/plugin/session-status-normalizer.test.ts",
          "docs/reference/known-issues.md",
        ],
      },
    })

    expect(runtime.snapshot().contracts.agent_atlas.fileScope).toEqual(
      expect.arrayContaining(["src/**", "docs/**", "package.json"]),
    )
    expect(runtime.snapshot().contracts.agent_oracle.fileScope).toEqual(
      expect.arrayContaining(["src/**", "docs/**", "package.json"]),
    )
  })

  test("starts missions through adapter tools", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    const response = await plugin.tool.runesmith_mission_start.execute({
      goal: "Build an OpenCode mission runtime",
      requiredCapabilities: ["typescript"],
    })

    expect(JSON.parse(response.output)).toEqual({
      ok: true,
      value: {
        missionId: "mission_alpha",
        rootTaskId: "task_alpha",
        status: "running",
      },
    })
  })

  test("claims, records evidence, and completes tasks through adapter tools", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_mission_start.execute({
      goal: "Build completion gate",
      requiredCapabilities: ["typescript"],
    })
    const claimed = await plugin.tool.runesmith_task_claim.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
    })

    expect(JSON.parse(claimed.output)).toMatchObject({
      ok: true,
      value: {
        taskId: "task_alpha",
        status: "running",
        leaseId: "lease_alpha",
      },
    })

    await plugin.tool.runesmith_task_evidence.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed runtime",
      payload: { files: ["packages/core/src/runtime.ts"] },
      evidenceId: "evidence_file",
    })
    await plugin.tool.runesmith_task_evidence.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      type: "test-result",
      summary: "Tests passed",
      payload: { command: "bun test packages/core/tests", exitCode: 0 },
      evidenceId: "evidence_test",
    })

    const completed = await plugin.tool.runesmith_task_complete.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })

    expect(JSON.parse(completed.output)).toEqual({
      ok: true,
      value: {
        taskId: "task_alpha",
        missionStatus: "complete",
        status: "complete",
      },
    })
  })

  test("manual evidence and completion tools default to the active task when OpenCode omits ids", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    runtime.startMission({
      goal: "Finish review without exposing task ids",
      taskPlan: [
        {
          key: "review",
          title: "Review: Finish review without exposing task ids",
          description: "Record a review decision without requiring the model to pass ids.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_oracle",
      holder: "oracle",
      idempotencyKey: "claim-review",
      ttlMs: 30_000,
    })
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")

    const evidence = await plugin.tool.runesmith_task_evidence.execute({
      description: "Attach decision evidence",
    } as any)
    expect(JSON.parse(evidence.output)).toMatchObject({
      ok: true,
      value: {
        taskId: "task_alpha",
        type: "decision",
      },
    })

    const completed = await plugin.tool.runesmith_task_complete.execute({
      description: "Complete review task",
    } as any)

    expect(JSON.parse(completed.output)).toMatchObject({
      ok: true,
      value: {
        taskId: "task_alpha",
        status: "complete",
      },
    })
  })

  test("infers manual evidence type and summary from nested OpenCode evidence objects", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    runtime.startMission({
      goal: "Review docs proof without exposing task ids",
      taskPlan: [
        {
          key: "review",
          title: "Review: docs proof",
          description: "Record a decision from a nested OpenCode evidence object.",
          requiredCapabilities: ["testing"],
          requiredEvidence: ["decision"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_oracle",
      holder: "oracle",
      idempotencyKey: "claim-nested-review",
      ttlMs: 30_000,
    })

    const evidence = await plugin.tool.runesmith_task_evidence.execute({
      evidence: {
        decision: "Scope sentinel finding is a planning artifact; the docs change is correct and tests pass.",
      },
    } as any)

    expect(JSON.parse(evidence.output)).toMatchObject({
      ok: true,
      value: {
        taskId: "task_alpha",
        type: "decision",
      },
    })
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual([
      expect.objectContaining({
        type: "decision",
        summary: expect.stringContaining("Scope sentinel finding"),
        payload: expect.objectContaining({
          evidence: expect.objectContaining({
            decision: expect.stringContaining("docs change is correct"),
          }),
        }),
      }),
    ])
  })

  test("manual task completion cannot bypass seal audit blockers", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    runtime.startMission({
      goal: "Do not manually seal scope drift from OpenCode",
      taskPlan: createCovenantTaskPlan("Do not manually seal scope drift from OpenCode"),
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
        summary: "Changed runtime and environment",
        payload: { files: ["packages/opencode-adapter/src/plugin.ts", ".env"] },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha-review",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_review_decision",
        taskId: "task_alpha_review",
        type: "decision",
        summary: "Manual review accepted the scope exception",
        payload: { stage: "review", verdict: "approved" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_atlas",
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_seal",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha-seal",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_seal_decision",
        taskId: "task_alpha_seal",
        type: "decision",
        summary: "Manual seal accepted the scope exception",
        payload: { stage: "seal", verdict: "sealed" },
        createdAt: "2026-05-27T00:03:00.000Z",
      },
    })

    const completed = await plugin.tool.runesmith_task_complete.execute({})

    expect(JSON.parse(completed.output)).toMatchObject({
      ok: true,
      value: {
        status: "waiting-for-evidence",
        taskId: "task_alpha_seal",
        decisionGuard: {
          stage: "seal",
          status: "blocked",
        },
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_seal.status).toBe("running")
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("running")
  })

  test("manual seal decision evidence advances a clear Covenant mission without a second tool call", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    runtime.startMission({
      goal: "Seal after manual evidence from OpenCode",
      taskPlan: createCovenantTaskPlan("Seal after manual evidence from OpenCode"),
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
        summary: "Changed OpenCode adapter",
        payload: { files: ["packages/opencode-adapter/src/plugin.ts"] },
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_test",
        taskId: "task_alpha",
        type: "test-result",
        summary: "OpenCode adapter tests passed",
        payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_oracle",
      holder: "oracle",
      idempotencyKey: "claim-task-alpha-review",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_review_decision",
        taskId: "task_alpha_review",
        type: "decision",
        summary: "Review approved verified adapter evidence",
        payload: { stage: "review", verdict: "approved" },
        createdAt: "2026-05-27T00:02:00.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_review",
      contractId: "agent_oracle",
    })
    runtime.claimTask({
      missionId: "mission_alpha",
      taskId: "task_alpha_seal",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "claim-task-alpha-seal",
      ttlMs: 30_000,
    })

    const evidence = await plugin.tool.runesmith_task_evidence.execute({
      description: "Seal decision evidence - mission complete",
    } as any)

    expect(JSON.parse(evidence.output)).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        taskId: "task_alpha_seal",
        missionStatus: "complete",
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_seal.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("exposes the Runic Covenant and injects it into OpenCode once", async () => {
    const plugin = createRunesmithPlugin()

    const status = await plugin.tool.runesmith_covenant_status.execute({})
    const parsed = JSON.parse(status.output)
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        name: "Runic Covenant",
        installMode: "automatic",
        stageCount: 10,
      },
    })
    expect(parsed.value.stages.map((stage: any) => stage.id)).toContain("repair")
    expect(parsed.value.stages.map((stage: any) => stage.id)).toContain("faultline")
    expect(parsed.value.stages.find((stage: any) => stage.id === "repair")).toMatchObject({
      id: "repair",
      name: "Repair Gate",
    })
    expect(parsed.value.stages.find((stage: any) => stage.id === "faultline")).toMatchObject({
      id: "faultline",
      name: "Faultline Breakpoint",
    })

    const transform = plugin.experimental.chat.system.transform
    const first = await transform({}, "Base system prompt")
    const second = await transform({}, first)

    expect(first).toContain("Base system prompt")
    expect(first).toContain("Runic Covenant")
    expect(second.match(/Runic Covenant/g)).toHaveLength(1)
  })

  test("reports live covenant brief and loop pulse from runtime state", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Ship live Runesmith OS status",
    })

    const status = await plugin.tool.runesmith_covenant_status.execute({})

    expect(JSON.parse(status.output)).toMatchObject({
      ok: true,
      value: {
        controlBrief: {
          status: "active",
          missionId: "mission_alpha",
          taskId: "task_alpha",
          stage: {
            id: "forge",
            name: "Forge",
          },
          missingEvidence: ["file-change", "test-result"],
        },
        loopPulse: {
          health: "attention",
          nextAction: {
            id: "refine-plan",
            label: "Refine plan",
          },
        },
        reviewLens: {
          status: "waiting-for-proof",
          missionId: "mission_alpha",
          implementationTaskId: "task_alpha",
          reviewTaskId: "task_alpha_review",
        },
        scopeSentinel: {
          status: "attention",
          missionId: "mission_alpha",
          taskId: "task_alpha",
          agentId: "agent_atlas",
        },
        redlineProof: {
          status: "not-applicable",
          summary: "Redline Proof not required for task_alpha: no implementation file changes are captured.",
        },
        repairContract: {
          status: "idle",
          summary: "No active failed diagnostic is waiting for repair on task_alpha.",
        },
        planContract: {
          status: "thin",
          summary: "Plan contract thin for mission_alpha: Forge/Review/Seal exists, but implementation has no concrete execution slices yet.",
        },
        dispatchMatrix: {
          status: "serial",
          summary: "Dispatch Matrix serial for mission_alpha: 1 dispatch slot is active or ready.",
          activeSlotCount: 1,
        },
        workerDispatch: {
          status: "active",
          summary: "Worker Dispatch has 1 leased packet for mission_alpha.",
          packetCount: 1,
          packets: [
            {
              id: "worker_mission_alpha_task_alpha_agent_atlas",
              state: "leased",
              taskId: "task_alpha",
              agentId: "agent_atlas",
              holder: "runesmith-autopilot",
            },
          ],
        },
        sealAudit: {
          status: "collecting-proof",
          missionId: "mission_alpha",
          implementationTaskId: "task_alpha",
          reviewTaskId: "task_alpha_review",
          sealTaskId: "task_alpha_seal",
        },
        runebook: {
          activeCard: {
            id: "pathfinder-plan-refinery",
            title: "Pathfinder plan refinery",
            autonomy: "auto",
          },
        },
        protocolDeck: {
          active: {
            id: "pathfinder-plan-refinery-protocol",
            name: "Pathfinder Plan Refinery Protocol",
            mode: "auto",
          },
        },
        activeRunes: [
          {
            name: "Forge Trace",
          },
          {
            name: "Proofwright",
          },
        ],
      },
    })
  })

  test("persists mission mutations to a runtime store", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const store: PluginRuntimeStore = {
      async save(snapshot) {
        writes.push(JSON.stringify(snapshot))
      },
    }
    const plugin = createRunesmithPlugin({ runtime, runtimeStore: store })

    await plugin.tool.runesmith_mission_start.execute({
      goal: "Persist OpenCode mission",
    })
    await plugin.tool.runesmith_task_claim.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      contractId: "agent_atlas",
      holder: "atlas",
      idempotencyKey: "claim-task-alpha",
    })

    expect(writes).toHaveLength(2)
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
  })

  test("direct OpenCode plugin creates and persists the default runtime capsule without setup", async () => {
    const host = createMemoryRuntimeHost()
    const plugin = await createRunesmithOpenCodePlugin({
      host,
      idFactory: ids,
      now: fixedNow,
    })

    const initial = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
    const config = await loadProjectConfig(host, defaultProjectConfigPath)
    expect(initial.ok).toBe(true)
    expect(config.ok).toBe(true)
    if (!initial.ok || !initial.value) throw new Error("expected package plugin to create the runtime capsule")
    if (!config.ok || !config.value) throw new Error("expected package plugin to create project config")
    expect(initial.value.runtime.graphs).toEqual({})
    expect(config.value.runtimeDir).toBe(".runesmith/runtime")
    expect(host.files.get(".runesmith/proof/browser-smoke.mjs")).toContain("Runesmith browser smoke")

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Zero-config package persistence",
    })

    const saved = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
    expect(saved.ok).toBe(true)
    if (!saved.ok || !saved.value) throw new Error("expected package plugin to persist mission state")
    expect(saved.value.runtime.graphs.mission_alpha.mission.goal).toBe("Zero-config package persistence")
    expect(saved.value.runtime.graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
  })

  test("direct OpenCode plugin persists to the project runtimeDir capsule", async () => {
    const customCapsulePath = ".runesmith/custom-runtime/capsule.json"
    const host = createMemoryRuntimeHost({
      [defaultProjectConfigPath]: `${JSON.stringify({
        version: 1,
        runtimeDir: ".runesmith/custom-runtime",
        defaultStaleAfterMs: 120_000,
      }, null, 2)}\n`,
    })
    const plugin = await createRunesmithOpenCodePlugin({
      host,
      idFactory: ids,
      now: fixedNow,
    })

    const initial = await loadRuntimeCapsule(host, customCapsulePath)
    expect(initial.ok).toBe(true)
    if (!initial.ok || !initial.value) throw new Error("expected package plugin to create custom runtime capsule")
    expect(initial.value.runtime.graphs).toEqual({})
    expect(host.files.has(defaultRuntimeCapsulePath)).toBe(false)

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Persist to configured runtime dir",
    })

    const saved = await loadRuntimeCapsule(host, customCapsulePath)
    expect(saved.ok).toBe(true)
    if (!saved.ok || !saved.value) throw new Error("expected package plugin to persist custom runtime capsule")
    expect(saved.value.runtime.graphs.mission_alpha.mission.goal).toBe("Persist to configured runtime dir")
    expect(host.files.has(defaultRuntimeCapsulePath)).toBe(false)
  })

  test("direct OpenCode plugin backs up and repairs an invalid runtime capsule on load", async () => {
    const host = createMemoryRuntimeHost({
      [defaultRuntimeCapsulePath]: "{not json",
    })

    const plugin = await createRunesmithOpenCodePlugin({
      host,
      idFactory: ids,
      now: fixedNow,
    })
    const status = await plugin.tool.runesmith_covenant_status.execute({})
    const repaired = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)

    expect(host.files.get(`${defaultRuntimeCapsulePath}.runesmith.bak`)).toBe("{not json")
    expect(repaired.ok).toBe(true)
    if (!repaired.ok || !repaired.value) throw new Error("expected repaired capsule")
    expect(repaired.value.runtime.graphs).toEqual({})
    expect(JSON.parse(status.output)).toMatchObject({
      ok: true,
      value: {
        controlBrief: {
          status: "idle",
        },
      },
    })
  })

  test("direct OpenCode plugin backs up and repairs an invalid project config on load", async () => {
    const host = createMemoryRuntimeHost({
      [defaultProjectConfigPath]: "{not config",
    })

    await createRunesmithOpenCodePlugin({
      host,
      idFactory: ids,
      now: fixedNow,
    })
    const config = await loadProjectConfig(host, defaultProjectConfigPath)

    expect(host.files.get(`${defaultProjectConfigPath}.runesmith.bak`)).toBe("{not config")
    expect(config.ok).toBe(true)
    if (!config.ok || !config.value) throw new Error("expected repaired project config")
    expect(config.value.runtimeDir).toBe(".runesmith/runtime")
  })

  test("direct OpenCode plugin resumes the existing runtime capsule", async () => {
    const host = createMemoryRuntimeHost()
    const existingRuntime = createRuntime({ idFactory: ids, now: fixedNow })

    existingRuntime.startMission({
      goal: "Resume package capsule",
    })
    await saveRuntimeCapsule(host, {
      path: defaultRuntimeCapsulePath,
      snapshot: existingRuntime.snapshot(),
      now: fixedNow,
    })

    const plugin = await createRunesmithOpenCodePlugin({
      host,
      idFactory: ids,
      now: fixedNow,
    })
    const status = await plugin.tool.runesmith_covenant_status.execute({})

    expect(JSON.parse(status.output)).toMatchObject({
      ok: true,
      value: {
        controlBrief: {
          missionId: "mission_alpha",
          missionGoal: "Resume package capsule",
        },
        loopPulse: {
          missionId: "mission_alpha",
        },
        missionMemory: {
          missionId: "mission_alpha",
          goal: "Resume package capsule",
        },
        missionMap: {
          status: "mapped",
          missionId: "mission_alpha",
          taskCount: 1,
          nextTaskId: "task_alpha",
        },
      },
    })
  })

  test("supports documented OpenCode system and compaction hooks", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    const systemOutput = { system: ["Base system prompt"] }
    await plugin["experimental.chat.system.transform"]?.({}, systemOutput)

    expect(systemOutput.system.join("\n")).toContain("Runic Covenant")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Autopilot")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Mission Memory")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Mission Map")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Plan Contract")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Dispatch Matrix")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Worker Dispatch")
    expect(systemOutput.system.join("\n")).toContain("native OpenCode Task subagents")
    expect(systemOutput.system.join("\n")).toContain("runesmith-scout")
    expect(systemOutput.system.join("\n")).toContain("Lead-blended WBS")
    expect(systemOutput.system.join("\n")).toContain("shadcn/ui")
    expect(systemOutput.system.join("\n")).toContain("browser workflow smoke proof")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Scope Sentinel")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Redline Proof")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Repair Contract")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Review Lens")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Seal Audit")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Production Seal")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Proof Plan")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Runebook")
    expect(systemOutput.system.join("\n")).toContain("Runesmith Protocol Deck")

    await plugin.tool.runesmith_mission_start.execute({
      goal: "Carry state through compaction",
    })

    const compactOutput = { context: [] as string[] }
    await plugin["experimental.session.compacting"]?.({}, compactOutput)

    expect(compactOutput.context.join("\n")).toContain("mission_alpha")
    expect(compactOutput.context.join("\n")).toContain("Carry state through compaction")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Control Brief")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Mission Memory")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Mission Map")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Plan Contract")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Dispatch Matrix")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Worker Dispatch")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Scope Sentinel")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Redline Proof")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Repair Contract")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Review Lens")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Seal Audit")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Production Seal")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Proof Plan")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Runebook")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Protocol Deck")
    expect(compactOutput.context.join("\n")).toContain("Handoff:")
  })

  test("guides Review and Seal through decision gates instead of broad manual evidence", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    expect(plugin.tool.runesmith_task_evidence.description).toContain("Review or Seal")
    expect(plugin.tool.runesmith_task_evidence.description).toContain("decision")
    expect(plugin.tool.runesmith_task_evidence.description).toContain("Do not attach broad file/test summaries")
    expect(plugin.tool.runesmith_task_complete.description).toContain("Review Lens")
    expect(plugin.tool.runesmith_task_complete.description).toContain("Seal Audit")

    const systemOutput = { system: ["Base system prompt"] }
    await plugin["experimental.chat.system.transform"]?.({}, systemOutput)
    const prompt = systemOutput.system.join("\n")

    expect(prompt).toContain("Review or Seal")
    expect(prompt).toContain("Do not attach broad file/test summaries")
    expect(prompt).toContain("Review Lens or Seal Audit says ready")
  })

  test("injects a compact Runesmith bootstrap into the first OpenCode user message once", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })
    const output = {
      messages: [
        {
          info: { role: "system" },
          parts: [{ type: "text", text: "Base system message" }],
        },
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Build a self-driving OpenCode harness" }],
        },
      ],
    }

    await plugin["experimental.chat.messages.transform"]?.({}, output)
    await plugin["experimental.chat.messages.transform"]?.({}, output)

    const userParts = output.messages[1].parts
    expect(userParts[0].text).toContain("<RUNESMITH_BOOTSTRAP>")
    expect(userParts[0].text).toContain("Runesmith is installed as the OpenCode orchestration OS.")
    expect(userParts[0].text).toContain("Current next action: Wait for goal")
    expect(userParts[0].text).toContain("Active protocol: Pathfinder Intake Protocol")
    expect(userParts[0].text).toContain("Plan Contract: idle")
    expect(userParts[0].text).toContain("Dispatch Matrix: idle")
    expect(userParts[0].text).toContain("Worker Dispatch: idle")
    expect(userParts[0].text).toContain("Redline Proof: idle")
    expect(userParts[0].text).toContain("Mission Memory:")
    expect(userParts[0].text).toContain("Repair Contract:")
    expect(userParts[0].text).toContain("Review Lens:")
    expect(userParts[0].text).toContain("Seal Audit:")
    expect(userParts[0].text).toContain("Do not ask the user to load skills or invoke workflows by name.")
    expect(userParts.filter((part) => part.text.includes("<RUNESMITH_BOOTSTRAP>"))).toHaveLength(1)
    expect(userParts[1].text).toBe("Build a self-driving OpenCode harness")
  })

  test("infers the user goal from bootstrapped OpenCode messages without storing Runesmith bootstrap text", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Build a bootstrap-safe mission loop" }],
        },
      ],
    }

    await plugin["experimental.chat.messages.transform"]?.({}, output)
    await plugin.tool.runesmith_autopilot_prepare.execute({
      messages: output.messages,
    })

    expect(runtime.snapshot().graphs.mission_alpha.mission.goal).toBe("Build a bootstrap-safe mission loop")
  })

  test("prepares from the latest transformed user goal when OpenCode calls autopilot with empty args", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })
    const output = {
      messages: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "Add subtract support during opencode run" }],
        },
      ],
    }

    await plugin["experimental.chat.messages.transform"]?.({}, output)

    const prepared = await plugin.tool.runesmith_autopilot_prepare.execute({})

    expect(JSON.parse(prepared.output)).toMatchObject({
      ok: true,
      value: {
        goal: "Add subtract support during opencode run",
        missionId: "mission_alpha",
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.mission.goal).toBe(
      "Add subtract support during opencode run",
    )
  })

  test("sanitizes explicit goal values that accidentally include Runesmith bootstrap text", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: [
        "<RUNESMITH_BOOTSTRAP>",
        "Runesmith is installed as the OpenCode orchestration OS.",
        "</RUNESMITH_BOOTSTRAP>",
        "Build a direct-goal bootstrap guard",
      ].join("\n"),
    })

    expect(runtime.snapshot().graphs.mission_alpha.mission.goal).toBe("Build a direct-goal bootstrap guard")
  })

  test("registers bundled Runesmith protocol docs with OpenCode skills config", async () => {
    const plugin = createRunesmithPlugin()
    const config: any = {}

    expect(typeof (plugin as any).config).toBe("function")
    await (plugin as any).config(config)

    expect(config.skills.paths).toHaveLength(1)
    expect(config.skills.paths[0].replace(/\\/g, "/")).toEndWith("/.opencode/skills")
  })

  test("injects repository proof commands into OpenCode prompts and tool status", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: {
          typecheck: "tsc --noEmit",
          test: "bun test",
          build: "bun run build:packages",
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Wire repo proof commands",
    })

    const systemOutput = { system: ["Base system prompt"] }
    await plugin["experimental.chat.system.transform"]?.({}, systemOutput)
    const status = await plugin.tool.runesmith_covenant_status.execute({})
    const parsed = JSON.parse(status.output)

    expect(systemOutput.system.join("\n")).toContain("Run typecheck: bun run typecheck")
    expect(systemOutput.system.join("\n")).toContain("Run build: bun run build")
    expect(parsed.value.proofPlan.commands.map((command: any) => command.command)).toEqual([
      "bun run typecheck",
      "bun test",
      "bun run build",
    ])
  })

  test("discovers impacted tests for OpenCode proof plans without manual configuration", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Target impacted proof automatically",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: { filePath: "packages/core/src/proof-plan.ts" },
      },
      {
        result: { status: "changed" },
      },
    )

    const status = await plugin.tool.runesmith_covenant_status.execute({})
    const parsed = JSON.parse(status.output)

    expect(parsed.value.proofPlan.commands.map((command: any) => command.command)).toContain(
      "bun test packages/core/tests/proof-plan.test.ts",
    )
    expect(parsed.value.runebook.activeCard.commands.map((command: any) => command.command)[0]).toBe(
      "bun test packages/core/tests/proof-plan.test.ts",
    )
  })

  test("injects a live Covenant control brief for the active mission", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Make orchestration state-aware",
    })

    const systemOutput = { system: ["Base system prompt"] }
    await plugin["experimental.chat.system.transform"]?.({}, systemOutput)

    const prompt = systemOutput.system.join("\n")
    expect(prompt).toContain("Runesmith Control Brief")
    expect(prompt).toContain("Active mission: mission_alpha")
    expect(prompt).toContain("Next stage: Forge")
    expect(prompt).toContain("missing evidence: file-change, test-result")
    expect(prompt).toContain("Active runes:")
    expect(prompt).toContain("Forge Trace")
    expect(prompt).toContain("Proofwright")
    expect(prompt).toContain("Runesmith Loop Pulse")
    expect(prompt).toContain("Next action: Refine plan")
    expect(prompt).toContain("Runesmith Runebook")
    expect(prompt).toContain("Active card: Pathfinder plan refinery [auto]")
    expect(prompt).toContain("Runesmith Protocol Deck")
    expect(prompt).toContain("Active protocol: Pathfinder Plan Refinery Protocol [auto]")
    expect(prompt).toContain("Runesmith Mission Map")
    expect(prompt).toContain("Next task: task_alpha")
    expect(prompt).toContain("Runesmith Plan Contract")
    expect(prompt).toContain("Plan contract thin for mission_alpha")
    expect(prompt).toContain("Runesmith Dispatch Matrix")
    expect(prompt).toContain("Dispatch Matrix serial for mission_alpha")
    expect(prompt).toContain("Runesmith Worker Dispatch")
    expect(prompt).toContain("Worker Dispatch has 1 leased packet for mission_alpha.")
    expect(prompt).toContain("Runesmith Redline Proof")
    expect(prompt).toContain("Status: not-applicable")
    expect(prompt).toContain("Runesmith Repair Contract")
    expect(prompt).toContain("No active failed diagnostic is waiting for repair on task_alpha.")
    expect(prompt).toContain("Runesmith Review Lens")
    expect(prompt).toContain("Status: waiting-for-proof")
    expect(prompt).toContain("Engine-selected protocol; do not ask the user to invoke a workflow by name.")
  })

  test("autopilot prepares and claims a mission from the latest user message once", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })
    const messages = [
      { info: { role: "user" }, parts: [{ type: "text", text: "Build a durable OpenCode harness" }] },
    ]

    const prepared = await plugin.tool.runesmith_autopilot_prepare.execute({
      messages,
    })
    const replayed = await plugin.tool.runesmith_autopilot_prepare.execute({
      messages,
    })

    expect(JSON.parse(prepared.output)).toMatchObject({
      ok: true,
      value: {
        missionId: "mission_alpha",
        taskId: "task_alpha",
        leaseId: "lease_alpha",
        replayed: false,
      },
    })
    expect(JSON.parse(replayed.output)).toMatchObject({
      ok: true,
      value: {
        missionId: "mission_alpha",
        taskId: "task_alpha",
        leaseId: "lease_alpha",
        replayed: true,
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.mission.goal).toBe("Build a durable OpenCode harness")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
    expect(Object.keys(runtime.snapshot().graphs.mission_alpha.tasks)).toEqual([
      "task_alpha",
      "task_alpha_review",
      "task_alpha_seal",
    ])
    expect(writes.length).toBeGreaterThanOrEqual(2)
  })

  test("refines a thin autopilot mission into proof-backed parallel slices", async () => {
    const runtime = createRuntime({ idFactory: countingIds(), now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Ship install-direct orchestration planning",
    })

    const response = await plugin.tool.runesmith_plan_refine.execute({
      tasks: [
        {
          key: "plan",
          title: "Plan: install-direct orchestration planning",
          description: "Record proof-backed execution slices before implementation starts.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: OpenCode plan refinement tool",
          description: "Expose a direct tool that refines thin missions into concrete task slices.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard plan refinement signal",
          description: "Surface the refined plan and next orchestration state in mission control.",
          requiredCapabilities: ["typescript", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "review",
          title: "Review: install-direct orchestration planning",
          description: "Review proof, routing, and residual risk for the refined plan.",
          requiredCapabilities: ["testing", "review"],
          requiredEvidence: ["decision"],
          dependsOn: ["adapter-forge", "dashboard-forge"],
        },
        {
          key: "seal",
          title: "Seal: install-direct orchestration planning",
          description: "Capture the final checkpoint and handoff.",
          requiredCapabilities: ["repository-maintenance", "release"],
          requiredEvidence: ["decision"],
          dependsOn: ["review"],
        },
      ],
      evidenceId: "evidence_plan_refined",
    })

    const parsed = JSON.parse(response.output)
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        missionId: "mission_1",
        rootTaskId: "task_1",
        taskCount: 5,
        status: "waiting-for-evidence",
        planContract: {
          status: "ready",
          implementationTaskCount: 2,
        },
        dispatchMatrix: {
          activeSlotCount: 2,
          readySlotCount: 0,
        },
      },
    })
    const snapshot = runtime.snapshot()
    const tasks = snapshot.graphs.mission_1.tasks
    expect(Object.keys(tasks)).toEqual([
      "task_1",
      "task_1_adapter_forge",
      "task_1_dashboard_forge",
      "task_1_review",
      "task_1_seal",
    ])
    expect(tasks.task_1.status).toBe("complete")
    expect(tasks.task_1_adapter_forge).toMatchObject({
      status: "running",
      assignedAgentId: "agent_atlas",
    })
    expect(tasks.task_1_dashboard_forge).toMatchObject({
      status: "running",
      assignedAgentId: "agent_artificer",
    })
    expect(snapshot.ledgers.mission_1.evidence.evidence_plan_refined).toMatchObject({
      taskId: "task_1",
      type: "decision",
    })
    expect(writes.at(-1)).toContain("adapter-forge")
  })

  test("claims the next Worker Dispatch packet without raw task ids", async () => {
    const runtime = createRuntime({ idFactory: countingIds(), now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    runtime.startMission({
      goal: "Ship direct packet claiming",
      taskPlan: [
        {
          key: "forge",
          title: "Forge: packet claim",
          description: "Expose Worker Dispatch packet claiming to OpenCode.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
        },
      ],
    })

    const response = await (plugin.tool as any).runesmith_worker_claim.execute({})
    const replayed = await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_agent_atlas",
    })

    expect(JSON.parse(response.output)).toMatchObject({
      ok: true,
      value: {
        packetId: "worker_mission_1_task_1_agent_atlas",
        missionId: "mission_1",
        taskId: "task_1",
        agentId: "agent_atlas",
        leaseId: "lease_1",
        replayed: false,
      },
    })
    expect(JSON.parse(replayed.output)).toMatchObject({
      ok: true,
      value: {
        packetId: "worker_mission_1_task_1_agent_atlas",
        leaseId: "lease_1",
        replayed: true,
      },
    })
    expect(runtime.snapshot().graphs.mission_1.tasks.task_1).toMatchObject({
      status: "running",
      assignedAgentId: "agent_atlas",
    })
    expect(writes.at(-1)).toContain("worker-dispatch:mission_1:task_1:agent_atlas")
  })

  test("auto-prepares a mission before the first mutating OpenCode tool executes", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin["tool.execute.before"]?.(
      {
        tool: "edit",
        messages: [
          { info: { role: "user" }, parts: [{ type: "text", text: "Add a zero-touch orchestration guard" }] },
        ],
      },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
    )
    await plugin["tool.execute.before"]?.(
      {
        tool: "edit",
        messages: [
          { info: { role: "user" }, parts: [{ type: "text", text: "Add a zero-touch orchestration guard" }] },
        ],
      },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
    )

    expect(runtime.snapshot().graphs.mission_alpha.mission.goal).toBe("Add a zero-touch orchestration guard")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
    expect(runtime.snapshot().leases.leases.lease_alpha?.holder).toBe("runesmith-autopilot")
    expect(Object.keys(runtime.snapshot().graphs)).toEqual(["mission_alpha"])
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0] ?? "{}").graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
  })

  test("runs the current Runebook next action through one OpenCode tool", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const commands: string[] = []
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: false,
      proofCommandRunner(command) {
        commands.push(command.command)
        return {
          exitCode: 0,
          stdout: "next proof passed",
          stderr: "",
        }
      },
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Run one next action",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    const next = await plugin.tool.runesmith_next.execute({})

    expect(JSON.parse(next.output)).toMatchObject({
      ok: true,
      value: {
        status: "proof-passed",
        actionId: "capture-proof",
        card: {
          title: "Proofwright proof gate",
        },
        proofStatus: "passed",
        nextStatus: "completed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            evidenceType: "test-result",
            exitCode: 0,
          },
        ],
        loopPulse: {
          nextAction: {
            id: "wait-for-goal",
          },
        },
      },
    })
    expect(commands).toEqual(["bun test"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("runs the Runeweave OS loop through one OpenCode tool", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const commands: string[] = []
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: false,
      proofCommandRunner(command) {
        commands.push(command.command)
        return {
          exitCode: 0,
          stdout: "os proof passed",
          stderr: "",
        }
      },
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Run the OS loop",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    const osRun = await plugin.tool.runesmith_os_run.execute({ maxSteps: 4 })

    expect(JSON.parse(osRun.output)).toMatchObject({
      ok: true,
      value: {
        status: "sealed",
        stepCount: 1,
        finalActionId: "wait-for-goal",
        steps: [
          {
            status: "proof-passed",
            actionId: "capture-proof",
          },
        ],
        commands: [
          {
            command: "bun test",
            evidenceType: "test-result",
            exitCode: 0,
          },
        ],
      },
    })
    expect(commands).toEqual(["bun test"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("records evidence automatically from OpenCode tool execution events", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Wire automatic evidence capture",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "bash",
        sessionID: "session_alpha",
      },
      {
        args: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts" },
        result: { exitCode: 0, stdout: "6 pass", stderr: "" },
      },
    )
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
      },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(evidence).toHaveLength(2)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          summary: expect.stringContaining("bash"),
          payload: expect.objectContaining({
            tool: "bash",
            command: "bun test packages/opencode-adapter/tests/plugin.test.ts",
            exitCode: 0,
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha",
          type: "file-change",
          payload: expect.objectContaining({
            tool: "edit",
            filePath: "packages/opencode-adapter/src/plugin.ts",
          }),
        }),
      ]),
    )
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
    expect(JSON.parse(writes.at(-1) ?? "{}").ledgers.mission_alpha.evidence).toBeDefined()
  })

  test("routes automatic OpenCode evidence to the focused Worker Dispatch packet", async () => {
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 4, 27, 0, 0, tick++))
    const runtime = createRuntime({ idFactory: countingIds(), now })
    const plugin = createRunesmithPlugin({
      runtime,
      now,
    })

    runtime.startMission({
      goal: "Route focused worker evidence",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: worker focus",
          description: "Record the worker focus boundary.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: adapter focus",
          description: "Capture adapter proof.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard focus",
          description: "Capture dashboard proof.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_1",
      taskId: "task_1",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "plan-claim",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_1",
      evidence: {
        id: "evidence_plan",
        taskId: "task_1",
        type: "decision",
        summary: "Worker focus boundary approved",
        payload: {},
        createdAt: "2026-05-27T00:00:01.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_1",
      taskId: "task_1",
      contractId: "agent_steward",
    })

    await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
    })
    await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_dashboard_forge_agent_artificer",
    })
    await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
      {
        result: { status: "changed" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_1.evidence)
      .filter((entry) => entry.type === "file-change")
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({
      taskId: "task_1_adapter_forge",
      payload: {
        tool: "edit",
        filePath: "packages/opencode-adapter/src/plugin.ts",
        workerDispatch: {
          packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
          agentId: "agent_atlas",
          leaseId: "lease_2",
        },
      },
    })
  })

  test("routes OpenCode evidence to an engine-focused Worker Dispatch packet without a manual claim", async () => {
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 4, 27, 0, 0, tick++))
    const runtime = createRuntime({ idFactory: countingIds(), now })
    const plugin = createRunesmithPlugin({
      runtime,
      now,
    })

    runtime.startMission({
      goal: "Auto-focus engine-owned worker evidence",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: automatic worker focus",
          description: "Record the automatic worker focus boundary.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: adapter auto focus",
          description: "Capture adapter proof without manual worker claim.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard auto focus",
          description: "Capture dashboard proof without manual worker claim.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_1",
      taskId: "task_1",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "plan-claim",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_1",
      evidence: {
        id: "evidence_plan",
        taskId: "task_1",
        type: "decision",
        summary: "Automatic worker focus boundary approved",
        payload: {},
        createdAt: "2026-05-27T00:00:01.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_1",
      taskId: "task_1",
      contractId: "agent_steward",
    })

    const next = await plugin.tool.runesmith_next.execute({})
    expect(JSON.parse(next.output)).toMatchObject({
      ok: true,
      value: {
        status: "advanced",
        nextStatus: "claimed",
        missionId: "mission_1",
        taskId: "task_1_adapter_forge",
        proofPlan: {
          workerDispatch: {
            packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
            agentId: "agent_atlas",
            holder: "runesmith-autopilot",
            leaseId: "lease_2",
          },
        },
      },
    })

    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
      {
        result: { status: "changed" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_1.evidence)
      .filter((entry) => entry.type === "file-change")
    expect(evidence).toHaveLength(1)
    expect(evidence[0]).toMatchObject({
      taskId: "task_1_adapter_forge",
      payload: {
        tool: "edit",
        filePath: "packages/opencode-adapter/src/plugin.ts",
        workerDispatch: {
          packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
          agentId: "agent_atlas",
          holder: "runesmith-autopilot",
          leaseId: "lease_2",
        },
      },
    })
  })

  test("runs proof for the focused Worker Dispatch packet", async () => {
    let tick = 0
    const now = () => new Date(Date.UTC(2026, 4, 27, 0, 0, tick++))
    const commands: string[] = []
    const runtime = createRuntime({ idFactory: countingIds(), now })
    const plugin = createRunesmithPlugin({
      runtime,
      now,
      proofPlanOptions: {
        packageManager: "bun@1.3.13",
        scripts: { test: "bun test" },
      },
      proofCommandRunner(command) {
        commands.push(command.command)
        return {
          exitCode: 0,
          stdout: "focused proof passed",
          stderr: "",
        }
      },
    })

    runtime.startMission({
      goal: "Prove focused worker through OpenCode",
      taskPlan: [
        {
          key: "plan",
          title: "Plan: worker proof",
          description: "Record the worker proof boundary.",
          requiredCapabilities: ["repository-maintenance"],
          requiredEvidence: ["decision"],
        },
        {
          key: "adapter-forge",
          title: "Forge: adapter proof",
          description: "Capture adapter proof.",
          requiredCapabilities: ["typescript", "testing"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
        {
          key: "dashboard-forge",
          title: "Forge: dashboard proof",
          description: "Capture dashboard proof.",
          requiredCapabilities: ["typescript", "testing", "ui"],
          requiredEvidence: ["file-change", "test-result"],
          dependsOn: ["plan"],
        },
      ],
    })
    runtime.claimTask({
      missionId: "mission_1",
      taskId: "task_1",
      contractId: "agent_steward",
      holder: "steward",
      idempotencyKey: "plan-claim",
      ttlMs: 30_000,
    })
    runtime.addTaskEvidence({
      missionId: "mission_1",
      evidence: {
        id: "evidence_plan",
        taskId: "task_1",
        type: "decision",
        summary: "Worker proof boundary approved",
        payload: {},
        createdAt: "2026-05-27T00:00:01.000Z",
      },
    })
    runtime.completeTask({
      missionId: "mission_1",
      taskId: "task_1",
      contractId: "agent_steward",
    })

    await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
    })
    await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_dashboard_forge_agent_artificer",
    })
    await (plugin.tool as any).runesmith_worker_claim.execute({
      packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
      {
        result: { status: "changed" },
      },
    )

    const response = await plugin.tool.runesmith_proof_run.execute({})
    const parsed = JSON.parse(response.output)
    const evidence = Object.values(runtime.snapshot().ledgers.mission_1.evidence)

    expect(parsed).toMatchObject({
      ok: true,
      value: {
        proofStatus: "passed",
        taskId: "task_1_adapter_forge",
        commands: [
          {
            command: "bun test",
            evidenceType: "test-result",
            exitCode: 0,
          },
        ],
      },
    })
    expect(commands).toEqual(["bun test"])
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_1_adapter_forge",
          type: "test-result",
          payload: expect.objectContaining({
            command: "bun test",
            mode: "runesmith-proof-runner",
            workerDispatch: expect.objectContaining({
              packetId: "worker_mission_1_task_1_adapter_forge_agent_atlas",
              agentId: "agent_atlas",
              holder: "runesmith-worker:agent_atlas",
              leaseId: "lease_2",
            }),
          }),
        }),
      ]),
    )
    expect(runtime.snapshot().graphs.mission_1.tasks.task_1_adapter_forge.status).toBe("complete")
  })

  test("timestamps automatic tool evidence with the plugin clock", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({
      runtime,
      now: fixedNow,
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Timestamp automatic evidence deterministically",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
      {
        result: { status: "changed" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(evidence).toEqual([
      expect.objectContaining({
        type: "file-change",
        createdAt: "2026-05-27T00:00:00.000Z",
      }),
    ])
  })

  test("timestamps manually attached task evidence with the plugin clock", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({
      runtime,
      now: fixedNow,
    })

    await plugin.tool.runesmith_mission_start.execute({
      goal: "Timestamp manual evidence deterministically",
    })
    await plugin.tool.runesmith_task_evidence.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      type: "risk",
      summary: "Manual risk note",
      payload: { severity: "medium" },
      evidenceId: "evidence_manual_risk",
    })

    expect(runtime.snapshot().ledgers.mission_alpha.evidence.evidence_manual_risk).toMatchObject({
      type: "risk",
      createdAt: "2026-05-27T00:00:00.000Z",
    })
  })

  test("records evidence when OpenCode tool args are on the input payload", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Capture input-side hook arguments",
    })
    await plugin["tool.execute.after"]?.(
      {
        tool: "bash",
        args: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts" },
      },
      {
        result: { exitCode: 0, stdout: "7 pass", stderr: "" },
      },
    )
    await plugin["tool.execute.after"]?.(
      {
        tool: "edit",
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      },
      {
        result: { status: "changed" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "test-result",
          payload: expect.objectContaining({
            command: "bun test packages/opencode-adapter/tests/plugin.test.ts",
            exitCode: 0,
          }),
        }),
        expect.objectContaining({
          type: "file-change",
          payload: expect.objectContaining({
            filePath: "packages/opencode-adapter/src/plugin.ts",
          }),
        }),
      ]),
    )
  })

  test("classifies verification shell commands as proof or diagnostic evidence automatically", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Classify OpenCode verification signals",
    })

    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "bun run typecheck" },
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
    )
    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "bun run lint" },
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
    )
    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "bun run build" },
        result: { exitCode: 1, stdout: "", stderr: "build failed" },
      },
    )
    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "mkdir build" },
        result: { exitCode: 0, stdout: "", stderr: "" },
      },
    )
    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "next dev" },
        result: { exitCode: 0, stdout: "ready", stderr: "" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          payload: expect.objectContaining({
            command: "bun run typecheck",
            exitCode: 0,
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          payload: expect.objectContaining({
            command: "bun run lint",
            exitCode: 0,
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha",
          type: "diagnostic",
          payload: expect.objectContaining({
            command: "bun run build",
            exitCode: 1,
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha",
          type: "command-output",
          payload: expect.objectContaining({
            command: "mkdir build",
            exitCode: 0,
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha",
          type: "command-output",
          payload: expect.objectContaining({
            command: "next dev",
            exitCode: 0,
          }),
        }),
      ]),
    )
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
  })

  test("classifies OpenCode bash metadata exit zero as proof evidence", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Capture proof from real OpenCode bash output",
    })

    await plugin["tool.execute.after"]?.(
      {
        tool: "bash",
        args: {
          command: "npm test",
          description: "Run npm test to verify changes",
          workdir: "E:\\dev\\Oh-my\\runesmith-dogfood-opencode-run",
        },
      },
      {
        output: "> dogfood@0.0.0 test > node --test TAP version 13 # pass 2 # fail 0",
        metadata: {
          exit: 0,
          output: "> dogfood@0.0.0 test > node --test TAP version 13 # pass 2 # fail 0",
          description: "Run npm test to verify changes",
          truncated: false,
        },
      } as OpenCodeToolOutput,
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          payload: expect.objectContaining({
            command: "npm test",
            exitCode: 0,
            result: expect.objectContaining({
              output: expect.stringContaining("# pass 2"),
            }),
          }),
        }),
      ]),
    )
  })

  test("advances immediately after captured evidence satisfies the active task", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Seal directly after proof capture",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")

    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts" },
        result: { exitCode: 0, stdout: "9 pass", stderr: "" },
      },
    )

    const graph = runtime.snapshot().graphs.mission_alpha
    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(graph.tasks.task_alpha.status).toBe("complete")
    expect(graph.tasks.task_alpha_review.status).toBe("complete")
    expect(graph.tasks.task_alpha_seal.status).toBe("complete")
    expect(graph.mission.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha_review",
          type: "decision",
          payload: expect.objectContaining({
            stage: "review",
            verdict: "approved",
          }),
        }),
        expect.objectContaining({
          taskId: "task_alpha_seal",
          type: "decision",
          payload: expect.objectContaining({
            stage: "seal",
            verdict: "sealed",
          }),
        }),
      ]),
    )
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("does not seal the active task when captured tests fail", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime, proofPlanOptions: false })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Hold after failing proof",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )
    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts" },
        result: { exitCode: 1, stdout: "", stderr: "1 fail" },
      },
    )

    const evidence = Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("running")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "diagnostic",
          payload: expect.objectContaining({
            tool: "bash",
            command: "bun test packages/opencode-adapter/tests/plugin.test.ts",
            exitCode: 1,
          }),
        }),
      ]),
    )
    expect(evidence.some((item) => item.type === "test-result")).toBe(false)

    const tick = await plugin.tool.runesmith_autopilot_tick.execute({})
    expect(JSON.parse(tick.output)).toMatchObject({
      ok: true,
      value: {
        status: "waiting-for-evidence",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        missingEvidence: ["test-result"],
        diagnostics: ["bash ran bun test packages/opencode-adapter/tests/plugin.test.ts"],
        missionMemory: {
          status: "needs-repair",
          latestDiagnostics: ["bash ran bun test packages/opencode-adapter/tests/plugin.test.ts"],
          handoff:
            "Repair task_alpha: bash ran bun test packages/opencode-adapter/tests/plugin.test.ts. State a falsifiable hypothesis, change one repair variable, then rerun proof.",
        },
        proofPlan: {
          status: "needs-repair",
          commands: [
            {
              command: "bun test packages/opencode-adapter/tests/plugin.test.ts",
              kind: "rerun-diagnostic",
            },
            {
              command: "bun test",
              kind: "test",
            },
          ],
        },
        runebook: {
          activeCard: {
            id: "faultwright-repair",
            autonomy: "guarded",
            steps: expect.arrayContaining([
              "State a falsifiable repair hypothesis from the latest diagnostic before editing.",
              "Change one repair variable at a time and explain why it should change the failing output.",
            ]),
            commands: [
              {
                command: "bun test packages/opencode-adapter/tests/plugin.test.ts",
              },
              {
                command: "bun test",
              },
            ],
          },
        },
        loopPulse: {
          nextAction: {
            id: "repair-diagnostic",
            label: "Repair diagnostic",
          },
          executionPlan: [
            {
              id: "acknowledge-diagnostic",
              status: "active",
            },
            {
              id: "repair-smallest-cause",
              label: "Hypothesis repair",
              status: "queued",
              instruction: "State a falsifiable repair hypothesis, change one repair variable, and link the edit to the active diagnostic.",
            },
            {
              id: "rerun-failing-command",
              status: "blocked",
            },
          ],
          runes: [
            {
              name: "Faultwright",
            },
            {
              name: "Proofwright",
            },
          ],
        },
      },
    })
  })

  test("escalates repeated captured failures into a Faultline breakpoint", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime, proofPlanOptions: false })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Stop repeated OpenCode repair failures",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )
    for (const index of [1, 2, 3]) {
      await plugin["tool.execute.after"]?.(
        { tool: "bash" },
        {
          args: { command: `bun test packages/opencode-adapter/tests/plugin.test.ts --attempt=${index}` },
          result: { exitCode: 1, stdout: "", stderr: `${index} fail` },
        },
      )
    }

    const tick = await plugin.tool.runesmith_autopilot_tick.execute({})

    expect(JSON.parse(tick.output)).toMatchObject({
      ok: true,
      value: {
        status: "waiting-for-evidence",
        missionMemory: {
          status: "needs-architecture",
          handoff:
            "Review faultline for task_alpha: 3 failed proof attempts. Question architecture before another repair.",
        },
        proofPlan: {
          status: "needs-repair",
          commands: [
            {
              command: "bun test packages/opencode-adapter/tests/plugin.test.ts --attempt=3",
              kind: "rerun-diagnostic",
            },
            {
              command: "bun test",
              kind: "test",
            },
          ],
        },
        runebook: {
          activeCard: {
            id: "faultline-breakpoint",
            title: "Faultline architecture breakpoint",
            toolHints: ["runesmith_faultline_resolve"],
          },
        },
        loopPulse: {
          nextAction: {
            id: "review-faultline",
            label: "Review faultline",
          },
          executionPlan: [
            {
              id: "summarize-failed-repairs",
              status: "active",
            },
            {
              id: "question-architecture",
              status: "queued",
            },
            {
              id: "choose-breakthrough-path",
              status: "blocked",
            },
          ],
          runes: [
            {
              name: "Faultline",
            },
            {
              name: "Proofwright",
            },
          ],
        },
      },
    })
  })

  test("resolves an active Faultline breakpoint through a first-class OpenCode tool", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({ runtime, proofPlanOptions: false })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Resolve OpenCode Faultline without task ids",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )
    for (const index of [1, 2, 3]) {
      await plugin["tool.execute.after"]?.(
        { tool: "bash" },
        {
          args: { command: `bun test packages/opencode-adapter/tests/plugin.test.ts --attempt=${index}` },
          result: { exitCode: 1, stdout: "", stderr: `${index} fail` },
        },
      )
    }

    const resolved = await plugin.tool.runesmith_faultline_resolve.execute({
      summary: "Extract plugin event capture from proof routing before another repair",
      evidenceId: "evidence_faultline_resolution",
    })

    expect(JSON.parse(resolved.output)).toMatchObject({
      ok: true,
      value: {
        status: "resolved",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        evidenceId: "evidence_faultline_resolution",
        nextStatus: "waiting-for-evidence",
        proofPlan: {
          status: "needs-repair",
          commands: [
            {
              command: "bun test packages/opencode-adapter/tests/plugin.test.ts --attempt=3",
              kind: "rerun-diagnostic",
            },
            {
              command: "bun test",
              kind: "test",
            },
          ],
        },
        loopPulse: {
          nextAction: {
            id: "repair-diagnostic",
          },
        },
      },
    })
    expect(runtime.snapshot().ledgers.mission_alpha.evidence.evidence_faultline_resolution).toMatchObject({
      taskId: "task_alpha",
      type: "decision",
      summary: "Faultline path: Extract plugin event capture from proof routing before another repair",
    })
  })

  test("resolves active risk through a first-class OpenCode tool", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Resolve OpenCode risk",
    })
    await plugin.tool.runesmith_task_evidence.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      type: "file-change",
      summary: "Changed OpenCode adapter",
      payload: { filePath: "packages/opencode-adapter/src/plugin.ts" },
      evidenceId: "evidence_file",
    })
    await plugin.tool.runesmith_task_evidence.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      type: "test-result",
      summary: "OpenCode adapter tests passed",
      payload: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts", exitCode: 0 },
      evidenceId: "evidence_test",
    })
    await plugin.tool.runesmith_task_evidence.execute({
      missionId: "mission_alpha",
      taskId: "task_alpha",
      type: "risk",
      summary: "Deletes generated user files without confirmation",
      payload: { severity: "high" },
      evidenceId: "evidence_risk",
    })

    const resolved = await plugin.tool.runesmith_risk_resolve.execute({
      verdict: "accepted",
      summary: "Operator accepts generated-file deletion after review",
    })

    expect(JSON.parse(resolved.output)).toMatchObject({
      ok: true,
      value: {
        status: "resolved",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        verdict: "accepted",
        nextStatus: "completed",
        loopPulse: {
          nextAction: {
            id: "wait-for-goal",
          },
        },
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "decision",
          summary: "Risk accepted: Operator accepts generated-file deletion after review",
        }),
      ]),
    )
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("runs the active proof plan through an OpenCode tool and advances the mission", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const commands: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: false,
      proofCommandRunner(command) {
        commands.push(command.command)
        return {
          exitCode: 0,
          stdout: "proof passed",
          stderr: "",
        }
      },
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Run proof inside OpenCode",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    const proof = await plugin.tool.runesmith_proof_run.execute({})

    expect(JSON.parse(proof.output)).toMatchObject({
      ok: true,
      value: {
        status: "completed",
        proofStatus: "passed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            evidenceType: "test-result",
            exitCode: 0,
          },
        ],
        loopPulse: {
          nextAction: {
            id: "wait-for-goal",
          },
        },
      },
    })
    expect(commands).toEqual(["bun test"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          summary: "Run tests passed: bun test",
          payload: expect.objectContaining({
            command: "bun test",
            exitCode: 0,
            mode: "runesmith-proof-runner",
          }),
        }),
      ]),
    )
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("default OpenCode shell proof runner handles noisy command output without exec maxBuffer failure", async () => {
    const noisyCommand = "node -e \"process.stdout.write('x'.repeat(1200000))\""
    const result = await runOpenCodeShellProofCommand({
      id: "noisy-proof",
      kind: "test",
      label: "Noisy proof",
      command: noisyCommand,
      reason: "Exercise bounded shell capture.",
      evidenceType: "test-result",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout?.length).toBe(64_000)
    expect(result.stderr).toBe("")
  })

  test("default OpenCode shell proof runner replays Windows PowerShell proof commands", async () => {
    if (process.platform !== "win32") return

    const result = await runOpenCodeShellProofCommand({
      id: "powershell-proof",
      kind: "rerun-diagnostic",
      label: "PowerShell proof",
      command: "Write-Output ok | Select-Object -First 1",
      reason: "Replay a command captured from the OpenCode shell on Windows.",
      evidenceType: "test-result",
    })

    expect(result.exitCode).toBe(0)
    expect(result.stdout?.trim()).toBe("ok")
    expect(result.stderr).toBe("")
  })

  test("records OpenCode proof run failures as diagnostics and keeps repair active", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: false,
      proofCommandRunner(command) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `${command.command} failed`,
        }
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Hold failed OpenCode proof",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    const proof = await plugin.tool.runesmith_proof_run.execute({})

    expect(JSON.parse(proof.output)).toMatchObject({
      ok: true,
      value: {
        status: "waiting-for-evidence",
        proofStatus: "failed",
        missionId: "mission_alpha",
        taskId: "task_alpha",
        commands: [
          {
            command: "bun test",
            evidenceType: "diagnostic",
            exitCode: 1,
          },
        ],
        loopPulse: {
          nextAction: {
            id: "repair-diagnostic",
          },
        },
      },
    })
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("running")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "diagnostic",
          summary: "Run tests failed: bun test",
          payload: expect.objectContaining({
            command: "bun test",
            exitCode: 1,
            stderr: "bun test failed",
          }),
        }),
      ]),
    )
  })

  test("session idle runs the active proof plan and seals the mission when proof passes", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const commands: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: false,
      proofCommandRunner(command) {
        commands.push(command.command)
        return {
          exitCode: 0,
          stdout: "proof passed",
          stderr: "",
        }
      },
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Autoprove on idle",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    await plugin.event?.({ event: { type: "session.idle" } })

    expect(commands).toEqual(["bun test"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_review.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_seal.status).toBe("complete")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          summary: "Run tests passed: bun test",
          payload: expect.objectContaining({
            command: "bun test",
            exitCode: 0,
            mode: "runesmith-proof-runner",
          }),
        }),
      ]),
    )
    expect(runtime.snapshot().graphs.mission_alpha.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runeweave.stopped",
          targetId: "task_alpha",
          message: "Runeweave sealed: No active mission remains after verified work was sealed.",
          data: expect.objectContaining({
            mode: "session.idle",
            status: "sealed",
            stopReason: "No active mission remains after verified work was sealed.",
            stepCount: 1,
            finalActionId: "wait-for-goal",
            proofStatus: "passed",
            commands: [
              expect.objectContaining({
                command: "bun test",
                exitCode: 0,
                evidenceType: "test-result",
              }),
            ],
          }),
        }),
      ]),
    )
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runeweave.stopped",
          data: expect.objectContaining({
            mode: "session.idle",
            status: "sealed",
          }),
        }),
      ]),
    )
  })

  test("session idle holds failed proof until a repair edit creates new evidence", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const commands: string[] = []
    let nextExitCode = 1
    const plugin = createRunesmithPlugin({
      runtime,
      proofPlanOptions: false,
      proofCommandRunner(command) {
        commands.push(command.command)
        return {
          exitCode: nextExitCode,
          stdout: "",
          stderr: nextExitCode === 0 ? "" : `${command.command} failed`,
        }
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Repair proof on idle",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    await plugin.event?.({ event: { type: "session.idle" } })
    await plugin.event?.({ event: { type: "session.idle" } })

    expect(commands).toEqual(["bun test"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("running")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "diagnostic",
          summary: "Run tests failed: bun test",
        }),
      ]),
    )

    nextExitCode = 0
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts", id: "repair-edit" },
        result: { status: "changed" },
      },
    )
    await plugin.event?.({ event: { type: "session.idle" } })

    expect(commands).toEqual(["bun test", "bun test"])
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(Object.values(runtime.snapshot().ledgers.mission_alpha.evidence)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          summary: "Rerun failing command passed: bun test",
        }),
      ]),
    )
  })

  test("session idle prepares and claims a mission from chat context when no mission exists", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.event?.({
      event: { type: "session.idle" },
      messages: [
        { role: "system", content: "Base prompt" },
        { role: "user", parts: [{ type: "text", text: "Build an idle-start orchestration loop" }] },
      ],
    })
    await plugin.event?.({
      event: {
        type: "session.idle",
        messages: [
          { role: "user", content: "Build an idle-start orchestration loop" },
        ],
      },
    })

    const snapshot = runtime.snapshot()
    expect(Object.keys(snapshot.graphs)).toEqual(["mission_alpha"])
    expect(snapshot.graphs.mission_alpha.mission.goal).toBe("Build an idle-start orchestration loop")
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha_runtime_forge).toMatchObject({
      status: "running",
      assignedAgentId: "agent_atlas",
    })
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha_interface_forge).toBeUndefined()
    expect(snapshot.graphs.mission_alpha.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runeweave.stopped",
          targetId: "task_alpha",
          message:
            "Runeweave needs-work: The active Runebook card requires implementation evidence before Runesmith can continue autonomously.",
          data: expect.objectContaining({
            mode: "session.idle",
            status: "needs-work",
            stopReason:
              "The active Runebook card requires implementation evidence before Runesmith can continue autonomously.",
            stepCount: 1,
            finalActionId: "continue-forge",
          }),
        }),
      ]),
    )
    expect(snapshot.leases.leases.lease_alpha?.holder).toBe("runesmith-autopilot")
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runeweave.stopped",
          data: expect.objectContaining({
            mode: "session.idle",
            status: "needs-work",
          }),
        }),
      ]),
    )
  })

  test("autopilot tick completes the active task once captured evidence satisfies the contract", async () => {
    const runtime = createRuntime({ idFactory: ids, now: fixedNow })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Seal automatically after proof",
    })
    await plugin["tool.execute.after"]?.(
      { tool: "edit" },
      {
        args: { filePath: "packages/opencode-adapter/src/plugin.ts" },
        result: { status: "changed" },
      },
    )

    const held = await plugin.tool.runesmith_autopilot_tick.execute({})
    expect(JSON.parse(held.output)).toMatchObject({
      ok: true,
      value: {
        status: "waiting-for-evidence",
        missingEvidence: ["test-result"],
      },
    })

    await plugin["tool.execute.after"]?.(
      { tool: "bash" },
      {
        args: { command: "bun test packages/opencode-adapter/tests/plugin.test.ts" },
        result: { exitCode: 0, stdout: "7 pass", stderr: "" },
      },
    )
    await plugin.event?.({ event: { type: "session.idle" } })

    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_review.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.tasks.task_alpha_seal.status).toBe("complete")
    expect(runtime.snapshot().graphs.mission_alpha.mission.status).toBe("complete")
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("session idle recovers and reclaims stale autopilot work automatically", async () => {
    let now = new Date("2026-05-27T00:00:00.000Z")
    const runtime = createRuntime({ idFactory: ids, now: () => now })
    const writes: string[] = []
    const plugin = createRunesmithPlugin({
      runtime,
      runtimeStore: {
        save(snapshot) {
          writes.push(JSON.stringify(snapshot))
        },
      },
    })

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Recover silent autopilot work",
    })

    now = new Date("2026-05-27T00:03:00.000Z")
    await plugin.event?.({ event: { type: "session.idle" } })

    const snapshot = runtime.snapshot()
    const task = snapshot.graphs.mission_alpha.tasks.task_alpha
    expect(task.status).toBe("complete")
    expect(task.assignedAgentId).toBe("agent_atlas")
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha_runtime_forge.status).toBe("running")
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha_interface_forge).toBeUndefined()
    expect(snapshot.graphs.mission_alpha.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["task.stale", "task.requeued", "task.transitioned"]),
    )
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.tasks.task_alpha.status).toBe("complete")
  })
})
