import { describe, expect, test } from "bun:test"

import {
  createRunicPlanRefinementTaskPlan,
  createRuntime,
  deriveLeadCritic,
  deriveReviewLens,
  type AgentContract,
} from "../src/index"

const fixedNow = () => new Date("2026-05-27T00:00:00.000Z")
const ids = (prefix: string) => `${prefix}_alpha`

const atlas: AgentContract = {
  id: "agent_atlas",
  displayName: "Atlas",
  description: "Implementation agent",
  capabilities: ["typescript", "testing", "repository-maintenance", "research"],
  allowedTools: ["read", "edit", "bash", "test"],
  modelPolicy: {
    primary: "anthropic/claude-sonnet-4.5",
    fallbacks: ["openai/gpt-5.1-codex"],
  },
  fileScope: ["**"],
  completionCriteria: ["Code compiles", "Tests pass", "Lead critique passes"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

function createRuntimeWithRefinedMission() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  runtime.startMission({
    goal: "Build a polished playable 2048 game with UI, score, and high score",
    taskPlan: createRunicPlanRefinementTaskPlan("Build a polished playable 2048 game with UI, score, and high score"),
  })
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_plan",
      taskId: "task_alpha",
      type: "decision",
      summary: "Lead-blended WBS with acceptance criteria",
      payload: {
        acceptanceCriteria: ["Tiles move after keyboard input"],
        proofObligations: ["Browser smoke proves input changes board state"],
      },
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  })
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_file",
      taskId: "task_alpha_interface_forge",
      type: "file-change",
      summary: "Subagent changed playable UI files",
      payload: { files: ["index.html", "src/game.js", "public/2048.css"] },
      createdAt: "2026-05-27T00:01:00.000Z",
    },
  })
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_test",
      taskId: "task_alpha_interface_forge",
      type: "test-result",
      summary: "Unit tests passed",
      payload: { command: "node --test tests/game.test.js", exitCode: 0 },
      createdAt: "2026-05-27T00:02:00.000Z",
    },
  })

  return runtime
}

describe("lead critic", () => {
  test("requires Lead critique before refined subagent work can enter review", () => {
    const runtime = createRuntimeWithRefinedMission()

    const critic = deriveLeadCritic(runtime.snapshot())
    const reviewLens = deriveReviewLens(runtime.snapshot())

    expect(critic).toMatchObject({
      status: "needs-critique",
      missionId: "mission_alpha",
      taskId: "task_alpha_interface_forge",
      summary: "task_alpha_interface_forge needs Lead critique before review.",
    })
    expect(reviewLens.status).toBe("blocked")
    expect(reviewLens.checklist).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "lead-critique",
          status: "blocked",
        }),
      ]),
    )
  })

  test("blocks review when Lead asks for a focused revision", () => {
    const runtime = createRuntimeWithRefinedMission()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_critique",
        taskId: "task_alpha_interface_forge",
        type: "decision",
        summary: "Lead critique requested revision: instantiate UI and prove keyboard controls",
        payload: {
          stage: "lead-critique",
          verdict: "revision-requested",
          findings: ["UI class exists but is not instantiated"],
        },
        createdAt: "2026-05-27T00:03:00.000Z",
      },
    })

    const critic = deriveLeadCritic(runtime.snapshot())

    expect(critic.status).toBe("revision-requested")
    expect(critic.findings).toEqual(
      expect.arrayContaining([
        {
          severity: "critical",
          summary: "UI class exists but is not instantiated",
        },
      ]),
    )
  })

  test("passes after Lead approves the latest implementation evidence", () => {
    const runtime = createRuntimeWithRefinedMission()
    runtime.addTaskEvidence({
      missionId: "mission_alpha",
      evidence: {
        id: "evidence_critique",
        taskId: "task_alpha_interface_forge",
        type: "decision",
        summary: "Lead critique approved the WBS slice against acceptance criteria",
        payload: {
          stage: "lead-critique",
          verdict: "approved",
          checkedAgainst: ["acceptance criteria", "proof obligations", "scope"],
        },
        createdAt: "2026-05-27T00:03:00.000Z",
      },
    })

    const critic = deriveLeadCritic(runtime.snapshot())

    expect(critic.status).toBe("approved")
    expect(critic.checks.every((check) => check.status === "passed")).toBe(true)
  })
})
