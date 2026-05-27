import { describe, expect, test } from "bun:test"

import {
  buildScopeSentinelPrompt,
  createRuntime,
  deriveScopeSentinel,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
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
  fileScope: ["packages/**", "docs/**"],
  completionCriteria: ["Code compiles", "Tests pass"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

function createClaimedRuntime() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  runtime.startMission({
    goal: "Guard scope drift",
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

  return runtime
}

describe("scope sentinel", () => {
  test("marks file-change evidence inside contract scope as clear", () => {
    const runtime = createClaimedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed core runtime",
        payload: { files: ["packages/core/src/runtime.ts", "docs/superpowers/specs/2026-05-27-runesmith-design.md"] },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const sentinel = deriveScopeSentinel(runtime.snapshot())
    const prompt = buildScopeSentinelPrompt(runtime.snapshot())

    expect(sentinel).toMatchObject({
      status: "clear",
      missionId: "mission_alpha",
      taskId: "task_alpha",
      agentId: "agent_atlas",
      allowedScopes: ["packages/**", "docs/**"],
      findings: [],
    })
    expect(sentinel.changes.map((change) => [change.path, change.status])).toEqual([
      ["packages/core/src/runtime.ts", "in-scope"],
      ["docs/superpowers/specs/2026-05-27-runesmith-design.md", "in-scope"],
    ])
    expect(prompt).toContain("## Runesmith Scope Sentinel")
    expect(prompt).toContain("Status: clear")
    expect(prompt).toContain("Allowed scopes: packages/**, docs/**")
  })

  test("blocks review when file-change evidence leaves the contract scope", () => {
    const runtime = createClaimedRuntime()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_file",
        taskId: "task_alpha",
        type: "file-change",
        summary: "Changed runtime and env",
        payload: {
          files: ["packages/core/src/runtime.ts"],
          filePath: ".env",
        },
        createdAt: "2026-05-27T00:01:00.000Z",
      },
    })

    const sentinel = deriveScopeSentinel(runtime.snapshot())

    expect(sentinel).toMatchObject({
      status: "blocked",
      findings: [
        {
          severity: "critical",
          summary: ".env is outside agent_atlas file scope.",
          path: ".env",
        },
      ],
    })
    expect(sentinel.changes.map((change) => [change.path, change.status])).toEqual(
      expect.arrayContaining([
        ["packages/core/src/runtime.ts", "in-scope"],
        [".env", "out-of-scope"],
      ]),
    )
    expect(sentinel.changes).toHaveLength(2)
  })
})
