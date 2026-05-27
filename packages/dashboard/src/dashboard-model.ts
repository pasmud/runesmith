import {
  createRunicCovenant,
  getNextCovenantStage,
  type CovenantStage,
  type CovenantStageId,
} from "@runesmith/core"

export type MissionStatus = "running" | "verified" | "stale" | "blocked"

export type DashboardView = "missions" | "agents" | "covenant" | "policies" | "snapshots"

export type AgentStatus = "active" | "idle" | "reviewing" | "stalled"

export type OsMode = "guarded" | "autopilot"

export type TaskLane = "Plan" | "Build" | "Verify" | "Recover"

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
  | { type: "forge-directive"; prompt: string }
  | { type: "advance-covenant-stage" }
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

    case "run-autopilot-cycle":
      return runAutopilotCycle(model)

    case "forge-directive":
      return forgeDirective(model, action.prompt)

    case "advance-covenant-stage":
      return advanceCovenantStage(model)

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

  return {
    ...input,
    activeCovenantStage,
    activeCovenantStageId: activeCovenantStage.id,
    metrics,
    operationalScore: buildOperationalScore(input.tasks, metrics, input.policies),
    selectedAgent,
    selectedAgentId: selectedAgent.id,
    selectedTask,
    selectedTaskId: selectedTask.id,
  }
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
    detailPrefix: string
    noticePrefix: string
  },
): DashboardModel {
  return mutateSelectedTask(model, {
    timelineLabel: options.label,
    timelineTone: "verified",
    commandLabel: "Verifier completed",
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
