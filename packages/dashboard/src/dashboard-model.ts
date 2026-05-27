import {
  createRuntime,
  createRunicCovenant,
  createRunesmithAgentContracts,
  deriveDispatchMatrix,
  deriveMissionMap,
  deriveMissionMemory,
  deriveLoopPulse,
  derivePlanContract,
  deriveProofPlan,
  deriveRedlineProof,
  deriveRepairContract,
  deriveReviewLens,
  deriveRunicProtocolDeck,
  deriveRunebook,
  deriveScopeSentinel,
  deriveSealAudit,
  createRunesmithAgentContractMap,
  createRunicPlanRefinementTaskPlan,
  defaultRunesmithAgentContract,
  getNextCovenantStage,
  refineRunicMissionPlan,
  type AgentContract,
  type CovenantStage,
  type CovenantStageId,
  type DispatchMatrix,
  type Evidence,
  type EvidenceType,
  type LoopPulse,
  type MissionMemory,
  type MissionGraph,
  type MissionMap,
  type PlanContract,
  type ProofPlan,
  type RedlineProof,
  type RepairContract,
  type ReviewLens,
  type RunicProtocolDeck,
  type Runebook,
  type ScopeSentinel,
  type SealAudit,
  type RiskResolutionVerdict,
  type RuntimeCapsule,
  type RuntimeSnapshot,
  type TaskStatus,
} from "@runesmith/core"

export type MissionStatus = "running" | "verified" | "stale" | "blocked"

export type DashboardView = "missions" | "agents" | "covenant" | "policies" | "snapshots"

export type AgentStatus = "active" | "idle" | "reviewing" | "stalled"

export type OsMode = "guarded" | "autopilot"

export type TaskLane = "Plan" | "Build" | "Verify" | "Repair" | "Recover"

export type TaskCard = {
  id: string
  title: string
  agent: string
  status: MissionStatus
  lane: TaskLane
  summary: string
  tools: string[]
  evidence: string[]
}

export type AgentNode = {
  id: string
  name: string
  role: string
  status: AgentStatus
  activeLease: string
  capacity: number
  queue: number
  model: string
  focus: string
  successRate: number
  tools: string[]
}

export type PolicySeverity = "critical" | "high" | "medium"

export type PolicyGate = {
  id: string
  name: string
  description: string
  enabled: boolean
  severity: PolicySeverity
  coverage: number
  signal: string
}

export type SnapshotRecord = {
  id: string
  label: string
  createdAt: string
  hash: string
  tasks: number
  evidence: number
  score: number
  tone: MissionStatus
}

export type TimelineItem = {
  id: string
  label: string
  detail: string
  tone: MissionStatus
}

export type CommandLogItem = TimelineItem

export type DashboardModel = {
  activeCovenantStage: CovenantStage
  activeCovenantStageId: CovenantStageId
  activeView: DashboardView
  agents: AgentNode[]
  commandLog: CommandLogItem[]
  covenantStages: CovenantStage[]
  dispatchMatrix: DispatchMatrix
  loopPulse: LoopPulse
  missionMap: MissionMap
  missionMemory: MissionMemory
  planContract: PlanContract
  proofPlan: ProofPlan
  protocolDeck: RunicProtocolDeck
  redlineProof: RedlineProof
  repairContract: RepairContract
  reviewLens: ReviewLens
  runtimeSnapshot?: RuntimeSnapshot
  runebook: Runebook
  scopeSentinel: ScopeSentinel
  sealAudit: SealAudit
  metrics: Record<MissionStatus, number>
  mode: OsMode
  notice: string
  operationalScore: number
  policies: PolicyGate[]
  selectedAgent: AgentNode
  selectedAgentId: string
  selectedTask: TaskCard
  selectedTaskId: string
  snapshots: SnapshotRecord[]
  tasks: TaskCard[]
  timeline: TimelineItem[]
}

export type DashboardAction =
  | { type: "select-task"; taskId: string }
  | { type: "select-view"; view: DashboardView }
  | { type: "verify-selected" }
  | { type: "hold-selected" }
  | { type: "recover-stale" }
  | { type: "run-verifier" }
  | { type: "run-autopilot-cycle" }
  | { type: "run-next-action"; verdict?: RiskResolutionVerdict; summary?: string; faultlineSummary?: string }
  | { type: "run-os-loop"; maxSteps?: number; verdict?: RiskResolutionVerdict; summary?: string; faultlineSummary?: string }
  | { type: "run-proof-plan" }
  | { type: "refine-plan"; missionId?: string }
  | { type: "resolve-risk"; verdict?: RiskResolutionVerdict; summary?: string }
  | { type: "resolve-faultline"; summary?: string }
  | { type: "forge-directive"; prompt: string }
  | { type: "advance-covenant-stage" }
  | { type: "load-runtime-capsule"; capsule: RuntimeCapsule }
  | { type: "runtime-capsule-unavailable" }
  | { type: "toggle-policy"; policyId: string }
  | { type: "create-snapshot" }
  | { type: "select-agent"; agentId: string }
  | { type: "boost-agent"; agentId: string }
  | { type: "mark-notifications-read" }

const viewNotice = {
  missions: "Showing mission lanes and task evidence.",
  agents: "Showing agent capacity and leases.",
  covenant: "Showing Runic Covenant autonomous workflow.",
  policies: "Showing runtime policy gates.",
  snapshots: "Showing evidence snapshots and checkpoints.",
} satisfies Record<DashboardView, string>

const seededTasks = [
  {
    id: "task_runtime_kernel",
    title: "Mission runtime kernel",
    agent: "Atlas",
    status: "running",
    lane: "Build",
    summary: "Lease scheduler and evidence ledger are active; runtime facade is wiring task state.",
    tools: ["read", "edit", "test"],
    evidence: ["file-change", "test-result"],
  },
  {
    id: "task_contract_gate",
    title: "Agent contract gate",
    agent: "Oracle",
    status: "verified",
    lane: "Verify",
    summary: "Capability mismatch rejection and required-evidence checks are green.",
    tools: ["read", "test"],
    evidence: ["diagnostic", "test-result"],
  },
  {
    id: "task_dashboard_shell",
    title: "Mission control dashboard",
    agent: "Artificer",
    status: "running",
    lane: "Build",
    summary: "OpenClaw-style work surface with lanes, inspector, and evidence timeline.",
    tools: ["read", "edit"],
    evidence: ["decision"],
  },
  {
    id: "task_windows_paths",
    title: "Windows path resolver",
    agent: "Scout",
    status: "stale",
    lane: "Recover",
    summary: "Heartbeat missed after shell probing; scheduler recommends reassignment.",
    tools: ["bash", "diagnose"],
    evidence: ["risk"],
  },
  {
    id: "task_publish_repo",
    title: "GitHub publication",
    agent: "Steward",
    status: "blocked",
    lane: "Plan",
    summary: "Waiting for final verification and authenticated remote creation.",
    tools: ["git", "gh"],
    evidence: ["decision"],
  },
  {
    id: "task_harness_tests",
    title: "Harness testbench",
    agent: "Oracle",
    status: "verified",
    lane: "Verify",
    summary: "Duplicate prompt replay, stale recovery, and evidence gate scenarios pass.",
    tools: ["test"],
    evidence: ["test-result"],
  },
] satisfies TaskCard[]

const seededAgents = [
  {
    id: "agent_atlas",
    name: "Atlas",
    role: "Runtime builder",
    status: "active",
    activeLease: "task_runtime_kernel",
    capacity: 82,
    queue: 2,
    model: "sonnet -> gpt-5.1-codex",
    focus: "Kernel and scheduler edits",
    successRate: 94,
    tools: ["read", "edit", "test"],
  },
  {
    id: "agent_oracle",
    name: "Oracle",
    role: "Verifier",
    status: "reviewing",
    activeLease: "task_contract_gate",
    capacity: 68,
    queue: 1,
    model: "gpt-5.1-codex",
    focus: "Evidence gates and tests",
    successRate: 97,
    tools: ["read", "test", "diagnose"],
  },
  {
    id: "agent_artificer",
    name: "Artificer",
    role: "Interface smith",
    status: "active",
    activeLease: "task_dashboard_shell",
    capacity: 76,
    queue: 1,
    model: "sonnet",
    focus: "Mission control surface",
    successRate: 91,
    tools: ["read", "edit"],
  },
  {
    id: "agent_scout",
    name: "Scout",
    role: "Recovery scout",
    status: "stalled",
    activeLease: "task_windows_paths",
    capacity: 42,
    queue: 1,
    model: "gpt-5.1-codex-mini",
    focus: "Windows path diagnostics",
    successRate: 86,
    tools: ["bash", "diagnose"],
  },
  {
    id: "agent_steward",
    name: "Steward",
    role: "Release steward",
    status: "idle",
    activeLease: "task_publish_repo",
    capacity: 55,
    queue: 0,
    model: "gpt-5.1-codex",
    focus: "Repo publication and release notes",
    successRate: 89,
    tools: ["git", "gh"],
  },
] satisfies AgentNode[]

const seededPolicies = [
  {
    id: "policy_evidence_gate",
    name: "Evidence gate",
    description: "Blocks completion until required proof is attached to the task ledger.",
    enabled: true,
    severity: "critical",
    coverage: 98,
    signal: "test-result required for runtime edits",
  },
  {
    id: "policy_lease_mutex",
    name: "Lease mutex",
    description: "Prevents competing agents from advancing the same mission target.",
    enabled: true,
    severity: "critical",
    coverage: 100,
    signal: "idempotency replay active",
  },
  {
    id: "policy_tool_scope",
    name: "Tool scope firewall",
    description: "Routes each agent to the smallest useful tool set for its contract.",
    enabled: true,
    severity: "high",
    coverage: 91,
    signal: "write tools denied outside scope",
  },
  {
    id: "policy_stall_radar",
    name: "Stall radar",
    description: "Marks silent work stale and recommends reassignment before the mission drifts.",
    enabled: true,
    severity: "high",
    coverage: 86,
    signal: "Scout heartbeat missed threshold",
  },
  {
    id: "policy_human_hold",
    name: "Human hold",
    description: "Requires operator review for publication, destructive git, and release transitions.",
    enabled: true,
    severity: "medium",
    coverage: 78,
    signal: "publish_repo held for final check",
  },
] satisfies PolicyGate[]

const seededSnapshots = [
  {
    id: "snapshot_rc",
    label: "Release candidate",
    createdAt: "T-18m",
    hash: "rs_a91f2",
    tasks: 6,
    evidence: 9,
    score: 86,
    tone: "verified",
  },
  {
    id: "snapshot_recovery",
    label: "Recovery baseline",
    createdAt: "T-42m",
    hash: "rs_7c02b",
    tasks: 5,
    evidence: 7,
    score: 78,
    tone: "running",
  },
  {
    id: "snapshot_policy",
    label: "Policy hardening",
    createdAt: "T-1h",
    hash: "rs_25dd0",
    tasks: 4,
    evidence: 6,
    score: 74,
    tone: "verified",
  },
] satisfies SnapshotRecord[]

const seededTimeline = [
  {
    id: "event_lease",
    label: "Lease granted",
    detail: "Atlas owns task_runtime_kernel for task.claim",
    tone: "running",
  },
  {
    id: "event_evidence",
    label: "Evidence recorded",
    detail: "Core tests attached to task_contract_gate",
    tone: "verified",
  },
  {
    id: "event_stale",
    label: "Stall radar",
    detail: "Windows path resolver missed heartbeat threshold",
    tone: "stale",
  },
  {
    id: "event_blocked",
    label: "Publish blocked",
    detail: "Remote push waits for final verification",
    tone: "blocked",
  },
] satisfies TimelineItem[]

const seededCommandLog = [
  {
    id: "command_route",
    label: "Tools scoped",
    detail: "Atlas received read, edit, test; shell withheld until diagnostic need.",
    tone: "verified",
  },
  {
    id: "command_gate",
    label: "Completion guarded",
    detail: "Evidence gate rejected completion without test-result proof.",
    tone: "blocked",
  },
  {
    id: "command_watch",
    label: "Stall watch armed",
    detail: "Scout heartbeat threshold is being monitored by recovery policy.",
    tone: "stale",
  },
] satisfies CommandLogItem[]

export function buildDashboardModel(): DashboardModel {
  const tasks = cloneTasks(seededTasks)
  const agents = cloneAgents(seededAgents)
  const covenantStages = cloneCovenantStages(createRunicCovenant().stages)

  return deriveDashboardModel({
    activeCovenantStageId: "frame",
    activeView: "missions",
    agents,
    commandLog: cloneTimeline(seededCommandLog),
    covenantStages,
    mode: "guarded",
    notice: "Mission control is live.",
    policies: clonePolicies(seededPolicies),
    selectedAgentId: agents[0]!.id,
    selectedTaskId: tasks[0]!.id,
    snapshots: cloneSnapshots(seededSnapshots),
    tasks,
    timeline: cloneTimeline(seededTimeline),
  })
}

export function buildDashboardModelFromRuntimeCapsule(capsule: RuntimeCapsule): DashboardModel {
  return buildDashboardModelFromRuntimeSnapshot(capsule.runtime, {
    updatedAt: capsule.updatedAt,
  })
}

export function buildDashboardModelFromRuntimeSnapshot(
  snapshot: RuntimeSnapshot,
  options: { updatedAt?: string } = {},
): DashboardModel {
  const covenantStages = cloneCovenantStages(createRunicCovenant().stages)
  const graphs = Object.values(snapshot.graphs).sort((left, right) => {
    return right.mission.updatedAt.localeCompare(left.mission.updatedAt) || left.mission.id.localeCompare(right.mission.id)
  })
  const tasks = graphs.flatMap((graph) => buildTaskCardsFromGraph(snapshot, graph))

  if (tasks.length === 0) {
    return deriveDashboardModel({
      activeCovenantStageId: "frame",
      activeView: "missions",
      agents: cloneAgents(seededAgents),
      commandLog: prependTimeline([], {
        label: "Capsule empty",
        detail: "No persisted missions were found in the runtime capsule.",
        tone: "verified",
      }),
      covenantStages,
      mode: "guarded",
      notice: "Runtime capsule is empty.",
      policies: clonePolicies(seededPolicies),
      selectedAgentId: seededAgents[0]!.id,
      selectedTaskId: seededTasks[0]!.id,
      snapshots: cloneSnapshots(seededSnapshots),
      tasks: cloneTasks(seededTasks),
      timeline: cloneTimeline(seededTimeline),
    })
  }

  const agents = buildAgentsFromSnapshot(snapshot, tasks)
  const evidenceCount = Object.values(snapshot.ledgers).reduce((sum, ledger) => sum + Object.keys(ledger.evidence).length, 0)
  const topGraph = graphs[0]!
  const snapshots: SnapshotRecord[] = [
    {
      id: "snapshot_live_capsule",
      label: "Live capsule",
      createdAt: options.updatedAt ?? topGraph.mission.updatedAt,
      hash: `rs_${graphs.length}_${tasks.length}_${evidenceCount}`,
      tasks: tasks.length,
      evidence: evidenceCount,
      score: 0,
      tone: tasks.some((task) => task.status === "stale" || task.status === "blocked") ? "running" : "verified",
    },
  ]
  const timeline = buildTimelineFromSnapshot(graphs)

  return deriveDashboardModel({
    activeCovenantStageId: "frame",
    activeView: "missions",
    agents,
    commandLog: prependTimeline([], {
      label: "Capsule loaded",
      detail: `${graphs.length} mission${graphs.length === 1 ? "" : "s"} loaded from the runtime capsule.`,
      tone: "verified",
    }),
    covenantStages,
    mode: "guarded",
    notice: `Loaded runtime capsule from ${options.updatedAt ?? "local disk"}.`,
    policies: buildPoliciesFromSnapshot(snapshot, evidenceCount),
    runtimeSnapshot: snapshot,
    selectedAgentId: agents[0]?.id ?? seededAgents[0]!.id,
    selectedTaskId: selectRuntimeSelectedTaskId(snapshot, tasks),
    snapshots,
    tasks,
    timeline,
  })
}

export function reduceDashboardModel(model: DashboardModel, action: DashboardAction): DashboardModel {
  switch (action.type) {
    case "select-task": {
      const selectedTask = model.tasks.find((task) => task.id === action.taskId)

      if (!selectedTask) {
        return deriveDashboardModel({
          ...model,
          notice: "That task is no longer on the mission board.",
        })
      }

      return deriveDashboardModel({
        ...model,
        selectedTaskId: selectedTask.id,
        notice: `Inspecting ${selectedTask.title}.`,
      })
    }

    case "select-view":
      return deriveDashboardModel({
        ...model,
        activeView: action.view,
        notice: viewNotice[action.view],
      })

    case "verify-selected":
      return verifySelectedTask(model, {
        label: "Verification complete",
        detailPrefix: "Verifier recorded required evidence for",
        noticePrefix: "Verified",
      })

    case "hold-selected":
      return mutateSelectedTask(model, {
        timelineLabel: "Task held",
        timelineTone: "blocked",
        commandLabel: "Lease held",
        notice: (task) => `Held ${task.title} for operator review.`,
        mutate: (task) => ({
          ...task,
          status: "blocked",
          lane: "Plan",
          summary: "Paused for operator review; active leases are suspended until the task is resumed.",
          evidence: addEvidence(task.evidence, "risk"),
        }),
      })

    case "recover-stale":
      return recoverStaleTasks(model, {
        timelineLabel: "Recovery dispatched",
        commandLabel: "Recovered stale lease",
        noticePrefix: "Recovered",
      })

    case "run-verifier":
      return verifySelectedTask(model, {
        label: "Verifier passed",
        detailPrefix: "OpenCode verifier completed evidence checks for",
        noticePrefix: "Verifier passed for",
      })

    case "run-proof-plan":
      return verifySelectedTask(model, {
        label: "Proof plan passed",
        commandLabel: "Proof plan passed",
        detailPrefix: "Runesmith proof plan completed for",
        noticePrefix: "Proof plan passed for",
      })

    case "refine-plan":
      return refinePlanInModel(model, action)

    case "run-next-action":
      return runNextActionInModel(model, action)

    case "run-os-loop":
      return runOsLoopInModel(model, action)

    case "resolve-risk":
      return resolveRiskInModel(model, action)

    case "resolve-faultline":
      return resolveFaultlineInModel(model, action)

    case "run-autopilot-cycle":
      return runAutopilotCycle(model)

    case "forge-directive":
      return forgeDirective(model, action.prompt)

    case "advance-covenant-stage":
      return advanceCovenantStage(model)

    case "load-runtime-capsule":
      return buildDashboardModelFromRuntimeCapsule(action.capsule)

    case "runtime-capsule-unavailable":
      return deriveDashboardModel({
        ...model,
        notice: "No runtime capsule found; showing seeded mission control.",
      })

    case "toggle-policy":
      return togglePolicy(model, action.policyId)

    case "create-snapshot":
      return createSnapshot(model)

    case "select-agent": {
      const agent = model.agents.find((item) => item.id === action.agentId)

      if (!agent) {
        return deriveDashboardModel({
          ...model,
          notice: "That agent is no longer in the mesh.",
        })
      }

      return deriveDashboardModel({
        ...model,
        activeView: "agents",
        selectedAgentId: agent.id,
        notice: `Focused ${agent.name} in the agent mesh.`,
      })
    }

    case "boost-agent":
      return boostAgent(model, action.agentId)

    case "mark-notifications-read":
      return deriveDashboardModel({
        ...model,
        commandLog: [],
        notice: "Marked command notifications read.",
      })
  }
}

function deriveDashboardModel(input: {
  activeCovenantStageId: CovenantStageId
  activeView: DashboardView
  agents: AgentNode[]
  commandLog: CommandLogItem[]
  covenantStages: CovenantStage[]
  mode: OsMode
  notice: string
  policies: PolicyGate[]
  runtimeSnapshot?: RuntimeSnapshot
  selectedAgentId: string
  selectedTaskId: string
  snapshots: SnapshotRecord[]
  tasks: TaskCard[]
  timeline: TimelineItem[]
}): DashboardModel {
  const selectedTask = input.tasks.find((task) => task.id === input.selectedTaskId) ?? input.tasks[0]!
  const selectedAgent = input.agents.find((agent) => agent.id === input.selectedAgentId) ?? input.agents[0]!
  const activeCovenantStage =
    input.covenantStages.find((stage) => stage.id === input.activeCovenantStageId) ?? input.covenantStages[0]!
  const metrics = buildMetrics(input.tasks)
  const loopPulse = input.runtimeSnapshot
    ? deriveLoopPulse(input.runtimeSnapshot)
    : buildSeededLoopPulse(input.tasks, activeCovenantStage)
  const missionMemory = input.runtimeSnapshot
    ? deriveMissionMemory(input.runtimeSnapshot)
    : buildSeededMissionMemory(input.tasks)
  const missionMap = input.runtimeSnapshot
    ? deriveMissionMap(input.runtimeSnapshot)
    : buildSeededMissionMap(input.tasks)
  const planContract = input.runtimeSnapshot
    ? derivePlanContract(input.runtimeSnapshot)
    : buildSeededPlanContract(input.tasks)
  const dispatchMatrix = input.runtimeSnapshot
    ? deriveDispatchMatrix(input.runtimeSnapshot)
    : buildSeededDispatchMatrix(input.tasks)
  const proofPlan = input.runtimeSnapshot
    ? deriveProofPlan(input.runtimeSnapshot)
    : buildSeededProofPlan(input.tasks)
  const reviewLens = input.runtimeSnapshot
    ? deriveReviewLens(input.runtimeSnapshot)
    : buildSeededReviewLens(input.tasks)
  const scopeSentinel = input.runtimeSnapshot
    ? deriveScopeSentinel(input.runtimeSnapshot)
    : buildSeededScopeSentinel(input.tasks)
  const redlineProof = input.runtimeSnapshot
    ? deriveRedlineProof(input.runtimeSnapshot)
    : buildSeededRedlineProof(input.tasks)
  const repairContract = input.runtimeSnapshot
    ? deriveRepairContract(input.runtimeSnapshot)
    : buildSeededRepairContract(input.tasks)
  const sealAudit = input.runtimeSnapshot
    ? deriveSealAudit(input.runtimeSnapshot)
    : buildSeededSealAudit(input.tasks)
  const runebook = input.runtimeSnapshot
    ? deriveRunebook(input.runtimeSnapshot)
    : buildSeededRunebook(input.tasks)
  const protocolDeck = input.runtimeSnapshot
    ? deriveRunicProtocolDeck(input.runtimeSnapshot)
    : buildSeededProtocolDeck(input.tasks)

  return {
    ...input,
    activeCovenantStage,
    activeCovenantStageId: activeCovenantStage.id,
    dispatchMatrix,
    loopPulse,
    missionMap,
    missionMemory,
    planContract,
    proofPlan,
    protocolDeck,
    redlineProof,
    repairContract,
    reviewLens,
    runebook,
    scopeSentinel,
    sealAudit,
    metrics,
    operationalScore: buildOperationalScore(input.tasks, metrics, input.policies),
    selectedAgent,
    selectedAgentId: selectedAgent.id,
    selectedTask,
    selectedTaskId: selectedTask.id,
  }
}

function selectRuntimeSelectedTaskId(snapshot: RuntimeSnapshot, tasks: TaskCard[]): string {
  const taskIds = new Set(tasks.map((task) => task.id))
  const pulseTaskId = deriveLoopPulse(snapshot).taskId
  if (pulseTaskId && taskIds.has(pulseTaskId)) return pulseTaskId

  const mapTaskId = deriveMissionMap(snapshot).nextTaskId
  if (mapTaskId && taskIds.has(mapTaskId)) return mapTaskId

  return tasks.find((task) => task.status === "running")?.id ?? tasks[0]!.id
}

function buildSeededMissionMap(tasks: TaskCard[]): MissionMap {
  if (tasks.length === 0) {
    return deriveMissionMap(emptyRuntimeSnapshot())
  }

  return deriveMissionMap(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededPlanContract(tasks: TaskCard[]): PlanContract {
  if (tasks.length === 0) {
    return derivePlanContract(emptyRuntimeSnapshot())
  }

  return derivePlanContract(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededDispatchMatrix(tasks: TaskCard[]): DispatchMatrix {
  if (tasks.length === 0) {
    return deriveDispatchMatrix(emptyRuntimeSnapshot())
  }

  return deriveDispatchMatrix(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededReviewLens(tasks: TaskCard[]): ReviewLens {
  if (tasks.length === 0) {
    return deriveReviewLens(emptyRuntimeSnapshot())
  }

  return deriveReviewLens(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededScopeSentinel(tasks: TaskCard[]): ScopeSentinel {
  if (tasks.length === 0) {
    return deriveScopeSentinel(emptyRuntimeSnapshot())
  }

  return deriveScopeSentinel(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededRedlineProof(tasks: TaskCard[]): RedlineProof {
  if (tasks.length === 0) {
    return deriveRedlineProof(emptyRuntimeSnapshot())
  }

  return deriveRedlineProof(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededRepairContract(tasks: TaskCard[]): RepairContract {
  if (tasks.length === 0) {
    return deriveRepairContract(emptyRuntimeSnapshot())
  }

  return deriveRepairContract(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededSealAudit(tasks: TaskCard[]): SealAudit {
  if (tasks.length === 0) {
    return deriveSealAudit(emptyRuntimeSnapshot())
  }

  return deriveSealAudit(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededLoopPulse(tasks: TaskCard[], activeStage: CovenantStage): LoopPulse {
  if (tasks.length === 0) {
    return deriveLoopPulse(emptyRuntimeSnapshot())
  }

  const pulse = deriveLoopPulse(buildSeededRuntimeSnapshot(tasks))

  return {
    ...pulse,
    stage: pulse.status === "idle" ? activeStage : pulse.stage,
  }
}

function buildSeededMissionMemory(tasks: TaskCard[]): MissionMemory {
  if (tasks.length === 0) {
    return deriveMissionMemory(emptyRuntimeSnapshot())
  }

  return deriveMissionMemory(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededProofPlan(tasks: TaskCard[]): ProofPlan {
  if (tasks.length === 0) {
    return deriveProofPlan(emptyRuntimeSnapshot())
  }

  return deriveProofPlan(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededRunebook(tasks: TaskCard[]): Runebook {
  if (tasks.length === 0) {
    return deriveRunebook(emptyRuntimeSnapshot())
  }

  return deriveRunebook(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededProtocolDeck(tasks: TaskCard[]): RunicProtocolDeck {
  if (tasks.length === 0) {
    return deriveRunicProtocolDeck(emptyRuntimeSnapshot())
  }

  return deriveRunicProtocolDeck(buildSeededRuntimeSnapshot(tasks))
}

function buildSeededRuntimeSnapshot(tasks: TaskCard[]): RuntimeSnapshot {
  const missionId = "mission_dashboard_seed"
  const now = "2026-05-27T00:00:00.000Z"
  const contracts = createRunesmithAgentContractMap()
  const evidenceEntries = tasks.flatMap((task) => {
    return task.evidence
      .filter(isEvidenceType)
      .map((type, index) => {
        const id = `evidence_${task.id}_${type}_${index}`
        return [id, {
          id,
          taskId: task.id,
          type,
          summary: `${task.title} has ${type} evidence`,
          payload: {},
          createdAt: now,
        }] as const
      })
  })

  return {
    graphs: {
      [missionId]: {
        mission: {
          id: missionId,
          goal: "Seeded dashboard mission control",
          status: "running",
          rootTaskId: tasks[0]!.id,
          createdAt: now,
          updatedAt: now,
        },
        tasks: Object.fromEntries(
          tasks.map((task) => {
            const requiredEvidence = task.evidence.filter(isEvidenceType)
            const assignedAgentId = findSeededAgentContractId(task.agent)
            return [task.id, {
              id: task.id,
              missionId,
              title: task.title,
              description: task.summary,
              status: mapMissionStatusToTaskStatus(task.status),
              requiredCapabilities: requiredCapabilitiesForSeededTask(task),
              requiredEvidence,
              ...(assignedAgentId ? { assignedAgentId } : {}),
              createdAt: now,
              updatedAt: now,
            }]
          }),
        ),
        events: [],
      },
    },
    ledgers: {
      [missionId]: {
        evidence: Object.fromEntries(evidenceEntries),
      },
    },
    leases: { leases: buildSeededTaskLeases(tasks, now) },
    contracts,
  }
}

function buildSeededTaskLeases(tasks: TaskCard[], now: string): RuntimeSnapshot["leases"]["leases"] {
  return Object.fromEntries(
    tasks
      .filter((task) => task.status === "running")
      .flatMap((task) => {
        const holder = findSeededAgentContractId(task.agent)
        if (!holder) return []

        return [[`lease_${task.id}`, {
          id: `lease_${task.id}`,
          targetId: task.id,
          holder,
          purpose: "task.claim",
          idempotencyKey: `seeded-${task.id}`,
          expiresAt: "2026-05-27T00:30:00.000Z",
          status: "active",
          createdAt: now,
        }]]
      }),
  )
}

function findSeededAgentContractId(agentName: string): string | undefined {
  return seededAgents.find((agent) => agent.name === agentName)?.id
}

function requiredCapabilitiesForSeededTask(task: TaskCard): string[] {
  if (task.agent === "Artificer") return ["typescript", "ui"]
  if (task.agent === "Oracle") return ["testing"]
  if (task.agent === "Scout") return ["diagnostics", "recovery"]
  if (task.agent === "Steward") return ["repository-maintenance", "release"]

  return ["typescript", "testing"]
}

function advanceCovenantStage(model: DashboardModel): DashboardModel {
  const nextStage = getNextCovenantStage(
    {
      id: "runic-covenant",
      name: "Runic Covenant",
      version: 1,
      installMode: "automatic",
      thesis: "",
      operatingRules: [],
      stages: model.covenantStages,
    },
    model.activeCovenantStageId,
  )

  if (!nextStage) {
    return deriveDashboardModel({
      ...model,
      activeView: "covenant",
      notice: "Runic Covenant could not find the next stage.",
    })
  }

  return deriveDashboardModel({
    ...model,
    activeCovenantStageId: nextStage.id,
    activeView: "covenant",
    commandLog: prependTimeline(model.commandLog, {
      label: "Covenant advanced",
      detail: `${model.activeCovenantStage.name} advanced to ${nextStage.name}.`,
      tone: "running",
    }),
    timeline: prependTimeline(model.timeline, {
      label: "Covenant advanced",
      detail: `${nextStage.name} armed with ${nextStage.gates.length} gates and ${nextStage.evidence.length} evidence signals.`,
      tone: "running",
    }),
    notice: `Runic Covenant advanced to ${nextStage.name}.`,
  })
}

function buildTaskCardsFromGraph(snapshot: RuntimeSnapshot, graph: MissionGraph): TaskCard[] {
  return Object.values(graph.tasks)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
    .map((task) => {
      const contract = task.assignedAgentId ? snapshot.contracts[task.assignedAgentId] : undefined
      const evidence = evidenceForTask(snapshot, graph.mission.id, task.id)

      return {
        id: task.id,
        title: task.title,
        agent: contract?.displayName ?? task.assignedAgentId ?? "Unassigned",
        status: mapTaskStatus(task.status, graph, task.id),
        lane: mapTaskLane(task.status, evidence),
        summary: task.description || graph.mission.goal,
        tools: contract?.allowedTools ?? ["read"],
        evidence: uniqueEvidenceTypes(evidence),
      } satisfies TaskCard
    })
}

function buildAgentsFromSnapshot(snapshot: RuntimeSnapshot, tasks: TaskCard[]): AgentNode[] {
  const contracts = Object.values(snapshot.contracts)
    .sort((left, right) => left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id))

  if (contracts.length === 0) {
    return cloneAgents(seededAgents)
  }

  return contracts.map((contract, index) => buildAgentFromContract(snapshot, tasks, contract, index))
}

function buildAgentFromContract(
  snapshot: RuntimeSnapshot,
  tasks: TaskCard[],
  contract: AgentContract,
  index: number,
): AgentNode {
  const assignedTasks = tasks.filter((task) => task.agent === contract.displayName)
  const activeTask = assignedTasks.find((task) => task.status === "running" || task.status === "stale" || task.status === "blocked")
  const activeLease = activeTask
    ? Object.values(snapshot.leases.leases).find((lease) => lease.targetId === activeTask.id && lease.status === "active")
    : undefined

  return {
    id: contract.id,
    name: contract.displayName,
    role: contract.description,
    status: activeTask ? (activeTask.status === "stale" ? "stalled" : "active") : "idle",
    activeLease: activeLease?.targetId ?? activeTask?.id ?? "none",
    capacity: clamp(72 - index * 7 + assignedTasks.length * 6, 42, 96),
    queue: assignedTasks.filter((task) => task.status !== "verified").length,
    model: contract.modelPolicy.fallbacks.length > 0
      ? `${contract.modelPolicy.primary} -> ${contract.modelPolicy.fallbacks[0]}`
      : contract.modelPolicy.primary,
    focus: activeTask?.title ?? "Standing by for the next mission lease",
    successRate: clamp(88 + assignedTasks.filter((task) => task.status === "verified").length * 3, 70, 99),
    tools: [...contract.allowedTools],
  }
}

function buildTimelineFromSnapshot(graphs: MissionGraph[]): TimelineItem[] {
  const events = graphs
    .flatMap((graph) => graph.events.map((event) => ({ event, graph })))
    .sort((left, right) => right.event.at.localeCompare(left.event.at) || left.event.id.localeCompare(right.event.id))
    .slice(0, 8)
    .map(({ event, graph }) => {
      const task = graph.tasks[event.targetId]
      return {
        id: event.id,
        label: event.message,
        detail: `${graph.mission.goal}: ${task?.title ?? event.targetId}`,
        tone: task ? mapTaskStatus(task.status) : mapMissionTone(graph.mission.status),
      } satisfies TimelineItem
    })

  if (events.length > 0) return events

  return graphs.slice(0, 8).map((graph) => ({
    id: `event_${graph.mission.id}`,
    label: "Mission restored",
    detail: `${graph.mission.goal}: ${Object.keys(graph.tasks).length} task${Object.keys(graph.tasks).length === 1 ? "" : "s"} loaded.`,
    tone: mapMissionTone(graph.mission.status),
  }))
}

function buildPoliciesFromSnapshot(snapshot: RuntimeSnapshot, evidenceCount: number): PolicyGate[] {
  const activeLeases = Object.values(snapshot.leases.leases).filter((lease) => lease.status === "active").length
  const totalTasks = Object.values(snapshot.graphs).reduce((sum, graph) => sum + Object.keys(graph.tasks).length, 0)

  return seededPolicies.map((policy) => {
    if (policy.id === "policy_evidence_gate") {
      return {
        ...policy,
        signal: `${evidenceCount} evidence record${evidenceCount === 1 ? "" : "s"} in live capsule`,
        coverage: totalTasks > 0 ? clamp(Math.round((evidenceCount / totalTasks) * 50), 45, 100) : policy.coverage,
      }
    }

    if (policy.id === "policy_lease_mutex") {
      return {
        ...policy,
        signal: `${activeLeases} active lease${activeLeases === 1 ? "" : "s"} restored from capsule`,
      }
    }

    return { ...policy }
  })
}

function evidenceForTask(snapshot: RuntimeSnapshot, missionId: string, taskId: string): Evidence[] {
  return Object.values(snapshot.ledgers[missionId]?.evidence ?? {})
    .filter((evidence) => evidence.taskId === taskId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
}

function emptyRuntimeSnapshot(): RuntimeSnapshot {
  return {
    graphs: {},
    ledgers: {},
    leases: { leases: {} },
    contracts: {},
  }
}

function uniqueEvidenceTypes(evidence: Evidence[]): string[] {
  return [...new Set(evidence.map((item) => item.type))]
}

function isEvidenceType(value: string): value is EvidenceType {
  return [
    "file-change",
    "command-output",
    "test-result",
    "diagnostic",
    "decision",
    "risk",
  ].includes(value)
}

function mapTaskStatus(status: TaskStatus, graph?: MissionGraph, taskId?: string): MissionStatus {
  if (status === "queued" && graph && taskId && taskBlockedByDependencies(graph, taskId)) return "blocked"
  if (status === "complete" || status === "verifying") return "verified"
  if (status === "stale") return "stale"
  if (status === "blocked" || status === "failed" || status === "cancelled") return "blocked"

  return "running"
}

function taskBlockedByDependencies(graph: MissionGraph, taskId: string): boolean {
  const task = graph.tasks[taskId]
  if (!task) return false

  return (task.dependsOn ?? []).some((dependencyId) => graph.tasks[dependencyId]?.status !== "complete")
}

function mapMissionStatusToTaskStatus(status: MissionStatus): TaskStatus {
  if (status === "verified") return "complete"
  if (status === "stale") return "stale"
  if (status === "blocked") return "blocked"

  return "running"
}

function mapMissionTone(status: MissionGraph["mission"]["status"]): MissionStatus {
  if (status === "complete" || status === "verifying") return "verified"
  if (status === "blocked" || status === "failed" || status === "cancelled") return "blocked"

  return "running"
}

function mapTaskLane(status: TaskStatus, evidence: Evidence[] = []): TaskLane {
  if (hasOpenDiagnostic(evidence)) return "Repair"
  if (status === "queued") return "Plan"
  if (status === "complete" || status === "verifying") return "Verify"
  if (status === "stale" || status === "blocked" || status === "failed" || status === "cancelled") return "Recover"

  return "Build"
}

function hasOpenDiagnostic(evidence: Evidence[]): boolean {
  const hasDiagnostic = evidence.some(isDiagnosticEvidence)
  if (!hasDiagnostic) return false

  return !evidence.some(isPassingTestResultEvidence)
}

function isDiagnosticEvidence(evidence: Evidence): boolean {
  if (evidence.type === "diagnostic") return true
  if (evidence.type !== "test-result") return false

  return !isPassingTestResultEvidence(evidence)
}

function isPassingTestResultEvidence(evidence: Evidence): boolean {
  if (evidence.type !== "test-result") return false

  const exitCode = evidence.payload.exitCode
  if (typeof exitCode === "number") return exitCode === 0

  const status = evidence.payload.status ?? evidence.payload.outcome ?? evidence.payload.verdict
  if (typeof status !== "string") return false

  return ["ok", "pass", "passed", "success", "successful"].includes(status.toLowerCase())
}

function buildMetrics(tasks: TaskCard[]): Record<MissionStatus, number> {
  return tasks.reduce<Record<MissionStatus, number>>(
    (accumulator, task) => {
      accumulator[task.status] += 1
      return accumulator
    },
    {
      running: 0,
      verified: 0,
      stale: 0,
      blocked: 0,
    },
  )
}

function buildOperationalScore(
  tasks: TaskCard[],
  metrics: Record<MissionStatus, number>,
  policies: PolicyGate[],
): number {
  const totalTasks = Math.max(tasks.length, 1)
  const verifiedScore = (metrics.verified / totalTasks) * 34
  const runningScore = (metrics.running / totalTasks) * 18
  const riskPenalty = (metrics.stale / totalTasks) * 24 + (metrics.blocked / totalTasks) * 14
  const evidenceCoverage = (tasks.filter((task) => task.evidence.length > 0).length / totalTasks) * 18
  const policyCoverage =
    policies.reduce((sum, policy) => sum + (policy.enabled ? policy.coverage : policy.coverage * 0.45), 0) /
    Math.max(policies.length, 1) /
    4

  return Math.round(clamp(42 + verifiedScore + runningScore + evidenceCoverage + policyCoverage - riskPenalty, 0, 100))
}

function verifySelectedTask(
  model: DashboardModel,
  options: {
    label: string
    commandLabel?: string
    detailPrefix: string
    noticePrefix: string
  },
): DashboardModel {
  return mutateSelectedTask(model, {
    timelineLabel: options.label,
    timelineTone: "verified",
    commandLabel: options.commandLabel ?? "Verifier completed",
    notice: (task) => `${options.noticePrefix} ${task.title}.`,
    mutate: (task) => ({
      ...task,
      status: "verified",
      lane: "Verify",
      summary: "Verifier passed and attached required evidence to the mission ledger.",
      evidence: addEvidence(task.evidence, "test-result"),
    }),
    detail: (task) => `${options.detailPrefix} ${task.id}`,
  })
}

function mutateSelectedTask(
  model: DashboardModel,
  options: {
    timelineLabel: string
    timelineTone: MissionStatus
    commandLabel: string
    notice: (task: TaskCard) => string
    mutate: (task: TaskCard) => TaskCard
    detail?: (task: TaskCard) => string
  },
): DashboardModel {
  const currentTask = model.selectedTask
  const nextTask = options.mutate(currentTask)
  const tasks = model.tasks.map((task) => (task.id === currentTask.id ? nextTask : task))
  const detail = options.detail?.(nextTask) ?? `${nextTask.title} moved to ${nextTask.lane}`

  return deriveDashboardModel({
    ...model,
    commandLog: prependTimeline(model.commandLog, {
      label: options.commandLabel,
      detail,
      tone: options.timelineTone,
    }),
    tasks,
    timeline: prependTimeline(model.timeline, {
      label: options.timelineLabel,
      detail,
      tone: options.timelineTone,
    }),
    notice: options.notice(nextTask),
  })
}

function recoverStaleTasks(
  model: DashboardModel,
  options: {
    timelineLabel: string
    commandLabel: string
    noticePrefix: string
  },
): DashboardModel {
  const staleTasks = model.tasks.filter((task) => task.status === "stale")

  if (staleTasks.length === 0) {
    return deriveDashboardModel({
      ...model,
      commandLog: prependTimeline(model.commandLog, {
        label: "Recovery skipped",
        detail: "No stale leases were found during the recovery sweep.",
        tone: "verified",
      }),
      notice: "No stale tasks need recovery.",
    })
  }

  const staleIds = new Set(staleTasks.map((task) => task.id))
  const tasks = model.tasks.map((task) => {
    if (!staleIds.has(task.id)) {
      return task
    }

    return {
      ...task,
      status: "running",
      lane: "Build",
      summary: "Recovered by scheduler reassignment; heartbeat lease is active again.",
      evidence: addEvidence(task.evidence, "diagnostic"),
    } satisfies TaskCard
  })
  const agents = model.agents.map((agent): AgentNode =>
    staleIds.has(agent.activeLease)
      ? {
          ...agent,
          status: "active",
          capacity: Math.min(100, agent.capacity + 24),
          focus: "Recovered heartbeat lease",
        }
      : agent,
  )

  return deriveDashboardModel({
    ...model,
    agents,
    commandLog: prependTimeline(model.commandLog, {
      label: options.commandLabel,
      detail: `${staleTasks.length} stale lease${staleTasks.length === 1 ? "" : "s"} reassigned by policy.`,
      tone: "running",
    }),
    tasks,
    timeline: prependTimeline(model.timeline, {
      label: options.timelineLabel,
      detail: `${staleTasks.length} stale task${staleTasks.length === 1 ? "" : "s"} reassigned with fresh leases`,
      tone: "running",
    }),
    notice: `${options.noticePrefix} ${staleTasks.length} stale task${staleTasks.length === 1 ? "" : "s"}.`,
  })
}

function runAutopilotCycle(model: DashboardModel): DashboardModel {
  const staleTask = model.tasks.find((task) => task.status === "stale")
  if (staleTask) {
    return recoverStaleTasks(
      {
        ...model,
        mode: "autopilot",
      },
      {
        timelineLabel: "Autopilot recovered",
        commandLabel: "Recovered stale lease",
        noticePrefix: "Autopilot recovered",
      },
    )
  }

  const runningTask = model.tasks.find((task) => task.status === "running")
  if (runningTask) {
    return verifySelectedTask(
      deriveDashboardModel({
        ...model,
        mode: "autopilot",
        selectedTaskId: runningTask.id,
      }),
      {
        label: "Autopilot verified",
        detailPrefix: "Autopilot completed verification for",
        noticePrefix: "Autopilot verified",
      },
    )
  }

  const blockedTask = model.tasks.find((task) => task.status === "blocked")
  if (blockedTask) {
    const task = {
      ...blockedTask,
      status: "running",
      lane: "Build",
      summary: "Autopilot resumed this task after policy checks cleared.",
    } satisfies TaskCard

    return deriveDashboardModel({
      ...model,
      commandLog: prependTimeline(model.commandLog, {
        label: "Blocked task resumed",
        detail: `${task.title} resumed by guarded autopilot.`,
        tone: "running",
      }),
      mode: "autopilot",
      selectedTaskId: task.id,
      tasks: model.tasks.map((item) => (item.id === task.id ? task : item)),
      timeline: prependTimeline(model.timeline, {
        label: "Autopilot resumed",
        detail: `${task.title} moved back to Build.`,
        tone: "running",
      }),
      notice: `Autopilot resumed ${task.title}.`,
    })
  }

  return deriveDashboardModel({
    ...model,
    mode: "autopilot",
    notice: "Autopilot found no pending work.",
  })
}

function runNextActionInModel(
  model: DashboardModel,
  action: Extract<DashboardAction, { type: "run-next-action" }>,
): DashboardModel {
  if (model.loopPulse.nextAction.id === "resolve-risk") {
    return resolveRiskInModel(model, {
      type: "resolve-risk",
      verdict: action.verdict,
      summary: action.summary ?? model.loopPulse.risks[0],
    })
  }

  if (model.loopPulse.nextAction.id === "review-faultline") {
    return resolveFaultlineInModel(model, {
      type: "resolve-faultline",
      summary: action.faultlineSummary ?? action.summary,
    })
  }

  if (model.loopPulse.nextAction.id === "capture-proof" || model.loopPulse.nextAction.id === "repair-diagnostic") {
    return verifySelectedTask(model, {
      label: "Runebook next passed",
      commandLabel: "Runebook next passed",
      detailPrefix: "Runesmith executed the active Runebook card for",
      noticePrefix: "Runebook next passed for",
    })
  }

  return runAutopilotCycle(model)
}

function runOsLoopInModel(
  model: DashboardModel,
  action: Extract<DashboardAction, { type: "run-os-loop" }>,
): DashboardModel {
  const next = runNextActionInModel(model, {
    type: "run-next-action",
    verdict: action.verdict,
    summary: action.summary,
    faultlineSummary: action.faultlineSummary,
  })

  return {
    ...next,
    notice: next.notice.replace("Runebook next", "Runesmith OS"),
  }
}

function resolveFaultlineInModel(
  model: DashboardModel,
  action: Extract<DashboardAction, { type: "resolve-faultline" }>,
): DashboardModel {
  const faultlineTask = model.tasks.find((task) => task.evidence.includes("diagnostic") && task.status !== "verified")
  const targetTask = faultlineTask ?? model.selectedTask
  const summary = action.summary?.trim() || "Operator selected an architecture path for the active Faultline."

  return mutateSelectedTask(
    deriveDashboardModel({
      ...model,
      mode: "guarded",
      selectedTaskId: targetTask.id,
    }),
    {
      timelineLabel: "Faultline resolved",
      timelineTone: "running",
      commandLabel: "Faultline decision recorded",
      notice: (task) => `Resolved Faultline for ${task.title}.`,
      mutate: (task) => ({
        ...task,
        status: "running",
        lane: "Repair",
        summary: `Faultline path: ${summary}`,
        evidence: addEvidence(task.evidence, "decision"),
      }),
      detail: (task) => `${task.id} received a Faultline architecture decision`,
    },
  )
}

function resolveRiskInModel(
  model: DashboardModel,
  action: Extract<DashboardAction, { type: "resolve-risk" }>,
): DashboardModel {
  const riskTask = model.tasks.find((task) => task.evidence.includes("risk") && task.status !== "verified")
  const targetTask = riskTask ?? model.selectedTask
  const verdict = action.verdict ?? "accepted"
  const summary = action.summary?.trim() || "Operator resolved active risk."

  return mutateSelectedTask(
    deriveDashboardModel({
      ...model,
      mode: "guarded",
      selectedTaskId: targetTask.id,
    }),
    {
      timelineLabel: "Risk resolved",
      timelineTone: "verified",
      commandLabel: "Risk decision recorded",
      notice: (task) => `Resolved risk for ${task.title}.`,
      mutate: (task) => ({
        ...task,
        status: "verified",
        lane: "Verify",
        summary: `Risk ${verdict}: ${summary}`,
        evidence: addEvidence(task.evidence, "decision"),
      }),
      detail: (task) => `${task.id} received a ${verdict} risk decision`,
    },
  )
}

function refinePlanInModel(
  model: DashboardModel,
  action: Extract<DashboardAction, { type: "refine-plan" }>,
): DashboardModel {
  if (model.runtimeSnapshot) {
    return refineRuntimePlanInModel(model, action)
  }

  const goal = normalizeDirectiveTitle(model.selectedTask.title)
  if (!goal) {
    return deriveDashboardModel({
      ...model,
      notice: "Select a mission directive before refining the plan.",
    })
  }

  const baseId = normalizeTaskId(model.selectedTask.id)
  const slices: TaskCard[] = [
    {
      id: `${baseId}_plan`,
      title: `Plan: ${goal}`,
      agent: "Atlas",
      status: "verified",
      lane: "Plan",
      summary: `Pathfinder converted ${goal} into concrete proof-backed work slices.`,
      tools: ["read", "edit", "test"],
      evidence: ["decision"],
    },
    {
      id: `${baseId}_runtime_forge`,
      title: "Forge: orchestration runtime",
      agent: "Atlas",
      status: "running",
      lane: "Build",
      summary: `Runtime adapters, orchestration gates, and proof routing for ${goal}.`,
      tools: ["read", "edit", "test"],
      evidence: [],
    },
    {
      id: `${baseId}_interface_forge`,
      title: "Forge: operator control surface",
      agent: "Artificer",
      status: "running",
      lane: "Build",
      summary: `Dashboard, install controls, and operator feedback loops for ${goal}.`,
      tools: ["read", "edit", "test"],
      evidence: [],
    },
    {
      id: `${baseId}_proof_review`,
      title: "Review: proof and risk gate",
      agent: "Oracle",
      status: "blocked",
      lane: "Verify",
      summary: "Waiting for both implementation slices before proof review can run.",
      tools: ["read", "test"],
      evidence: [],
    },
    {
      id: `${baseId}_seal_handoff`,
      title: "Seal: install and handoff",
      agent: "Steward",
      status: "blocked",
      lane: "Plan",
      summary: "Waiting for proof review before packaging and direct-install handoff.",
      tools: ["read", "edit", "git"],
      evidence: [],
    },
  ]
  const replacedTaskId = model.selectedTask.id
  const tasks = [
    ...slices,
    ...model.tasks.filter((task) => task.id !== replacedTaskId),
  ]

  return deriveDashboardModel({
    ...model,
    agents: model.agents.map((agent) => {
      if (agent.name === "Atlas") return { ...agent, activeLease: slices[1]!.id, status: "active", queue: agent.queue + 1 }
      if (agent.name === "Artificer") return { ...agent, activeLease: slices[2]!.id, status: "active", queue: agent.queue + 1 }
      if (agent.name === "Oracle") return { ...agent, activeLease: slices[3]!.id, status: "reviewing" }
      if (agent.name === "Steward") return { ...agent, activeLease: slices[4]!.id, status: "idle" }

      return agent
    }),
    commandLog: prependTimeline(model.commandLog, {
      label: "Plan refined",
      detail: `${goal} decomposed into ${slices.length} engine-owned slices.`,
      tone: "running",
    }),
    selectedTaskId: slices[1]!.id,
    tasks,
    timeline: prependTimeline(model.timeline, {
      label: "Plan refined",
      detail: `${goal} now has parallel runtime and interface forge slices.`,
      tone: "running",
    }),
    notice: `Refined ${goal} into runtime, interface, review, and seal slices.`,
  })
}

function refineRuntimePlanInModel(
  model: DashboardModel,
  action: Extract<DashboardAction, { type: "refine-plan" }>,
): DashboardModel {
  const graph = selectDashboardRuntimeGraph(model.runtimeSnapshot!, action.missionId)
  if (!graph) {
    return deriveDashboardModel({
      ...model,
      notice: "No active runtime mission is available for plan refinement.",
    })
  }

  const runtime = createRuntime({ snapshot: model.runtimeSnapshot })
  for (const contract of createRunesmithAgentContracts()) {
    runtime.registerContract(contract)
  }

  const refined = refineRunicMissionPlan(runtime, {
    missionId: graph.mission.id,
    taskPlan: createRunicPlanRefinementTaskPlan(graph.mission.goal),
    contract: defaultRunesmithAgentContract,
    holder: "runesmith-dashboard-local",
    idempotencyScope: "dashboard-local-plan-refine",
    ttlMs: 30_000,
    evidenceId: `evidence_dashboard_refine_${graph.mission.id}`,
  })
  if (!refined.ok) {
    return deriveDashboardModel({
      ...model,
      notice: `Plan refinement blocked: ${refined.error.message}`,
    })
  }

  const next = buildDashboardModelFromRuntimeSnapshot(runtime.snapshot(), {
    updatedAt: "local refinement",
  })
  const selectedTask = next.tasks.find((task) => task.title === "Forge: orchestration runtime") ?? next.selectedTask

  return {
    ...next,
    commandLog: prependTimeline(model.commandLog, {
      label: "Plan refined",
      detail: `${graph.mission.goal} decomposed into ${refined.value.taskCount} proof-backed slices.`,
      tone: "running",
    }),
    selectedTask,
    selectedTaskId: selectedTask.id,
    timeline: prependTimeline(next.timeline, {
      label: "Plan refined",
      detail: `${graph.mission.id} now has ${refined.value.planContract.implementationTaskCount} implementation slices.`,
      tone: "running",
    }),
    notice: `Refined ${graph.mission.goal} into runtime, interface, review, and seal slices.`,
  }
}

function forgeDirective(model: DashboardModel, prompt: string): DashboardModel {
  const title = normalizeDirectiveTitle(prompt)

  if (!title) {
    return deriveDashboardModel({
      ...model,
      notice: "Enter a mission directive before forging a task.",
    })
  }

  const task: TaskCard = {
    id: `task_directive_${model.tasks.length + 1}`,
    title,
    agent: "Atlas",
    status: "running",
    lane: "Plan",
    summary: `Command center directive queued for orchestration: ${title}.`,
    tools: ["read", "edit", "test"],
    evidence: ["decision"],
  }

  return deriveDashboardModel({
    ...model,
    agents: model.agents.map((agent) =>
      agent.name === "Atlas"
        ? {
            ...agent,
            activeLease: task.id,
            queue: agent.queue + 1,
            status: "active",
          }
        : agent,
    ),
    commandLog: prependTimeline(model.commandLog, {
      label: "Directive forged",
      detail: `${title} became ${task.id}.`,
      tone: "running",
    }),
    selectedTaskId: task.id,
    tasks: [task, ...model.tasks],
    timeline: prependTimeline(model.timeline, {
      label: "Directive forged",
      detail: `${title} entered Plan with Atlas assigned.`,
      tone: "running",
    }),
    notice: `Forged directive: ${title}.`,
  })
}

function togglePolicy(model: DashboardModel, policyId: string): DashboardModel {
  const policy = model.policies.find((item) => item.id === policyId)

  if (!policy) {
    return deriveDashboardModel({
      ...model,
      notice: "That policy gate is no longer available.",
    })
  }

  const enabled = !policy.enabled
  const label = enabled ? "Policy enabled" : "Policy disabled"
  const policies = model.policies.map((item) => (item.id === policy.id ? { ...item, enabled } : item))

  return deriveDashboardModel({
    ...model,
    commandLog: prependTimeline(model.commandLog, {
      label,
      detail: `${policy.name} is now ${enabled ? "enforcing" : "observing only"}.`,
      tone: enabled ? "verified" : "blocked",
    }),
    policies,
    timeline: prependTimeline(model.timeline, {
      label,
      detail: `${policy.name} changed to ${enabled ? "enabled" : "disabled"}.`,
      tone: enabled ? "verified" : "blocked",
    }),
    notice: `${enabled ? "Enabled" : "Disabled"} ${policy.name}.`,
  })
}

function createSnapshot(model: DashboardModel): DashboardModel {
  const evidence = model.tasks.reduce((sum, task) => sum + task.evidence.length, 0)
  const snapshot: SnapshotRecord = {
    id: `snapshot_manual_${model.snapshots.length + 1}`,
    label: "Manual checkpoint",
    createdAt: "now",
    hash: `rs_${model.tasks.length}${evidence}${model.timeline.length}`,
    tasks: model.tasks.length,
    evidence,
    score: model.operationalScore,
    tone: model.metrics.stale > 0 || model.metrics.blocked > 0 ? "running" : "verified",
  }

  return deriveDashboardModel({
    ...model,
    commandLog: prependTimeline(model.commandLog, {
      label: "Snapshot sealed",
      detail: `${snapshot.hash} sealed with ${snapshot.evidence} evidence records.`,
      tone: snapshot.tone,
    }),
    snapshots: [snapshot, ...model.snapshots],
    timeline: prependTimeline(model.timeline, {
      label: "Snapshot sealed",
      detail: `${snapshot.label} captured ${snapshot.tasks} tasks at score ${snapshot.score}.`,
      tone: snapshot.tone,
    }),
    notice: `Created snapshot ${snapshot.hash}.`,
  })
}

function boostAgent(model: DashboardModel, agentId: string): DashboardModel {
  const agent = model.agents.find((item) => item.id === agentId)

  if (!agent) {
    return deriveDashboardModel({
      ...model,
      notice: "That agent is no longer in the mesh.",
    })
  }

  const agents = model.agents.map((item): AgentNode =>
    item.id === agent.id
      ? {
          ...item,
          capacity: Math.min(100, item.capacity + 12),
          status: "active",
          focus: "Priority lease boosted by operator",
        }
      : item,
  )

  return deriveDashboardModel({
    ...model,
    agents,
    commandLog: prependTimeline(model.commandLog, {
      label: "Agent boosted",
      detail: `${agent.name} received priority lease capacity.`,
      tone: "running",
    }),
    selectedAgentId: agent.id,
    notice: `Boosted ${agent.name}.`,
  })
}

function prependTimeline(
  timeline: TimelineItem[],
  event: Omit<TimelineItem, "id">,
): TimelineItem[] {
  const id = `event_${event.label.toLowerCase().replaceAll(" ", "_")}_${timeline.length + 1}`

  return [{ id, ...event }, ...timeline].slice(0, 8)
}

function addEvidence(evidence: string[], item: string): string[] {
  return evidence.includes(item) ? evidence : [...evidence, item]
}

function normalizeDirectiveTitle(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ").slice(0, 72)
}

function normalizeTaskId(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "")

  return normalized || "task"
}

function selectDashboardRuntimeGraph(
  snapshot: RuntimeSnapshot,
  missionId: string | undefined,
): MissionGraph | undefined {
  if (missionId) return snapshot.graphs[missionId]

  return Object.values(snapshot.graphs)
    .filter((graph) => !["complete", "failed", "cancelled"].includes(graph.mission.status))
    .sort((left, right) => {
      return right.mission.updatedAt.localeCompare(left.mission.updatedAt) || left.mission.id.localeCompare(right.mission.id)
    })[0]
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function cloneTasks(tasks: TaskCard[]): TaskCard[] {
  return tasks.map((task) => ({
    ...task,
    tools: [...task.tools],
    evidence: [...task.evidence],
  }))
}

function cloneAgents(agents: AgentNode[]): AgentNode[] {
  return agents.map((agent) => ({
    ...agent,
    tools: [...agent.tools],
  }))
}

function clonePolicies(policies: PolicyGate[]): PolicyGate[] {
  return policies.map((policy) => ({ ...policy }))
}

function cloneSnapshots(snapshots: SnapshotRecord[]): SnapshotRecord[] {
  return snapshots.map((snapshot) => ({ ...snapshot }))
}

function cloneTimeline(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.map((item) => ({ ...item }))
}

function cloneCovenantStages(stages: CovenantStage[]): CovenantStage[] {
  return stages.map((stage) => ({
    ...stage,
    gates: [...stage.gates],
    evidence: [...stage.evidence],
  }))
}
