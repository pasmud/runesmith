import { describe, expect, test } from "bun:test"

import {
  createRunicPlanRefinementTaskPlan,
  createRuntime,
  deriveProductionReadiness,
  deriveSealAudit,
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
  completionCriteria: ["Code compiles", "Tests pass", "Production readiness passes"],
  requiredEvidence: ["file-change", "test-result"],
  fallbacks: [],
}

function createRefinedRuntime() {
  const runtime = createRuntime({ idFactory: ids, now: fixedNow })
  runtime.registerContract(atlas)
  runtime.startMission({
    goal: "Build a polished playable 2048 game with UI, score, and high score",
    taskPlan: createRunicPlanRefinementTaskPlan("Build a polished playable 2048 game with UI, score, and high score"),
  })

  return runtime
}

function addPlanningDecision(runtime: ReturnType<typeof createRefinedRuntime>) {
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_plan",
      taskId: "task_alpha",
      type: "decision",
      summary: "Lead-blended WBS with acceptance criteria and proof obligations",
      payload: {
        acceptanceCriteria: [
          "Tiles move after keyboard input",
          "Score and high score update",
        ],
        proofObligations: [
          "Unit tests pass",
          "Browser smoke proves input changes board state",
        ],
      },
      createdAt: "2026-05-27T00:00:00.000Z",
    },
  })
}

function addInterfaceEvidence(runtime: ReturnType<typeof createRefinedRuntime>, withBrowserProof = false) {
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_file",
      taskId: "task_alpha_interface_forge",
      type: "file-change",
      summary: "Changed playable browser app files",
      payload: { files: ["index.html", "src/game.js", "public/2048.css", "tests/game.test.js"] },
      createdAt: "2026-05-27T00:01:00.000Z",
    },
  })
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_unit",
      taskId: "task_alpha_interface_forge",
      type: "test-result",
      summary: "Engine tests passed",
      payload: { command: "node --test tests/game.test.js", exitCode: 0 },
      createdAt: "2026-05-27T00:02:00.000Z",
    },
  })

  if (!withBrowserProof) return

  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_browser",
      taskId: "task_alpha_interface_forge",
      type: "test-result",
      summary: "Browser workflow smoke passed and verified keyboard input changed board state",
      payload: {
        command: "node .runesmith/proof/browser-smoke.mjs",
        exitCode: 0,
        interactions: ["ArrowRight"],
        assertions: ["board changed", "score visible"],
      },
      createdAt: "2026-05-27T00:03:00.000Z",
    },
  })
}

function addLeadCritiqueApproval(runtime: ReturnType<typeof createRefinedRuntime>) {
  runtime.addTaskEvidence({
    missionId: "mission_alpha",
    evidence: {
      id: "evidence_critique",
      taskId: "task_alpha_interface_forge",
      type: "decision",
      summary: "Lead critique approved the implementation against acceptance criteria",
      payload: {
        stage: "lead-critique",
        verdict: "approved",
      },
      createdAt: "2026-05-27T00:04:00.000Z",
    },
  })
}

describe("production readiness", () => {
  test("blocks refined product work until Scout acceptance criteria and proof obligations are recorded", () => {
    const runtime = createRefinedRuntime()
    addInterfaceEvidence(runtime, true)

    const readiness = deriveProductionReadiness(runtime.snapshot())

    expect(readiness.status).toBe("collecting-proof")
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "acceptance-criteria",
          status: "attention",
        }),
        expect.objectContaining({
          id: "proof-obligations",
          status: "attention",
        }),
      ]),
    )
  })

  test("blocks interactive UI missions until browser proof demonstrates user workflow interaction", () => {
    const runtime = createRefinedRuntime()
    addPlanningDecision(runtime)
    addInterfaceEvidence(runtime, false)

    const readiness = deriveProductionReadiness(runtime.snapshot())
    const audit = deriveSealAudit(runtime.snapshot())

    expect(readiness.status).toBe("collecting-proof")
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "browser-workflow",
          status: "attention",
          detail: expect.stringContaining(".runesmith/proof/browser-smoke.mjs"),
        }),
      ]),
    )
    expect(audit.status).toBe("blocked")
    expect(audit.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "production-readiness",
          status: "attention",
        }),
      ]),
    )
  })

  test("marks refined interactive work production-ready after criteria, proof obligations, and browser interaction proof", () => {
    const runtime = createRefinedRuntime()
    addPlanningDecision(runtime)
    addInterfaceEvidence(runtime, true)
    addLeadCritiqueApproval(runtime)

    const readiness = deriveProductionReadiness(runtime.snapshot())

    expect(readiness).toMatchObject({
      status: "ready",
      missionId: "mission_alpha",
      acceptanceCriteria: [
        "Tiles move after keyboard input",
        "Score and high score update",
      ],
      proofObligations: [
        "Unit tests pass",
        "Browser smoke proves input changes board state",
      ],
      summary: "mission_alpha satisfies the Production Seal readiness gate.",
    })
    expect(readiness.checks.every((check) => check.status === "passed")).toBe(true)
  })
})
