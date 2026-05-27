import { describe, expect, test } from "bun:test"

import {
  createRuntime,
  defaultRuntimeCapsulePath,
  loadRuntimeCapsule,
  saveRuntimeCapsule,
  type RuntimeStoreHost,
} from "@runesmith/core"
import { createRunesmithOpenCodePlugin, createRunesmithPlugin, type PluginRuntimeStore } from "../src/plugin"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

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

  test("exposes the Runic Covenant and injects it into OpenCode once", async () => {
    const plugin = createRunesmithPlugin()

    const status = await plugin.tool.runesmith_covenant_status.execute({})
    const parsed = JSON.parse(status.output)
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        name: "Runic Covenant",
        installMode: "automatic",
        stageCount: 9,
      },
    })
    expect(parsed.value.stages.map((stage: any) => stage.id)).toContain("repair")
    expect(parsed.value.stages.find((stage: any) => stage.id === "repair")).toMatchObject({
      id: "repair",
      name: "Repair Gate",
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
            id: "continue-forge",
            label: "Continue forge",
          },
        },
        runebook: {
          activeCard: {
            id: "forge-trace",
            title: "Forge Trace implementation loop",
            autonomy: "auto",
          },
        },
        protocolDeck: {
          active: {
            id: "forge-trace-protocol",
            name: "Forge Trace Protocol",
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
    expect(initial.ok).toBe(true)
    if (!initial.ok || !initial.value) throw new Error("expected package plugin to create the runtime capsule")
    expect(initial.value.runtime.graphs).toEqual({})

    await plugin.tool.runesmith_autopilot_prepare.execute({
      goal: "Zero-config package persistence",
    })

    const saved = await loadRuntimeCapsule(host, defaultRuntimeCapsulePath)
    expect(saved.ok).toBe(true)
    if (!saved.ok || !saved.value) throw new Error("expected package plugin to persist mission state")
    expect(saved.value.runtime.graphs.mission_alpha.mission.goal).toBe("Zero-config package persistence")
    expect(saved.value.runtime.graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
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
    expect(compactOutput.context.join("\n")).toContain("Runesmith Proof Plan")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Runebook")
    expect(compactOutput.context.join("\n")).toContain("Runesmith Protocol Deck")
    expect(compactOutput.context.join("\n")).toContain("Handoff:")
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
    expect(prompt).toContain("Next action: Continue forge")
    expect(prompt).toContain("Runesmith Runebook")
    expect(prompt).toContain("Active card: Forge Trace implementation loop [auto]")
    expect(prompt).toContain("Runesmith Protocol Deck")
    expect(prompt).toContain("Active protocol: Forge Trace Protocol [auto]")
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
    expect(writes.length).toBeGreaterThanOrEqual(2)
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
            "Repair task_alpha: bash ran bun test packages/opencode-adapter/tests/plugin.test.ts. Rerun proof after the smallest fix.",
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
              status: "queued",
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
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
    expect(snapshot.graphs.mission_alpha.tasks.task_alpha.assignedAgentId).toBe("agent_atlas")
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
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
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
    expect(task.status).toBe("running")
    expect(task.assignedAgentId).toBe("agent_atlas")
    expect(snapshot.graphs.mission_alpha.events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["task.stale", "task.requeued", "task.transitioned"]),
    )
    expect(JSON.parse(writes.at(-1) ?? "{}").graphs.mission_alpha.tasks.task_alpha.status).toBe("running")
  })
})
