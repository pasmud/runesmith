export type MissionStatus = "running" | "verified" | "stale" | "blocked"

export type DashboardView = "missions" | "agents" | "policies" | "snapshots"

export type TaskCard = {
  id: string
  title: string
  agent: string
  status: MissionStatus
  lane: "Plan" | "Build" | "Verify" | "Recover"
  summary: string
  tools: string[]
  evidence: string[]
}

export type TimelineItem = {
  id: string
  label: string
  detail: string
  tone: MissionStatus
}

export type DashboardModel = {
  activeView: DashboardView
  metrics: Record<MissionStatus, number>
  tasks: TaskCard[]
  selectedTaskId: string
  selectedTask: TaskCard
  timeline: TimelineItem[]
  notice: string
}

export type DashboardAction =
  | { type: "select-task"; taskId: string }
  | { type: "select-view"; view: DashboardView }
  | { type: "verify-selected" }
  | { type: "hold-selected" }
  | { type: "recover-stale" }
  | { type: "run-verifier" }

const viewNotice = {
  missions: "Showing mission lanes and task evidence.",
  agents: "Showing agent capacity and leases.",
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

export function buildDashboardModel(): DashboardModel {
  const tasks = cloneTasks(seededTasks)
  const timeline = cloneTimeline(seededTimeline)

  return deriveDashboardModel({
    activeView: "missions",
    tasks,
    selectedTaskId: tasks[0]!.id,
    timeline,
    notice: "Mission control is live.",
  })
}

export function reduceDashboardModel(model: DashboardModel, action: DashboardAction): DashboardModel {
  switch (action.type) {
    case "select-task": {
      const selectedTask = model.tasks.find((task) => task.id === action.taskId)

      if (!selectedTask) {
        return {
          ...model,
          notice: "That task is no longer on the mission board.",
        }
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
        notice: (task) => `Held ${task.title} for operator review.`,
        mutate: (task) => ({
          ...task,
          status: "blocked",
          lane: "Plan",
          summary: "Paused for operator review; active leases are suspended until the task is resumed.",
          evidence: addEvidence(task.evidence, "risk"),
        }),
      })

    case "recover-stale": {
      const staleTasks = model.tasks.filter((task) => task.status === "stale")

      if (staleTasks.length === 0) {
        return deriveDashboardModel({
          ...model,
          notice: "No stale tasks need recovery.",
        })
      }

      const tasks = model.tasks.map((task) => {
        if (task.status !== "stale") {
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

      return deriveDashboardModel({
        ...model,
        tasks,
        timeline: prependTimeline(model.timeline, {
          label: "Recovery dispatched",
          detail: `${staleTasks.length} stale task${staleTasks.length === 1 ? "" : "s"} reassigned with fresh leases`,
          tone: "running",
        }),
        notice: `Recovered ${staleTasks.length} stale task${staleTasks.length === 1 ? "" : "s"}.`,
      })
    }

    case "run-verifier":
      return verifySelectedTask(model, {
        label: "Verifier passed",
        detailPrefix: "OpenCode verifier completed evidence checks for",
        noticePrefix: "Verifier passed for",
      })
  }
}

function deriveDashboardModel(input: {
  activeView: DashboardView
  tasks: TaskCard[]
  selectedTaskId: string
  timeline: TimelineItem[]
  notice: string
}): DashboardModel {
  const selectedTask = input.tasks.find((task) => task.id === input.selectedTaskId) ?? input.tasks[0]!

  return {
    ...input,
    metrics: buildMetrics(input.tasks),
    selectedTaskId: selectedTask.id,
    selectedTask,
  }
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
    notice: (task: TaskCard) => string
    mutate: (task: TaskCard) => TaskCard
    detail?: (task: TaskCard) => string
  },
): DashboardModel {
  const currentTask = model.selectedTask
  const nextTask = options.mutate(currentTask)
  const tasks = model.tasks.map((task) => (task.id === currentTask.id ? nextTask : task))

  return deriveDashboardModel({
    ...model,
    tasks,
    timeline: prependTimeline(model.timeline, {
      label: options.timelineLabel,
      detail: options.detail?.(nextTask) ?? `${nextTask.title} moved to ${nextTask.lane}`,
      tone: options.timelineTone,
    }),
    notice: options.notice(nextTask),
  })
}

function prependTimeline(
  timeline: TimelineItem[],
  event: Omit<TimelineItem, "id">,
): TimelineItem[] {
  const id = `event_${event.label.toLowerCase().replaceAll(" ", "_")}_${timeline.length + 1}`

  return [{ id, ...event }, ...timeline].slice(0, 6)
}

function addEvidence(evidence: string[], item: string): string[] {
  return evidence.includes(item) ? evidence : [...evidence, item]
}

function cloneTasks(tasks: TaskCard[]): TaskCard[] {
  return tasks.map((task) => ({
    ...task,
    tools: [...task.tools],
    evidence: [...task.evidence],
  }))
}

function cloneTimeline(timeline: TimelineItem[]): TimelineItem[] {
  return timeline.map((item) => ({ ...item }))
}
