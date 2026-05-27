import { describe, expect, test } from "bun:test"

import { createRuntime } from "@runesmith/core"
import { createRunesmithPlugin } from "../src/plugin"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

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
      payload: { command: "bun test packages/core/tests" },
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
})
