import { deriveDispatchMatrix, selectDispatchAgentForTask, type DispatchMatrix } from "./dispatch-matrix.js"
import { deriveLoopPulse, type LoopPulse } from "./loop-pulse.js"
import { type MissionTaskPlanItem } from "./mission-graph.js"
import { derivePlanContract, type PlanContract } from "./plan-contract.js"
import { advanceRunicMissionLoop, selectRunicLoopTask, type RunicMissionLoopStatus } from "./runic-loop.js"
import type { RunesmithRuntime } from "./runtime.js"
import { runtimeError } from "./errors.js"
import { err, ok, type AgentContract, type Result } from "./types.js"

export type RunicPlanRefinementOptions = {
  missionId?: string
  taskPlan: MissionTaskPlanItem[]
  contract: AgentContract
  holder: string
  idempotencyScope: string
  ttlMs: number
  evidenceId?: string
  now?: () => Date
}

export type RunicPlanRefinementValue = {
  status: RunicMissionLoopStatus
  missionId: string
  rootTaskId: string
  taskCount: number
  evidenceId: string
  planContract: PlanContract
  dispatchMatrix: DispatchMatrix
  loopPulse: LoopPulse
}

type RefinementSliceId =
  | "repair"
  | "runtime"
  | "install"
  | "interface"
  | "docs"
  | "focused"

type RefinementSliceDefinition = {
  id: RefinementSliceId
  key: string
  title: string
  capabilities: string[]
  description: (goal: string) => string
}

const refinementSliceDefinitions: Record<RefinementSliceId, RefinementSliceDefinition> = {
  repair: {
    id: "repair",
    key: "repair-forge",
    title: "Forge: focused repair path",
    capabilities: ["typescript", "testing"],
    description: (goal) =>
      `Diagnose and repair the failing behavior for "${goal}" with one scoped change path and fresh proof.`,
  },
  runtime: {
    id: "runtime",
    key: "runtime-forge",
    title: "Forge: orchestration engine path",
    capabilities: ["typescript", "testing"],
    description: (goal) =>
      `Implement engine, state, adapter, or proof-gate changes required for "${goal}".`,
  },
  install: {
    id: "install",
    key: "install-forge",
    title: "Forge: direct install surface",
    capabilities: ["typescript", "testing", "repository-maintenance"],
    description: (goal) =>
      `Implement CLI, plugin, configuration, or setup changes required for "${goal}" to work through direct install.`,
  },
  interface: {
    id: "interface",
    key: "interface-forge",
    title: "Forge: operator interface path",
    capabilities: ["typescript", "ui", "accessibility"],
    description: (goal) =>
      `Implement dashboard, component, interaction, or accessibility changes required for "${goal}".`,
  },
  docs: {
    id: "docs",
    key: "docs-forge",
    title: "Forge: documentation and handoff path",
    capabilities: ["documentation", "repository-maintenance"],
    description: (goal) =>
      `Update installation, recovery, operator, or release documentation required for "${goal}" and prove the package still validates.`,
  },
  focused: {
    id: "focused",
    key: "focused-forge",
    title: "Forge: focused implementation path",
    capabilities: ["typescript", "testing"],
    description: (goal) =>
      `Implement the smallest focused repository change required for "${goal}" with fresh proof.`,
  },
}

export function createRunicPlanRefinementTaskPlan(goal: string): MissionTaskPlanItem[] {
  const normalizedGoal = normalizeGoal(goal)
  const implementationSlices: MissionTaskPlanItem[] = selectRefinementSlices(normalizedGoal).map((slice) => ({
    key: slice.key,
    title: slice.title,
    description: slice.description(normalizedGoal),
    requiredCapabilities: [...slice.capabilities],
    requiredEvidence: ["file-change", "test-result"],
    dependsOn: ["pathfinder-plan"],
  }))
  const implementationKeys = implementationSlices.map((slice) => slice.key)

  return [
    {
      key: "pathfinder-plan",
      title: `Plan: ${normalizedGoal}`,
      description: `Convert "${normalizedGoal}" into an engine-owned execution map with explicit proof obligations.`,
      requiredCapabilities: ["typescript", "testing", "repository-maintenance"],
      requiredEvidence: ["decision"],
    },
    ...implementationSlices,
    {
      key: "proof-review",
      title: "Review: proof and risk gate",
      description: `Review implementation proof, residual risk, and operator handoff for "${normalizedGoal}".`,
      requiredCapabilities: ["testing", "review", "risk-analysis"],
      requiredEvidence: ["test-result", "decision"],
      dependsOn: implementationKeys,
    },
    {
      key: "seal-handoff",
      title: "Seal: install and handoff",
      description: `Package, document, and checkpoint the install path for "${normalizedGoal}".`,
      requiredCapabilities: ["repository-maintenance", "release", "documentation"],
      requiredEvidence: ["decision"],
      dependsOn: ["proof-review"],
    },
  ]
}

function selectRefinementSlices(goal: string): RefinementSliceDefinition[] {
  const profile = deriveGoalProfile(goal)
  if (profile.docsFocused) return [refinementSliceDefinitions.docs]

  const selected: RefinementSliceId[] = []
  if (profile.repair) selected.push("repair")
  if (profile.runtime) selected.push("runtime")
  if (profile.install) selected.push("install")
  if (profile.interface) selected.push("interface")
  if (profile.docs) selected.push("docs")
  if (selected.length === 0) selected.push("focused")

  return unique(selected).slice(0, 3).map((id) => refinementSliceDefinitions[id])
}

function deriveGoalProfile(goal: string): {
  repair: boolean
  runtime: boolean
  install: boolean
  interface: boolean
  docs: boolean
  docsFocused: boolean
} {
  const text = goal.toLowerCase()
  const docs = hasAny(text, [
    "doc",
    "docs",
    "document",
    "documentation",
    "readme",
    "install guide",
    "handoff",
    "release note",
    "changelog",
  ])
  const docsFocused = docs && hasAny(text, [
    "document",
    "write docs",
    "update docs",
    "readme",
    "install guide",
  ]) && !hasAny(text, [
    "build",
    "implement",
    "fix",
    "repair",
    "debug",
    "dashboard",
    "ui",
    "plugin",
    "adapter",
    "cli",
    "runtime",
  ])

  return {
    repair: hasAny(text, ["fix", "repair", "debug", "bug", "broken", "failing", "failure", "error", "click"]),
    runtime: hasAny(text, [
      "agent",
      "orchestrat",
      "runtime",
      "engine",
      "ignite",
      "ignition",
      "loop",
      "autopilot",
      "proof",
      "recovery",
      "state",
      "capsule",
      "mission",
      "rune",
    ]),
    install: hasAny(text, [
      "install",
      "opencode",
      "plugin",
      "adapter",
      "cli",
      "command",
      "setup",
      "bootstrap",
      "direct",
      "package",
      "doctor",
      "heal",
    ]),
    interface: hasAny(text, [
      "ui",
      "dashboard",
      "screen",
      "theme",
      "white",
      "button",
      "click",
      "sidebar",
      "panel",
      "control surface",
      "shadcn",
      "openclaw",
      "frontend",
    ]),
    docs,
    docsFocused,
  }
}

function hasAny(text: string, needles: string[]): boolean {
  return needles.some((needle) => {
    if (/^[a-z0-9]+$/.test(needle) && needle.length <= 3) {
      return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}(?=$|[^a-z0-9])`).test(text)
    }

    return text.includes(needle)
  })
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

export function refineRunicMissionPlan(
  runtime: RunesmithRuntime,
  options: RunicPlanRefinementOptions,
): Result<RunicPlanRefinementValue> {
  const missionId = options.missionId ?? selectRunicLoopTask(runtime.snapshot())?.missionId
  if (!missionId) {
    return err(runtimeError("MISSION_NOT_FOUND", "No active mission is available for plan refinement"))
  }

  const valid = validateRefinementPlan(options.taskPlan)
  if (!valid.ok) return valid

  let snapshot = runtime.snapshot()
  const refinementContract = snapshot.contracts[options.contract.id] ?? options.contract
  if (!snapshot.contracts[refinementContract.id]) {
    runtime.registerContract(refinementContract)
    snapshot = runtime.snapshot()
  }

  const refined = runtime.refineMissionPlan({
    missionId,
    taskPlan: options.taskPlan,
  })
  if (!refined.ok) return refined

  snapshot = runtime.snapshot()
  let rootTask = snapshot.graphs[missionId]?.tasks[refined.value.graph.mission.rootTaskId]
  if (!rootTask) {
    return err(runtimeError("TASK_NOT_FOUND", "Refined mission root task does not exist", {
      missionId,
      rootTaskId: refined.value.graph.mission.rootTaskId,
    }))
  }

  if (rootTask.status === "queued") {
    const claimed = runtime.claimTask({
      missionId,
      taskId: rootTask.id,
      contractId: selectDispatchAgentForTask(snapshot, rootTask.id, refinementContract.id),
      holder: options.holder,
      idempotencyKey: `${options.idempotencyScope}:${missionId}:${rootTask.id}:plan`,
      ttlMs: options.ttlMs,
    })
    if (!claimed.ok) return claimed
    rootTask = claimed.value.task
  }

  const evidenceId = options.evidenceId ?? `evidence_plan_refined_${crypto.randomUUID()}`
  const recorded = runtime.addTaskEvidence({
    missionId,
    evidence: {
      id: evidenceId,
      taskId: rootTask.id,
      type: "decision",
      summary: `Pathfinder refined mission into ${options.taskPlan.length} proof-backed task slices`,
      payload: {
        mode: "runesmith-plan-refinery",
        taskCount: options.taskPlan.length,
        tasks: options.taskPlan.map((task) => ({
          key: task.key,
          title: task.title,
          requiredCapabilities: task.requiredCapabilities ?? [],
          requiredEvidence: task.requiredEvidence ?? [],
          dependsOn: task.dependsOn ?? [],
        })),
      },
      createdAt: (options.now ?? (() => new Date()))().toISOString(),
    },
  })
  if (!recorded.ok) return recorded

  const advanced = advanceRunicMissionLoop(runtime, {
    contract: refinementContract,
    holder: options.holder,
    idempotencyScope: `${options.idempotencyScope}:refined`,
    ttlMs: options.ttlMs,
    recoverStale: false,
    now: options.now,
  })
  if (!advanced.ok) return advanced

  snapshot = runtime.snapshot()
  return ok({
    status: advanced.value.status,
    missionId,
    rootTaskId: refined.value.graph.mission.rootTaskId,
    taskCount: options.taskPlan.length,
    evidenceId,
    planContract: derivePlanContract(snapshot),
    dispatchMatrix: deriveDispatchMatrix(snapshot),
    loopPulse: deriveLoopPulse(snapshot),
  })
}

function validateRefinementPlan(taskPlan: MissionTaskPlanItem[]): Result<void> {
  const root = taskPlan[0]
  if (!root?.requiredEvidence?.includes("decision")) {
    return err(runtimeError("INVALID_TRANSITION", "Plan refinement requires the first task to record decision evidence", {
      key: root?.key,
    }))
  }

  const unprovable = taskPlan.find((task) => (task.requiredEvidence ?? []).length === 0)
  if (unprovable) {
    return err(runtimeError("INVALID_TRANSITION", "Plan refinement tasks must declare required evidence", {
      key: unprovable.key,
    }))
  }

  const implementationSlices = taskPlan.slice(1).filter((task) => {
    const evidence = task.requiredEvidence ?? []
    return evidence.includes("file-change") && evidence.includes("test-result")
  })
  if (implementationSlices.length === 0) {
    return err(runtimeError("INVALID_TRANSITION", "Plan refinement requires at least one proof-backed implementation slice"))
  }

  return ok(undefined)
}

function normalizeGoal(goal: string): string {
  return goal.trim().replace(/\s+/g, " ") || "Runesmith mission"
}
