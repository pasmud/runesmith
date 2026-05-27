import { describe, expect, test } from "bun:test"

import { createMemoryHost, runCli } from "../src/index"

const snapshot = {
  graphs: {
    mission_alpha: {
      mission: {
        id: "mission_alpha",
        goal: "Build Runesmith",
        status: "running",
        rootTaskId: "task_alpha",
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
      tasks: {
        task_alpha: {
          id: "task_alpha",
          missionId: "mission_alpha",
          title: "Mission root",
          description: "Build Runesmith",
          status: "running",
          requiredCapabilities: ["typescript"],
          requiredEvidence: ["file-change", "test-result"],
          assignedAgentId: "agent_atlas",
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:00:00.000Z",
        },
      },
      events: [],
    },
  },
  ledgers: {
    mission_alpha: {
      evidence: {
        evidence_file: {
          id: "evidence_file",
          taskId: "task_alpha",
          type: "file-change",
          summary: "Changed runtime",
          payload: { files: ["packages/core/src/runtime.ts"] },
          createdAt: "2026-05-27T00:01:00.000Z",
        },
      },
    },
  },
  leases: {
    leases: {
      lease_alpha: {
        id: "lease_alpha",
        targetId: "task_alpha",
        holder: "atlas",
        purpose: "task.claim",
        idempotencyKey: "claim-task-alpha",
        expiresAt: "2026-05-27T00:30:00.000Z",
        status: "active",
        createdAt: "2026-05-27T00:00:00.000Z",
      },
    },
  },
  contracts: {
    agent_atlas: {
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
      fallbacks: [],
    },
  },
}

describe("runesmith cli", () => {
  test("init writes a project config", async () => {
    const host = createMemoryHost()

    const result = await runCli(["init"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Created .runesmith/config.json\n",
      stderr: "",
    })
    expect(host.readText(".runesmith/config.json")).toBe(JSON.stringify({
      version: 1,
      runtimeDir: ".runesmith/runtime",
      defaultStaleAfterMs: 120000,
    }, null, 2))
  })

  test("doctor fails with actionable readiness checks when install files are missing", async () => {
    const host = createMemoryHost(
      {
        ".runesmith/config.json": "{}",
      },
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
      },
    )

    const result = await runCli(["doctor", "--plugin-dir", ".opencode/plugins"], host)

    expect(result).toEqual({
      exitCode: 1,
      stdout: [
        "Runesmith doctor",
        "config: found (.runesmith/config.json)",
        "runtime capsule: missing (.runesmith/runtime/capsule.json)",
        "opencode cli: found (opencode) - E:/tools/opencode.exe",
        "opencode plugin: missing (.opencode/plugins/runesmith.ts)",
        "loop smoke: passed (mission completed)",
        "status: incomplete",
        "next: run `runesmith up` to initialize config, runtime, and OpenCode plugin wiring.",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("doctor fails with an OpenCode install hint when the opencode command is missing", async () => {
    const host = createMemoryHost({
      ".runesmith/config.json": "{}",
      ".runesmith/runtime/capsule.json": JSON.stringify({
        version: 1,
        updatedAt: "2026-05-27T00:00:00.000Z",
        runtime: {
          graphs: {},
          ledgers: {},
          leases: { leases: {} },
          contracts: {},
        },
      }),
      ".opencode/plugins/runesmith.ts": "export { default } from \"@runesmith/opencode-adapter\"",
    })

    const result = await runCli(["doctor", "--plugin-dir", ".opencode/plugins"], host)

    expect(result).toEqual({
      exitCode: 1,
      stdout: [
        "Runesmith doctor",
        "config: found (.runesmith/config.json)",
        "runtime capsule: valid (.runesmith/runtime/capsule.json)",
        "opencode cli: missing (opencode) - command not found; install OpenCode CLI before launch",
        "opencode plugin: found (.opencode/plugins/runesmith.ts)",
        "loop smoke: passed (mission completed)",
        "status: incomplete",
        "next: install OpenCode CLI, then run `runesmith up` and `runesmith doctor`.",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("doctor reports ready after up installs the runtime and OpenCode shim", async () => {
    const host = createMemoryHost(
      {},
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
      },
    )

    const up = await runCli([
      "up",
      "--plugin-dir",
      ".opencode/plugins",
      "--source",
      "E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
    ], host)
    expect(up.exitCode).toBe(0)

    const result = await runCli(["doctor", "--plugin-dir", ".opencode/plugins"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith doctor",
        "config: found (.runesmith/config.json)",
        "runtime capsule: valid (.runesmith/runtime/capsule.json)",
        "opencode cli: found (opencode) - E:/tools/opencode.exe",
        "opencode plugin: found (.opencode/plugins/runesmith.ts)",
        "loop smoke: passed (mission completed)",
        "status: ready",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("doctor validates npm-mode OpenCode plugin config", async () => {
    const host = createMemoryHost(
      {},
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
      },
    )

    const up = await runCli([
      "up",
      "--mode",
      "npm",
      "--config",
      "opencode.jsonc",
      "--package",
      "runesmith@0.2.0",
    ], host)
    expect(up.exitCode).toBe(0)

    const result = await runCli(["doctor", "--mode", "npm", "--config", "opencode.jsonc"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith doctor",
        "config: found (.runesmith/config.json)",
        "runtime capsule: valid (.runesmith/runtime/capsule.json)",
        "opencode cli: found (opencode) - E:/tools/opencode.exe",
        "opencode plugin: found (opencode.jsonc)",
        "loop smoke: passed (mission completed)",
        "status: ready",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("install writes a local OpenCode plugin shim", async () => {
    const host = createMemoryHost()

    const result = await runCli([
      "install",
      "--plugin-dir",
      ".opencode/plugins",
      "--source",
      "E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Installed Runesmith local plugin",
        "plugin: .opencode/plugins/runesmith.ts",
        "source: file:///E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
        "covenant: automatic",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(host.readText(".opencode/plugins/runesmith.ts")).toBe([
      "// Generated by Runesmith. Re-run `runesmith install` to refresh.",
      "export { default } from \"file:///E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts\"",
      "",
    ].join("\n"))
  })

  test("install can add an npm plugin entry to opencode config without duplicates", async () => {
    const host = createMemoryHost({
      "opencode.jsonc": "{\n  // keep my plugin\n  \"plugin\": [\"existing-plugin\", \"runesmith@0.1.0\"]\n}\n",
    })

    const result = await runCli([
      "install",
      "--mode",
      "npm",
      "--config",
      "opencode.jsonc",
      "--package",
      "runesmith@0.2.0",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Installed Runesmith OpenCode package plugin",
        "config: opencode.jsonc",
        "plugin: runesmith@0.2.0",
        "backup: opencode.jsonc.runesmith.bak",
        "covenant: automatic",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(host.readText("opencode.jsonc")).toContain("\"existing-plugin\"")
    expect(host.readText("opencode.jsonc")).toContain("\"runesmith@0.2.0\"")
    expect(host.readText("opencode.jsonc")).not.toContain("\"runesmith@0.1.0\"")
    expect(host.readText("opencode.jsonc.runesmith.bak")).toContain("\"runesmith@0.1.0\"")
  })

  test("install npm mode defaults to the git-installable Runesmith package", async () => {
    const host = createMemoryHost()

    const result = await runCli([
      "install",
      "--mode",
      "npm",
      "--config",
      "opencode.jsonc",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Installed Runesmith OpenCode package plugin",
        "config: opencode.jsonc",
        "plugin: runesmith@git+https://github.com/pasmud/runesmith.git",
        "backup: none",
        "covenant: automatic",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(host.readText("opencode.jsonc")).toContain("\"runesmith@git+https://github.com/pasmud/runesmith.git\"")
  })

  test("up npm mode presents the direct OpenCode package install path", async () => {
    const host = createMemoryHost(
      {},
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
      },
    )

    const result = await runCli([
      "up",
      "--mode",
      "npm",
      "--config",
      "opencode.jsonc",
      "--package",
      "runesmith@0.2.0",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS is ready",
        "config: .runesmith/config.json",
        "install: package",
        "opencode config: opencode.jsonc",
        "plugin: runesmith@0.2.0",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: found E:/tools/opencode.exe",
        "covenant: automatic",
        "dashboard: bun run dev:dashboard",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(host.readText("opencode.jsonc")).toContain("\"runesmith@0.2.0\"")
  })

  test("up initializes the workspace, wires OpenCode, and creates the runtime capsule", async () => {
    const host = createMemoryHost(
      {},
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
      },
    )

    const result = await runCli([
      "up",
      "--plugin-dir",
      ".opencode/plugins",
      "--source",
      "E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS is ready",
        "config: .runesmith/config.json",
        "install: local shim",
        "plugin: .opencode/plugins/runesmith.ts",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: found E:/tools/opencode.exe",
        "covenant: automatic",
        "dashboard: bun run dev:dashboard",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(host.readText(".runesmith/config.json")).toContain("\"runtimeDir\": \".runesmith/runtime\"")
    expect(host.readText(".opencode/plugins/runesmith.ts")).toContain("opencode-adapter/src/plugin.ts")

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    expect(capsule).toMatchObject({
      version: 1,
      runtime: {
        graphs: {},
        ledgers: {},
        leases: { leases: {} },
        contracts: {},
      },
    })
    expect(typeof capsule.updatedAt).toBe("string")
  })

  test("up reports a staged install when the OpenCode CLI is missing", async () => {
    const host = createMemoryHost()

    const result = await runCli([
      "up",
      "--plugin-dir",
      ".opencode/plugins",
      "--source",
      "E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS is staged",
        "config: .runesmith/config.json",
        "install: local shim",
        "plugin: .opencode/plugins/runesmith.ts",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: missing (install OpenCode CLI, then run `runesmith doctor`)",
        "covenant: automatic",
        "dashboard: bun run dev:dashboard",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("status prints the install state and current Loop Pulse", async () => {
    const host = createMemoryHost(
      {
        ".runesmith/config.json": "{}",
        ".runesmith/runtime/capsule.json": JSON.stringify({
          version: 1,
          updatedAt: "2026-05-27T00:00:00.000Z",
          runtime: snapshot,
        }),
      },
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
      },
    )

    const result = await runCli(["status"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS",
        "state: ready",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: found E:/tools/opencode.exe",
        "next: Capture proof [attention/high]",
        "plan: Run targeted verification -> Advance evidence gate",
        "handoff: Capture proof for task_alpha: record test-result evidence before completion.",
        "proof plan: bun test",
        "mission map: 1 task; next task_alpha",
        "scope sentinel: clear; 0 findings",
        "review lens: waiting-for-proof; 1 finding",
        "mission: mission_alpha running Build Runesmith",
        "task: task_alpha running Mission root",
        "missing evidence: test-result",
        "diagnostics: none",
        "active runes: Proofwright",
        "runebook: Proofwright proof gate [auto]",
        "runebook commands: bun test",
        "protocol: Proofwright Proof Protocol [auto]",
        "dashboard: bun run dev:dashboard",
        "launch: runesmith launch -- <opencode args>",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("status stays useful before bootstrap", async () => {
    const host = createMemoryHost()

    const result = await runCli(["status"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS",
        "state: uninitialized",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: missing",
        "next: Wait for goal [clear/low]",
        "plan: Wait for user goal",
        "handoff: No active mission is waiting. Start a mission from the next coding goal.",
        "proof plan: none",
        "mission map: none",
        "scope sentinel: idle; 0 findings",
        "review lens: idle; 0 findings",
        "mission: none",
        "task: none",
        "missing evidence: none",
        "diagnostics: none",
        "active runes: Pathfinder",
        "runebook: Pathfinder mission intake [auto]",
        "runebook commands: none",
        "protocol: Pathfinder Intake Protocol [auto]",
        "dashboard: bun run dev:dashboard",
        "launch: runesmith launch -- <opencode args>",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("launch bootstraps Runesmith and runs OpenCode with pass-through args", async () => {
    const launched: Array<{ command: string; args: string[] }> = []
    const host = createMemoryHost(
      {},
      {
        commands: {
          opencode: "E:/tools/opencode.exe",
        },
        runCommand(command, args) {
          launched.push({ command, args })
          return {
            exitCode: 0,
            stdout: "OpenCode started\n",
            stderr: "",
          }
        },
      },
    )

    const result = await runCli([
      "launch",
      "--plugin-dir",
      ".opencode/plugins",
      "--source",
      "E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
      "--",
      "--help",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS is ready",
        "config: .runesmith/config.json",
        "install: local shim",
        "plugin: .opencode/plugins/runesmith.ts",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: found E:/tools/opencode.exe",
        "covenant: automatic",
        "dashboard: bun run dev:dashboard",
        "",
        "launch: E:/tools/opencode.exe --help",
        "OpenCode started",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(launched).toEqual([
      {
        command: "E:/tools/opencode.exe",
        args: ["--help"],
      },
    ])
  })

  test("launch refuses to run when the OpenCode CLI is missing", async () => {
    const host = createMemoryHost()

    const result = await runCli([
      "launch",
      "--plugin-dir",
      ".opencode/plugins",
      "--source",
      "E:/dev/Oh-my/runesmith/packages/opencode-adapter/src/plugin.ts",
    ], host)

    expect(result).toEqual({
      exitCode: 1,
      stdout: [
        "Runesmith OS is staged",
        "config: .runesmith/config.json",
        "install: local shim",
        "plugin: .opencode/plugins/runesmith.ts",
        "runtime: .runesmith/runtime/capsule.json",
        "opencode: missing (install OpenCode CLI, then run `runesmith doctor`)",
        "covenant: automatic",
        "dashboard: bun run dev:dashboard",
        "",
      ].join("\n"),
      stderr: "OpenCode CLI not found. Install OpenCode CLI, then rerun `runesmith launch`.\n",
    })
  })

  test("mission list prints mission summaries from a snapshot", async () => {
    const host = createMemoryHost({
      "snapshot.json": JSON.stringify(snapshot),
    })

    const result = await runCli(["mission", "list", "--snapshot", "snapshot.json"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: "mission_alpha running Build Runesmith\n",
      stderr: "",
    })
  })

  test("mission list reads the default runtime capsule without a snapshot flag", async () => {
    const host = createMemoryHost({
      ".runesmith/runtime/capsule.json": JSON.stringify({
        version: 1,
        updatedAt: "2026-05-27T00:00:00.000Z",
        runtime: snapshot,
      }),
    })

    const result = await runCli(["mission", "list"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: "mission_alpha running Build Runesmith\n",
      stderr: "",
    })
  })

  test("mission start bootstraps a planned covenant mission into the runtime capsule", async () => {
    const host = createMemoryHost()

    const result = await runCli(["mission", "start", "Build direct CLI orchestration"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Mission started",
        "mission: mission_cli_1",
        "task: task_cli_1",
        "lease: lease_cli_1",
        "goal: Build direct CLI orchestration",
        "next: Continue forge [attention/high]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(host.readText(".runesmith/config.json")).toContain("\"runtimeDir\": \".runesmith/runtime\"")

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    const graph = capsule.runtime.graphs.mission_cli_1
    expect(graph.mission.goal).toBe("Build direct CLI orchestration")
    expect(Object.keys(graph.tasks)).toEqual([
      "task_cli_1",
      "task_cli_1_review",
      "task_cli_1_seal",
    ])
    expect(graph.tasks.task_cli_1).toMatchObject({
      status: "running",
      assignedAgentId: "agent_atlas",
      requiredEvidence: ["file-change", "test-result"],
    })
    expect(capsule.runtime.contracts.agent_atlas.displayName).toBe("Atlas")
    expect(capsule.runtime.leases.leases.lease_cli_1).toMatchObject({
      targetId: "task_cli_1",
      holder: "runesmith-cli",
      status: "active",
    })
  })

  test("mission start requires a goal", async () => {
    const host = createMemoryHost()

    const result = await runCli(["mission", "start"], host)

    expect(result).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "Usage: runesmith mission start <goal>\n",
    })
  })

  test("mission evidence and tick complete the persisted covenant loop", async () => {
    const host = createMemoryHost()

    await runCli(["mission", "start", "Ship CLI autopilot loop"], host)
    const fileEvidence = await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "file-change",
      "--summary",
      "Updated CLI loop",
      "--payload-json",
      "{\"files\":[\"packages/cli/src/index.ts\"]}",
    ], host)
    const testEvidence = await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "test-result",
      "--summary",
      "CLI tests passed",
      "--payload-json",
      "{\"command\":\"bun test packages/cli/tests\",\"exitCode\":0}",
    ], host)
    const tick = await runCli(["mission", "tick"], host)

    expect(fileEvidence).toEqual({
      exitCode: 0,
      stdout: [
        "Evidence recorded",
        "mission: mission_cli_1",
        "task: task_cli_1",
        "evidence: evidence_cli_1",
        "type: file-change",
        "next: Capture proof [attention/high]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(testEvidence).toEqual({
      exitCode: 0,
      stdout: [
        "Evidence recorded",
        "mission: mission_cli_1",
        "task: task_cli_1",
        "evidence: evidence_cli_2",
        "type: test-result",
        "next: Review change [clear/medium]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(tick).toEqual({
      exitCode: 0,
      stdout: [
        "Mission advanced",
        "status: completed",
        "mission: mission_cli_1",
        "task: task_cli_1_seal",
        "mission status: complete",
        "next: Wait for goal [clear/low]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    const graph = capsule.runtime.graphs.mission_cli_1
    expect(graph.mission.status).toBe("complete")
    expect(graph.tasks.task_cli_1.status).toBe("complete")
    expect(graph.tasks.task_cli_1_review.status).toBe("complete")
    expect(graph.tasks.task_cli_1_seal.status).toBe("complete")
    expect(Object.values(capsule.runtime.ledgers.mission_cli_1.evidence).map((entry: any) => entry.type)).toEqual([
      "file-change",
      "test-result",
      "decision",
      "decision",
    ])
  })

  test("prove runs the active proof plan and advances the runtime capsule", async () => {
    const launched: Array<{ command: string }> = []
    const host = createMemoryHost(
      {
        "package.json": JSON.stringify({
          packageManager: "bun@1.3.13",
          scripts: {
            test: "bun test",
          },
        }),
        ".runesmith/runtime/capsule.json": JSON.stringify({
          version: 1,
          updatedAt: "2026-05-27T00:00:00.000Z",
          runtime: snapshot,
        }),
      },
      {
        runShellCommand(command) {
          launched.push({ command })
          return {
            exitCode: 0,
            stdout: "tests passed\n",
            stderr: "",
          }
        },
      },
    )

    const result = await runCli(["prove"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Proof plan executed",
        "mission: mission_alpha",
        "task: task_alpha",
        "- PASS Run tests: bun test",
        "status: completed",
        "next: Wait for goal [clear/low]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(launched).toEqual([{ command: "bun test" }])

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    const graph = capsule.runtime.graphs.mission_alpha
    const evidence = Object.values(capsule.runtime.ledgers.mission_alpha.evidence) as any[]
    expect(graph.mission.status).toBe("complete")
    expect(graph.tasks.task_alpha.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "test-result",
          summary: "Run tests passed: bun test",
          payload: expect.objectContaining({
            command: "bun test",
            exitCode: 0,
            stdout: "tests passed\n",
          }),
        }),
      ]),
    )
  })

  test("next runs the active Runebook action without choosing a low-level command", async () => {
    const launched: Array<{ command: string }> = []
    const host = createMemoryHost(
      {
        "package.json": JSON.stringify({
          packageManager: "bun@1.3.13",
          scripts: {
            test: "bun test",
          },
        }),
        ".runesmith/runtime/capsule.json": JSON.stringify({
          version: 1,
          updatedAt: "2026-05-27T00:00:00.000Z",
          runtime: snapshot,
        }),
      },
      {
        runShellCommand(command) {
          launched.push({ command })
          return {
            exitCode: 0,
            stdout: "tests passed\n",
            stderr: "",
          }
        },
      },
    )

    const result = await runCli(["next"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runebook next",
        "action: capture-proof",
        "card: Proofwright proof gate [auto]",
        "mission: mission_alpha",
        "task: task_alpha",
        "- PASS Run tests: bun test",
        "status: proof-passed",
        "next status: completed",
        "next: Wait for goal [clear/low]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(launched).toEqual([{ command: "bun test" }])

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    expect(capsule.runtime.graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("run weaves OS actions until proof-ready work is sealed", async () => {
    const launched: Array<{ command: string }> = []
    const host = createMemoryHost(
      {
        "package.json": JSON.stringify({
          packageManager: "bun@1.3.13",
          scripts: {
            test: "bun test",
          },
        }),
        ".runesmith/runtime/capsule.json": JSON.stringify({
          version: 1,
          updatedAt: "2026-05-27T00:00:00.000Z",
          runtime: snapshot,
        }),
      },
      {
        runShellCommand(command) {
          launched.push({ command })
          return {
            exitCode: 0,
            stdout: "tests passed\n",
            stderr: "",
          }
        },
      },
    )

    const result = await runCli(["run", "--max-steps", "4"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Runesmith OS run",
        "status: sealed",
        "reason: No active mission remains after verified work was sealed.",
        "steps: 1",
        "1. capture-proof -> proof-passed",
        "- PASS Run tests: bun test",
        "next: Wait for goal [clear/low]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(launched).toEqual([{ command: "bun test" }])

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    expect(capsule.runtime.graphs.mission_alpha.mission.status).toBe("complete")
  })

  test("prove records a diagnostic and stops when the proof command fails", async () => {
    const launched: Array<{ command: string }> = []
    const host = createMemoryHost(
      {
        ".runesmith/runtime/capsule.json": JSON.stringify({
          version: 1,
          updatedAt: "2026-05-27T00:00:00.000Z",
          runtime: snapshot,
        }),
      },
      {
        runShellCommand(command) {
          launched.push({ command })
          return {
            exitCode: 1,
            stdout: "",
            stderr: "1 fail\n",
          }
        },
      },
    )

    const result = await runCli(["prove"], host)

    expect(result).toEqual({
      exitCode: 1,
      stdout: [
        "Proof plan failed",
        "mission: mission_alpha",
        "task: task_alpha",
        "- FAIL Run tests: bun test",
        "status: failed",
        "next: Repair diagnostic [attention/high]",
        "diagnostics: Run tests failed: bun test",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(launched).toEqual([{ command: "bun test" }])

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    const graph = capsule.runtime.graphs.mission_alpha
    const evidence = Object.values(capsule.runtime.ledgers.mission_alpha.evidence) as any[]
    expect(graph.mission.status).toBe("running")
    expect(graph.tasks.task_alpha.status).toBe("running")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task_alpha",
          type: "diagnostic",
          summary: "Run tests failed: bun test",
          payload: expect.objectContaining({
            command: "bun test",
            exitCode: 1,
            stderr: "1 fail\n",
          }),
        }),
      ]),
    )
  })

  test("mission evidence and tick surface repair diagnostics", async () => {
    const host = createMemoryHost()

    await runCli(["mission", "start", "Repair failing CLI proof"], host)
    await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "file-change",
      "--summary",
      "Updated CLI files",
      "--payload-json",
      "{\"files\":[\"packages/cli/src/index.ts\"]}",
    ], host)
    const diagnostic = await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "diagnostic",
      "--summary",
      "CLI tests failed",
      "--payload-json",
      "{\"command\":\"bun test packages/cli/tests\",\"exitCode\":1}",
    ], host)
    const tick = await runCli(["mission", "tick"], host)
    const inspect = await runCli(["mission", "inspect", "mission_cli_1"], host)

    expect(diagnostic).toEqual({
      exitCode: 0,
      stdout: [
        "Evidence recorded",
        "mission: mission_cli_1",
        "task: task_cli_1",
        "evidence: evidence_cli_2",
        "type: diagnostic",
        "next: Repair diagnostic [attention/high]",
        "diagnostics: CLI tests failed",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(tick).toEqual({
      exitCode: 0,
      stdout: [
        "Mission advanced",
        "status: waiting-for-evidence",
        "mission: mission_cli_1",
        "task: task_cli_1",
        "mission status: running",
        "next: Repair diagnostic [attention/high]",
        "diagnostics: CLI tests failed",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })
    expect(inspect.stdout).toContain("Diagnostics: CLI tests failed")
    expect(inspect.stdout).toContain("Active runes: Faultwright, Proofwright")
    expect(inspect.stdout).toContain("Runebook:")
    expect(inspect.stdout).toContain("Active card: Faultwright repair loop [guarded]")
    expect(inspect.stdout).toContain("Commands: bun test packages/cli/tests -> bun test")
    expect(inspect.stdout).toContain("Mission memory:")
    expect(inspect.stdout).toContain("Handoff: Repair task_cli_1: CLI tests failed. Rerun proof after the smallest fix.")
    expect(inspect.stdout).toContain("Proof plan:")
    expect(inspect.stdout).toContain("- Rerun failing command: bun test packages/cli/tests")
  })

  test("risk resolve records a decision and advances the active mission", async () => {
    const host = createMemoryHost()

    await runCli(["mission", "start", "Resolve CLI risk"], host)
    await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "file-change",
      "--summary",
      "Updated CLI files",
      "--payload-json",
      "{\"files\":[\"packages/cli/src/index.ts\"]}",
    ], host)
    await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "test-result",
      "--summary",
      "CLI tests passed",
      "--payload-json",
      "{\"command\":\"bun test packages/cli/tests\",\"exitCode\":0}",
    ], host)
    await runCli([
      "mission",
      "evidence",
      "mission_cli_1",
      "task_cli_1",
      "--type",
      "risk",
      "--summary",
      "Deletes generated user files without confirmation",
      "--payload-json",
      "{\"severity\":\"high\"}",
    ], host)

    const result = await runCli([
      "risk",
      "resolve",
      "--verdict",
      "accepted",
      "--summary",
      "Operator accepts generated-file deletion after review",
    ], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Risk resolved",
        "mission: mission_cli_1",
        "task: task_cli_1",
        "evidence: evidence_cli_4",
        "verdict: accepted",
        "status: completed",
        "next: Wait for goal [clear/low]",
        "runtime: .runesmith/runtime/capsule.json",
        "",
      ].join("\n"),
      stderr: "",
    })

    const capsule = JSON.parse(host.readText(".runesmith/runtime/capsule.json"))
    const graph = capsule.runtime.graphs.mission_cli_1
    const evidence = Object.values(capsule.runtime.ledgers.mission_cli_1.evidence) as any[]
    expect(graph.mission.status).toBe("complete")
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "evidence_cli_4",
          taskId: "task_cli_1",
          type: "decision",
          summary: "Risk accepted: Operator accepts generated-file deletion after review",
        }),
      ]),
    )
  })

  test("mission inspect prints graph details from a snapshot", async () => {
    const host = createMemoryHost({
      "snapshot.json": JSON.stringify(snapshot),
    })

    const result = await runCli(["mission", "inspect", "mission_alpha", "--snapshot", "snapshot.json"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Mission mission_alpha",
        "Status: running",
        "Goal: Build Runesmith",
        "Loop Pulse: Capture proof [attention/high]",
        "Next reason: The active task cannot complete until missing verification evidence is captured.",
        "Mission memory:",
        "Handoff: Capture proof for task_alpha: record test-result evidence before completion.",
        "Proof: missing test-result",
        "Proof plan:",
        "- Run tests: bun test",
        "Mission map:",
        "Summary: mission_alpha maps 1 tasks for Build Runesmith. Next task: task_alpha.",
        "- running root task_alpha: Mission root; ready: no; blocked by: none; required evidence: file-change, test-result",
        "Scope sentinel:",
        "Summary: task_alpha changed 1 file inside scope.",
        "- packages/core/src/runtime.ts: in-scope",
        "Findings: none",
        "Review lens:",
        "Summary: mission_alpha review is waiting for proof on task_alpha.",
        "- proof-freshness: blocked - task_alpha still needs passing test-result evidence.",
        "Findings: Missing test-result evidence for task_alpha.",
        "Required evidence: file-change, test-result",
        "Missing evidence: test-result",
        "Active runes: Proofwright",
        "Runebook:",
        "Active card: Proofwright proof gate [auto]",
        "Commands: bun test",
        "Tool hints: runesmith_proof_run",
        "Protocol:",
        "Active protocol: Proofwright Proof Protocol [auto]",
        "Forbidden moves: Do not mark completion from transcript confidence alone., Do not reuse proof that is older than the latest file-change or diagnostic.",
        "Tasks:",
        "- task_alpha running agent_atlas Mission root",
        "Evidence:",
        "- evidence_file task_alpha file-change Changed runtime",
        "Leases:",
        "- lease_alpha active task_alpha atlas expires 2026-05-27T00:30:00.000Z",
        "",
      ].join("\n"),
      stderr: "",
    })
  })

  test("mission inspect reads the default runtime capsule without a snapshot flag", async () => {
    const host = createMemoryHost({
      ".runesmith/runtime/capsule.json": JSON.stringify({
        version: 1,
        updatedAt: "2026-05-27T00:00:00.000Z",
        runtime: snapshot,
      }),
    })

    const result = await runCli(["mission", "inspect", "mission_alpha"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: [
        "Mission mission_alpha",
        "Status: running",
        "Goal: Build Runesmith",
        "Loop Pulse: Capture proof [attention/high]",
        "Next reason: The active task cannot complete until missing verification evidence is captured.",
        "Mission memory:",
        "Handoff: Capture proof for task_alpha: record test-result evidence before completion.",
        "Proof: missing test-result",
        "Proof plan:",
        "- Run tests: bun test",
        "Mission map:",
        "Summary: mission_alpha maps 1 tasks for Build Runesmith. Next task: task_alpha.",
        "- running root task_alpha: Mission root; ready: no; blocked by: none; required evidence: file-change, test-result",
        "Scope sentinel:",
        "Summary: task_alpha changed 1 file inside scope.",
        "- packages/core/src/runtime.ts: in-scope",
        "Findings: none",
        "Review lens:",
        "Summary: mission_alpha review is waiting for proof on task_alpha.",
        "- proof-freshness: blocked - task_alpha still needs passing test-result evidence.",
        "Findings: Missing test-result evidence for task_alpha.",
        "Required evidence: file-change, test-result",
        "Missing evidence: test-result",
        "Active runes: Proofwright",
        "Runebook:",
        "Active card: Proofwright proof gate [auto]",
        "Commands: bun test",
        "Tool hints: runesmith_proof_run",
        "Protocol:",
        "Active protocol: Proofwright Proof Protocol [auto]",
        "Forbidden moves: Do not mark completion from transcript confidence alone., Do not reuse proof that is older than the latest file-change or diagnostic.",
        "Tasks:",
        "- task_alpha running agent_atlas Mission root",
        "Evidence:",
        "- evidence_file task_alpha file-change Changed runtime",
        "Leases:",
        "- lease_alpha active task_alpha atlas expires 2026-05-27T00:30:00.000Z",
        "",
      ].join("\n"),
      stderr: "",
    })
  })
})
