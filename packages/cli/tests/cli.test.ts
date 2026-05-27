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
          assignedAgentId: "agent_atlas",
          createdAt: "2026-05-27T00:00:00.000Z",
          updatedAt: "2026-05-27T00:00:00.000Z",
        },
      },
      events: [],
    },
  },
  ledgers: {},
  leases: { leases: {} },
  contracts: {},
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

  test("doctor reports workspace readiness", async () => {
    const host = createMemoryHost({
      ".runesmith/config.json": "{}",
    })

    const result = await runCli(["doctor"], host)

    expect(result).toEqual({
      exitCode: 0,
      stdout: "Runesmith doctor\nconfig: found\nruntime: ready\n",
      stderr: "",
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
        "Tasks:",
        "- task_alpha running agent_atlas Mission root",
        "",
      ].join("\n"),
      stderr: "",
    })
  })
})
