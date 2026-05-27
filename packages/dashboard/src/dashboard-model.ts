export type MissionStatus = "running" | "verified" | "stale" | "blocked"

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
  metrics: Record<MissionStatus, number>
  tasks: TaskCard[]
  selectedTask: TaskCard
  timeline: TimelineItem[]
}

const seededTasks: TaskCard[] = [
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
]

const seededTimeline: TimelineItem[] = [
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
]

export function buildDashboardModel(): DashboardModel {
  const metrics = seededTasks.reduce<Record<MissionStatus, number>>(
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

  return {
    metrics,
    tasks: seededTasks,
    selectedTask: seededTasks[0]!,
    timeline: seededTimeline,
  }
}
