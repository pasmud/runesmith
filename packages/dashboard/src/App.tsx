import { useReducer, useState, type CSSProperties, type Dispatch, type FormEvent, type ReactNode } from "react"
import {
  Activity,
  AlertTriangle,
  Archive,
  Bell,
  Bot,
  Camera,
  CheckCircle2,
  CircleDot,
  Clock3,
  Command,
  Gauge,
  GitBranch,
  Hammer,
  Home,
  LayoutDashboard,
  Lock,
  PauseCircle,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
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

const appTiles = [
  { label: "Mission Board", owner: "runesmith-core", view: "missions", icon: LayoutDashboard },
  { label: "Agent Mesh", owner: "runesmith-runtime", view: "agents", icon: Bot },
  { label: "Policy Gates", owner: "runesmith-guard", view: "policies", icon: ShieldCheck },
  { label: "Evidence Ledger", owner: "runesmith-ledger", view: "snapshots", icon: GitBranch },
] satisfies Array<{ label: string; owner: string; view: DashboardView; icon: typeof LayoutDashboard }>

const navItems = [
  { view: "missions", label: "Home", icon: Home },
  { view: "agents", label: "Agents", icon: Bot },
  { view: "policies", label: "Policies", icon: ShieldCheck },
  { view: "snapshots", label: "Snapshots", icon: GitBranch },
] satisfies Array<{ view: DashboardView; label: string; icon: typeof Home }>

const sectionMeta = {
  missions: {
    title: "Good afternoon",
    subtitle: "What would you like Runesmith to orchestrate today?",
    status: "Mission board online",
  },
  agents: {
    title: "Agent mesh",
    subtitle: "Coordinate leases, model policy, and specialist capacity.",
    status: "Capacity routing armed",
  },
  policies: {
    title: "Policy gates",
    subtitle: "Tune the guardrails that keep agent autonomy honest.",
    status: "Guardrails enforcing",
  },
  snapshots: {
    title: "Evidence ledger",
    subtitle: "Replay mission checkpoints, artifacts, and recovery anchors.",
    status: "Snapshots indexed",
  },
} satisfies Record<DashboardView, { title: string; subtitle: string; status: string }>

const statusIcon = {
  running: Activity,
  verified: CheckCircle2,
  stale: Clock3,
  blocked: AlertTriangle,
} satisfies Record<MissionStatus, typeof Activity>

type DashboardDispatch = Dispatch<DashboardAction>
type DashboardModel = ReturnType<typeof buildDashboardModel>

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
      <Sidebar dispatch={dispatch} model={model} />

      <section className="workspace">
        <header className="workspace-header">
          <div>
            <h1>{activeSection.title}</h1>
            <p>{activeSection.subtitle}</p>
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

        <section aria-live="polite" className="notice-strip">
          <Sparkles aria-hidden="true" />
          <span>{model.notice}</span>
          <strong>{activeSection.status}</strong>
        </section>

        <ActiveView dispatch={dispatch} model={model} />
      </section>

      <RightRail dispatch={dispatch} model={model} />
    </main>
  )
}

function Sidebar({ dispatch, model }: { dispatch: DashboardDispatch; model: DashboardModel }) {
  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div>
          <p className="brand-name">Runesmith <span>OS</span></p>
        </div>
        <Sparkles aria-hidden="true" />
      </div>

      <label className="search-box">
        <Search aria-hidden="true" />
        <input aria-label="Search Runesmith" placeholder="Search" />
        <kbd>⌘K</kbd>
      </label>

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
            {view === "missions" && model.metrics.stale > 0 ? <Badge tone="blocked">{model.metrics.stale}</Badge> : null}
          </button>
        ))}
      </nav>

      <Separator />

      <SidebarGroup title="Agents">
        {model.agents.slice(0, 4).map((agent) => (
          <button className="sidebar-row" key={agent.id} onClick={() => dispatch({ type: "select-agent", agentId: agent.id })} type="button">
            <span className="row-avatar">{agent.name[0]}</span>
            <span>{agent.name}</span>
          </button>
        ))}
      </SidebarGroup>

      <SidebarGroup title="Apps">
        {appTiles.map(({ icon: Icon, label, view }) => (
          <button className="sidebar-row" key={label} onClick={() => dispatch({ type: "select-view", view })} type="button">
            <span className="row-avatar row-avatar-green"><Icon aria-hidden="true" /></span>
            <span>{label}</span>
          </button>
        ))}
      </SidebarGroup>

      <SidebarGroup title="Artifacts">
        {model.snapshots.slice(0, 3).map((snapshot) => (
          <button className="sidebar-row" key={snapshot.id} onClick={() => dispatch({ type: "select-view", view: "snapshots" })} type="button">
            <span className="row-avatar row-avatar-pink"><Archive aria-hidden="true" /></span>
            <span>{snapshot.label}</span>
          </button>
        ))}
      </SidebarGroup>
    </aside>
  )
}

function SidebarGroup({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="sidebar-group">
      <div className="sidebar-group-title">
        <span>{title}</span>
        <span>⌃</span>
      </div>
      {children}
    </section>
  )
}

function ActiveView({ dispatch, model }: { dispatch: DashboardDispatch; model: DashboardModel }) {
  if (model.activeView === "agents") {
    return <AgentsView dispatch={dispatch} model={model} />
  }

  if (model.activeView === "policies") {
    return <PoliciesView dispatch={dispatch} policies={model.policies} />
  }

  if (model.activeView === "snapshots") {
    return <SnapshotsView dispatch={dispatch} snapshots={model.snapshots} />
  }

  return <HomeView dispatch={dispatch} model={model} />
}

function HomeView({ dispatch, model }: { dispatch: DashboardDispatch; model: DashboardModel }) {
  return (
    <section className="home-stack">
      <section>
        <SectionHeader action="View all 5" title="Top agents" />
        <div className="top-agent-grid">
          {model.agents.slice(0, 4).map((agent) => (
            <button className="top-agent-card" key={agent.id} onClick={() => dispatch({ type: "select-agent", agentId: agent.id })} type="button">
              <span className="tile-icon"><Bot aria-hidden="true" /></span>
              <strong>{agent.name}</strong>
              <span><i className={`status-dot status-dot-${agent.status}`} />{agent.status}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-grid">
        <div className="panel-card">
          <SectionHeader action="View all 4" title="Top apps" />
          <div className="app-list">
            {appTiles.map(({ icon: Icon, label, owner, view }) => (
              <button className="app-row" key={label} onClick={() => dispatch({ type: "select-view", view })} type="button">
                <span className="tile-icon tile-icon-green"><Icon aria-hidden="true" /></span>
                <span><strong>{label}</strong><small>by {owner}</small></span>
              </button>
            ))}
          </div>
        </div>

        <div className="panel-card">
          <SectionHeader action={`View all ${model.snapshots.length}`} title="Recent artifacts" />
          <div className="artifact-list">
            {model.snapshots.slice(0, 3).map((snapshot) => (
              <button className="artifact-row" key={snapshot.id} onClick={() => dispatch({ type: "select-view", view: "snapshots" })} type="button">
                <span className="tile-icon tile-icon-pink"><Archive aria-hidden="true" /></span>
                <span><strong>{snapshot.label}</strong><small>{snapshot.hash}</small></span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="jobs-panel">
        <SectionHeader action="View all 3" title="Cron Jobs" />
        <JobRow
          detail={`Active · Every 30m · by ${model.selectedAgent.name}`}
          label="Guarded autopilot cycle"
          onRun={() => dispatch({ type: "run-autopilot-cycle" })}
          tone="verified"
        />
        <JobRow
          detail={`Active · Stale threshold watch · ${model.metrics.stale} stale`}
          label="Recovery sweep"
          onRun={() => dispatch({ type: "recover-stale" })}
          tone={model.metrics.stale > 0 ? "stale" : "verified"}
        />
        <JobRow
          detail={`Manual · Evidence gate verifier · ${model.metrics.verified} verified`}
          label="Evidence verifier"
          onRun={() => dispatch({ type: "run-verifier" })}
          tone="running"
        />
      </section>

      <section className="panel-card">
        <SectionHeader action="Mission lanes" title="Active work" />
        <MissionBoard dispatch={dispatch} model={model} />
      </section>
    </section>
  )
}

function SectionHeader({ action, title }: { action: string; title: string }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      <span>{action}</span>
    </div>
  )
}

function JobRow({
  detail,
  label,
  onRun,
  tone,
}: {
  detail: string
  label: string
  onRun: () => void
  tone: MissionStatus
}) {
  return (
    <div className="job-row">
      <span className={`tile-icon tile-icon-${tone}`}><Clock3 aria-hidden="true" /></span>
      <div>
        <strong>{label}</strong>
        <span>{detail}</span>
      </div>
      <Button onClick={onRun} size="sm" variant="outline">Run</Button>
    </div>
  )
}

function MissionBoard({ dispatch, model }: { dispatch: DashboardDispatch; model: DashboardModel }) {
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

function AgentsView({ dispatch, model }: { dispatch: DashboardDispatch; model: DashboardModel }) {
  return (
    <section className="view-stack" aria-label="Agent mesh">
      <ViewHero score={model.operationalScore} status={`${model.agents.filter((agent) => agent.status === "active").length} active`} title="Agent leases, capacity, and tool scopes" />
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

function ViewHero({ score, status, title }: { score: number; status: string; title: string }) {
  return (
    <div className="view-hero">
      <div>
        <h2>{title}</h2>
        <span>{status}</span>
      </div>
      <div className="score-ring" style={{ "--score": `${score}%` } as CSSProperties}>
        <Gauge aria-hidden="true" />
      </div>
    </div>
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

function PoliciesView({ dispatch, policies }: { dispatch: DashboardDispatch; policies: PolicyGate[] }) {
  return (
    <section className="view-stack" aria-label="Policy gates">
      <ViewHero score={policies.filter((policy) => policy.enabled).length * 20} status={`${policies.filter((policy) => policy.enabled).length} enforcing`} title="Autonomy gates that keep agents honest" />
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

function SnapshotsView({ dispatch, snapshots }: { dispatch: DashboardDispatch; snapshots: SnapshotRecord[] }) {
  return (
    <section className="view-stack" aria-label="Mission snapshots">
      <div className="view-hero">
        <div>
          <h2>Evidence checkpoints and recovery anchors</h2>
          <span>{snapshots.length} sealed snapshots</span>
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

function RightRail({ dispatch, model }: { dispatch: DashboardDispatch; model: DashboardModel }) {
  const unread = model.commandLog.length

  return (
    <aside className="right-rail">
      <section className="notifications">
        <header className="rail-header">
          <div>
            <h2>Notifications</h2>
            {unread > 0 ? <Badge tone="blocked">{unread}</Badge> : null}
          </div>
          <button className="link-button" onClick={() => dispatch({ type: "mark-notifications-read" })} type="button">Mark all read</button>
        </header>
        <div className="notification-list">
          {model.commandLog.length > 0 ? (
            model.commandLog.slice(0, 5).map((item) => (
              <article className="notification-item" key={item.id}>
                <div>
                  <span className={`notification-pill notification-pill-${item.tone}`}>{item.tone === "blocked" ? "Alert" : item.tone === "stale" ? "Needs input" : "Task"}</span>
                  <strong>{item.label}</strong>
                </div>
                <p>{item.detail}</p>
                <small>runesmith-os · just now</small>
                <i />
              </article>
            ))
          ) : (
            <div className="empty-state">
              <Bell aria-hidden="true" />
              <strong>No unread notifications</strong>
              <span>Command feed is clear.</span>
            </div>
          )}
        </div>
      </section>

      <section className="task-panel">
        <div className="inspector-header">
          <p className="eyebrow">Selected Task</p>
          <Badge tone={model.selectedTask.status}>{model.selectedTask.status}</Badge>
        </div>
        <h2>{model.selectedTask.title}</h2>
        <p>{model.selectedTask.summary}</p>
        <div className="inspector-actions">
          <Button onClick={() => dispatch({ type: "hold-selected" })} variant="outline">
            <PauseCircle data-icon="inline-start" />Hold
          </Button>
          <Button onClick={() => dispatch({ type: "verify-selected" })}>
            <CheckCircle2 data-icon="inline-start" />Verify
          </Button>
        </div>
        <Separator />
        <div className="detail-stack">
          <Detail label="Agent" value={model.selectedTask.agent} icon={Bot} />
          <Detail label="Lease" value="task.claim / 30s" icon={CircleDot} />
          <Detail label="Policy" value="evidence gated" icon={Lock} />
        </div>
      </section>
    </aside>
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
