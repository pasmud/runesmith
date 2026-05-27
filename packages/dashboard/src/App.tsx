import { useReducer, useState, type CSSProperties, type Dispatch, type FormEvent } from "react"
import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Camera,
  CheckCircle2,
  CircleDot,
  Clock3,
  Command,
  FileCheck2,
  Gauge,
  GitBranch,
  Hammer,
  LayoutDashboard,
  ListChecks,
  Lock,
  Network,
  PauseCircle,
  Radio,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Zap,
} from "lucide-react"

import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { Separator } from "./components/ui/separator"
import {
  buildDashboardModel,
  reduceDashboardModel,
  type AgentNode,
  type DashboardAction,
  type DashboardView,
  type MissionStatus,
  type PolicyGate,
  type SnapshotRecord,
  type TaskCard,
} from "./dashboard-model"

const lanes = ["Plan", "Build", "Verify", "Recover"] as const

const navItems = [
  { view: "missions", label: "Missions", icon: LayoutDashboard },
  { view: "agents", label: "Agents", icon: Bot },
  { view: "policies", label: "Policies", icon: ShieldCheck },
  { view: "snapshots", label: "Snapshots", icon: GitBranch },
] satisfies Array<{ view: DashboardView; label: string; icon: typeof LayoutDashboard }>

const sectionMeta = {
  missions: {
    eyebrow: "OpenCode Mission OS",
    title: "Operate the agentic run",
    status: "Mission board online",
  },
  agents: {
    eyebrow: "Agent Mesh",
    title: "Coordinate specialist leases",
    status: "Capacity routing armed",
  },
  policies: {
    eyebrow: "Runtime Policy",
    title: "Enforce autonomy gates",
    status: "Guardrails enforcing",
  },
  snapshots: {
    eyebrow: "Evidence Ledger",
    title: "Replay mission state",
    status: "Snapshots indexed",
  },
} satisfies Record<DashboardView, { eyebrow: string; title: string; status: string }>

const statusIcon = {
  running: Activity,
  verified: CheckCircle2,
  stale: Clock3,
  blocked: AlertTriangle,
} satisfies Record<MissionStatus, typeof Activity>

type DashboardDispatch = Dispatch<DashboardAction>

export function App() {
  const [model, dispatch] = useReducer(reduceDashboardModel, undefined, buildDashboardModel)
  const [directive, setDirective] = useState("")
  const activeSection = sectionMeta[model.activeView]

  const forgeDirective = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    dispatch({ type: "forge-directive", prompt: directive })
    setDirective("")
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles aria-hidden="true" />
          </div>
          <div>
            <p className="brand-name">Runesmith</p>
            <p className="brand-subtitle">Orchestration OS</p>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Runesmith sections">
          {navItems.map(({ view, label, icon: Icon }) => (
            <button
              aria-current={model.activeView === view ? "page" : undefined}
              className={model.activeView === view ? "nav-item nav-item-active" : "nav-item"}
              key={view}
              onClick={() => dispatch({ type: "select-view", view })}
              type="button"
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>

        <Separator />

        <div className="sidebar-block">
          <p className="eyebrow">Runtime Health</p>
          <div className="health-row"><span>Readiness</span><Badge tone="verified">{model.operationalScore}%</Badge></div>
          <div className="health-row"><span>Autonomy mode</span><Badge>{model.mode}</Badge></div>
          <div className="health-row"><span>Evidence gate</span><Badge tone="verified">armed</Badge></div>
          <div className="health-row"><span>Stall radar</span><Badge tone={model.metrics.stale > 0 ? "stale" : "verified"}>{model.metrics.stale > 0 ? "watching" : "clear"}</Badge></div>
        </div>

        <div className="sidebar-block sidebar-compact">
          <p className="eyebrow">Command Feed</p>
          {model.commandLog.slice(0, 3).map((item) => (
            <div className="mini-event" key={item.id}>
              <span className={`tone-dot tone-dot-${item.tone}`} />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeSection.eyebrow}</p>
            <h1>{activeSection.title}</h1>
          </div>
          <div className="topbar-actions">
            <Button onClick={() => dispatch({ type: "create-snapshot" })} variant="outline">
              <Camera data-icon="inline-start" />Snapshot
            </Button>
            <Button onClick={() => dispatch({ type: "run-autopilot-cycle" })}>
              <Zap data-icon="inline-start" />Autopilot cycle
            </Button>
          </div>
        </header>

        <section aria-live="polite" className="notice-strip">
          <Sparkles aria-hidden="true" />
          <span>{model.notice}</span>
          <strong>{activeSection.status}</strong>
        </section>

        <section className="os-overview" aria-label="Runesmith readiness">
          <div className="score-panel">
            <div>
              <p className="eyebrow">Readiness Score</p>
              <strong>{model.operationalScore}</strong>
            </div>
            <div className="score-ring" style={{ "--score": `${model.operationalScore}%` } as CSSProperties}>
              <Gauge aria-hidden="true" />
            </div>
          </div>
          <div className="metric-grid" aria-label="Mission metrics">
            <Metric label="Running" status="running" value={model.metrics.running} />
            <Metric label="Verified" status="verified" value={model.metrics.verified} />
            <Metric label="Stale" status="stale" value={model.metrics.stale} />
            <Metric label="Blocked" status="blocked" value={model.metrics.blocked} />
          </div>
        </section>

        <form className="command-center" onSubmit={forgeDirective}>
          <Command aria-hidden="true" />
          <input
            aria-label="Mission directive"
            className="command-input"
            onChange={(event) => setDirective(event.target.value)}
            placeholder="Forge a mission directive, e.g. Add OpenCode replay guard"
            value={directive}
          />
          <Button type="submit">
            <Hammer data-icon="inline-start" />Forge
          </Button>
        </form>

        <ActiveView dispatch={dispatch} model={model} />
      </section>

      <Inspector dispatch={dispatch} model={model} />
    </main>
  )
}

function ActiveView({
  dispatch,
  model,
}: {
  dispatch: DashboardDispatch
  model: ReturnType<typeof buildDashboardModel>
}) {
  if (model.activeView === "agents") {
    return <AgentsView dispatch={dispatch} model={model} />
  }

  if (model.activeView === "policies") {
    return <PoliciesView dispatch={dispatch} policies={model.policies} />
  }

  if (model.activeView === "snapshots") {
    return <SnapshotsView dispatch={dispatch} snapshots={model.snapshots} />
  }

  return (
    <>
      <MissionBoard dispatch={dispatch} model={model} />
      <TimelinePanel timeline={model.timeline} />
    </>
  )
}

function MissionBoard({
  dispatch,
  model,
}: {
  dispatch: DashboardDispatch
  model: ReturnType<typeof buildDashboardModel>
}) {
  return (
    <section className="mission-board" aria-label="Mission lanes">
      {lanes.map((lane) => (
        <div className="lane" key={lane}>
          <div className="lane-header">
            <span>{lane}</span>
            <Badge>{model.tasks.filter((task) => task.lane === lane).length}</Badge>
          </div>
          <div className="lane-stack">
            {model.tasks
              .filter((task) => task.lane === lane)
              .map((task) => (
                <TaskCardView
                  key={task.id}
                  onSelect={() => dispatch({ type: "select-task", taskId: task.id })}
                  selected={task.id === model.selectedTask.id}
                  task={task}
                />
              ))}
          </div>
        </div>
      ))}
    </section>
  )
}

function AgentsView({
  dispatch,
  model,
}: {
  dispatch: DashboardDispatch
  model: ReturnType<typeof buildDashboardModel>
}) {
  return (
    <section className="view-stack" aria-label="Agent mesh">
      <div className="view-header">
        <div>
          <p className="eyebrow">Mesh Control</p>
          <h2>Agent leases, capacity, and tool scopes</h2>
        </div>
        <Badge tone="verified">{model.agents.filter((agent) => agent.status === "active").length} active</Badge>
      </div>
      <div className="agent-grid">
        {model.agents.map((agent) => (
          <AgentCard
            agent={agent}
            key={agent.id}
            onBoost={() => dispatch({ type: "boost-agent", agentId: agent.id })}
            onSelect={() => dispatch({ type: "select-agent", agentId: agent.id })}
            selected={model.selectedAgentId === agent.id}
          />
        ))}
      </div>
    </section>
  )
}

function AgentCard({
  agent,
  onBoost,
  onSelect,
  selected,
}: {
  agent: AgentNode
  onBoost: () => void
  onSelect: () => void
  selected: boolean
}) {
  return (
    <article className={selected ? "agent-card agent-card-selected" : "agent-card"}>
      <button className="agent-select" onClick={onSelect} type="button">
        <span className={`status-dot status-dot-${agent.status}`} />
        <div>
          <strong>{agent.name}</strong>
          <span>{agent.role}</span>
        </div>
        <Badge>{agent.status}</Badge>
      </button>
      <div className="capacity-row">
        <span>Capacity</span>
        <strong>{agent.capacity}%</strong>
      </div>
      <div className="capacity-track">
        <span style={{ width: `${agent.capacity}%` }} />
      </div>
      <dl className="agent-facts">
        <div><dt>Lease</dt><dd>{agent.activeLease}</dd></div>
        <div><dt>Queue</dt><dd>{agent.queue} tasks</dd></div>
        <div><dt>Success</dt><dd>{agent.successRate}%</dd></div>
      </dl>
      <p>{agent.focus}</p>
      <div className="card-actions">
        <Button onClick={onBoost} size="sm" variant="outline">
          <Zap data-icon="inline-start" />Boost
        </Button>
      </div>
    </article>
  )
}

function PoliciesView({
  dispatch,
  policies,
}: {
  dispatch: DashboardDispatch
  policies: PolicyGate[]
}) {
  return (
    <section className="view-stack" aria-label="Policy gates">
      <div className="view-header">
        <div>
          <p className="eyebrow">Guardrail Matrix</p>
          <h2>Autonomy gates that keep agents honest</h2>
        </div>
        <Badge tone="verified">{policies.filter((policy) => policy.enabled).length} enforcing</Badge>
      </div>
      <div className="policy-grid">
        {policies.map((policy) => (
          <article className={policy.enabled ? "policy-card" : "policy-card policy-card-disabled"} key={policy.id}>
            <div className="policy-header">
              <div>
                <strong>{policy.name}</strong>
                <span>{policy.severity}</span>
              </div>
              <Button onClick={() => dispatch({ type: "toggle-policy", policyId: policy.id })} size="sm" variant={policy.enabled ? "outline" : "default"}>
                <SlidersHorizontal data-icon="inline-start" />{policy.enabled ? "Disable" : "Enable"}
              </Button>
            </div>
            <p>{policy.description}</p>
            <div className="capacity-row">
              <span>{policy.signal}</span>
              <strong>{policy.coverage}%</strong>
            </div>
            <div className="capacity-track">
              <span style={{ width: `${policy.coverage}%` }} />
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function SnapshotsView({
  dispatch,
  snapshots,
}: {
  dispatch: DashboardDispatch
  snapshots: SnapshotRecord[]
}) {
  return (
    <section className="view-stack" aria-label="Mission snapshots">
      <div className="view-header">
        <div>
          <p className="eyebrow">Replay Ledger</p>
          <h2>Evidence checkpoints and recovery anchors</h2>
        </div>
        <Button onClick={() => dispatch({ type: "create-snapshot" })} variant="outline">
          <Archive data-icon="inline-start" />Seal checkpoint
        </Button>
      </div>
      <div className="snapshot-table">
        {snapshots.map((snapshot) => (
          <article className="snapshot-row" key={snapshot.id}>
            <div>
              <strong>{snapshot.label}</strong>
              <span>{snapshot.createdAt} / {snapshot.hash}</span>
            </div>
            <div><span>Tasks</span><strong>{snapshot.tasks}</strong></div>
            <div><span>Evidence</span><strong>{snapshot.evidence}</strong></div>
            <div><span>Score</span><strong>{snapshot.score}</strong></div>
            <Badge tone={snapshot.tone}>{snapshot.tone}</Badge>
          </article>
        ))}
      </div>
    </section>
  )
}

function TimelinePanel({ timeline }: { timeline: Array<{ id: string; label: string; detail: string; tone: MissionStatus }> }) {
  return (
    <section className="timeline" aria-label="Runtime timeline">
      <div className="timeline-header">
        <ListChecks />
        <span>Runtime Timeline</span>
      </div>
      <div className="timeline-row">
        {timeline.map((item) => {
          const Icon = statusIcon[item.tone]
          return (
            <div className="timeline-item" key={item.id}>
              <Icon aria-hidden="true" />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function Inspector({
  dispatch,
  model,
}: {
  dispatch: DashboardDispatch
  model: ReturnType<typeof buildDashboardModel>
}) {
  return (
    <aside className="inspector">
      <div className="inspector-header">
        <p className="eyebrow">Selected Task</p>
        <Badge tone={model.selectedTask.status}>{model.selectedTask.status}</Badge>
      </div>
      <h2>{model.selectedTask.title}</h2>
      <p className="inspector-summary">{model.selectedTask.summary}</p>

      <div className="inspector-actions">
        <Button onClick={() => dispatch({ type: "hold-selected" })} variant="outline">
          <PauseCircle data-icon="inline-start" />Hold
        </Button>
        <Button onClick={() => dispatch({ type: "verify-selected" })}>
          <CheckCircle2 data-icon="inline-start" />Verify
        </Button>
      </div>

      <Separator />

      <section className="detail-stack">
        <Detail label="Agent" value={model.selectedTask.agent} icon={Bot} />
        <Detail label="Active lease" value="task.claim / 30s" icon={CircleDot} />
        <Detail label="Model policy" value="sonnet -> gpt-5.1-codex" icon={TerminalSquare} />
      </section>

      <section className="operator-card">
        <div className="operator-title">
          <Network aria-hidden="true" />
          <div>
            <span>Focused Agent</span>
            <strong>{model.selectedAgent.name}</strong>
          </div>
          <Badge>{model.selectedAgent.status}</Badge>
        </div>
        <p>{model.selectedAgent.focus}</p>
        <div className="capacity-track">
          <span style={{ width: `${model.selectedAgent.capacity}%` }} />
        </div>
      </section>

      <section>
        <p className="section-title">Evidence</p>
        <div className="chip-row">
          {model.selectedTask.evidence.map((item) => <Badge key={item} tone="verified">{item}</Badge>)}
        </div>
      </section>

      <section>
        <p className="section-title">Allowed Tools</p>
        <div className="chip-row">
          {model.selectedTask.tools.map((item) => <Badge key={item}>{item}</Badge>)}
        </div>
      </section>

      <section>
        <p className="section-title">OS Gates</p>
        <div className="gate-stack">
          <Detail label="Lease mutex" value="exclusive" icon={Lock} />
          <Detail label="Evidence ledger" value={`${model.snapshots[0]?.evidence ?? 0} proofs`} icon={FileCheck2} />
          <Detail label="Recovery radar" value={model.metrics.stale > 0 ? "armed" : "clear"} icon={Radio} />
        </div>
      </section>
    </aside>
  )
}

function Metric({ label, status, value }: { label: string; status: MissionStatus; value: number }) {
  const Icon = statusIcon[status]
  return (
    <div className={`metric metric-${status}`}>
      <Icon aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}

function TaskCardView({
  onSelect,
  selected,
  task,
}: {
  onSelect: () => void
  selected: boolean
  task: TaskCard
}) {
  const Icon = statusIcon[task.status]

  return (
    <button
      aria-pressed={selected}
      className={selected ? "task-card task-card-selected" : "task-card"}
      onClick={onSelect}
      type="button"
    >
      <span className="rs-card-header">
        <span className="task-title-row">
          <Icon aria-hidden="true" />
          <span className="rs-card-title">{task.title}</span>
        </span>
        <Badge tone={task.status}>{task.status}</Badge>
      </span>
      <span className="rs-card-content">
        <span className="rs-card-description">{task.summary}</span>
        <span className="task-footer">
          <span>{task.agent}</span>
          <span>{task.tools.length} tools</span>
        </span>
      </span>
    </button>
  )
}

function Detail({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Bot
  label: string
  value: string
}) {
  return (
    <div className="detail-row">
      <Icon aria-hidden="true" />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}
