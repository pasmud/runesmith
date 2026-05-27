import { useReducer } from "react"
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  CircleDot,
  Clock3,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  PauseCircle,
  Play,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
} from "lucide-react"

import { Badge } from "./components/ui/badge"
import { Button } from "./components/ui/button"
import { Separator } from "./components/ui/separator"
import {
  buildDashboardModel,
  reduceDashboardModel,
  type DashboardView,
  type MissionStatus,
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
    eyebrow: "OpenCode Mission",
    title: "Build a durable agentic harness",
    status: "Mission board online",
  },
  agents: {
    eyebrow: "Agent Control",
    title: "Coordinate specialist leases",
    status: "Capacity view armed",
  },
  policies: {
    eyebrow: "Runtime Policy",
    title: "Tune autonomy gates",
    status: "Policies enforcing",
  },
  snapshots: {
    eyebrow: "Evidence Ledger",
    title: "Inspect mission snapshots",
    status: "Snapshots indexed",
  },
} satisfies Record<DashboardView, { eyebrow: string; title: string; status: string }>

const statusIcon = {
  running: Activity,
  verified: CheckCircle2,
  stale: Clock3,
  blocked: AlertTriangle,
} satisfies Record<MissionStatus, typeof Activity>

export function App() {
  const [model, dispatch] = useReducer(reduceDashboardModel, undefined, buildDashboardModel)
  const activeSection = sectionMeta[model.activeView]

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles aria-hidden="true" />
          </div>
          <div>
            <p className="brand-name">Runesmith</p>
            <p className="brand-subtitle">Mission Runtime</p>
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
          <div className="health-row"><span>Lease scheduler</span><Badge tone="verified">locked</Badge></div>
          <div className="health-row"><span>Evidence gate</span><Badge tone="verified">armed</Badge></div>
          <div className="health-row"><span>Stall radar</span><Badge tone="stale">watching</Badge></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">{activeSection.eyebrow}</p>
            <h1>{activeSection.title}</h1>
          </div>
          <div className="topbar-actions">
            <Button onClick={() => dispatch({ type: "recover-stale" })} variant="outline">
              <RefreshCcw data-icon="inline-start" />Recover
            </Button>
            <Button onClick={() => dispatch({ type: "run-verifier" })}>
              <Play data-icon="inline-start" />Run verifier
            </Button>
          </div>
        </header>

        <section aria-live="polite" className="notice-strip">
          <Sparkles aria-hidden="true" />
          <span>{model.notice}</span>
          <strong>{activeSection.status}</strong>
        </section>

        <section className="metric-grid" aria-label="Mission metrics">
          <Metric label="Running" status="running" value={model.metrics.running} />
          <Metric label="Verified" status="verified" value={model.metrics.verified} />
          <Metric label="Stale" status="stale" value={model.metrics.stale} />
          <Metric label="Blocked" status="blocked" value={model.metrics.blocked} />
        </section>

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

        <section className="timeline" aria-label="Runtime timeline">
          <div className="timeline-header">
            <ListChecks />
            <span>Runtime Timeline</span>
          </div>
          <div className="timeline-row">
            {model.timeline.map((item) => {
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
      </section>

      <aside className="inspector">
        <div className="inspector-header">
          <p className="eyebrow">Selected Task</p>
          <Badge tone={model.selectedTask.status}>{model.selectedTask.status}</Badge>
        </div>
        <h2>{model.selectedTask.title}</h2>
        <p className="inspector-summary">{model.selectedTask.summary}</p>

        <Separator />

        <section className="detail-stack">
          <Detail label="Agent" value={model.selectedTask.agent} icon={Bot} />
          <Detail label="Active lease" value="task.claim / 30s" icon={CircleDot} />
          <Detail label="Model policy" value="sonnet -> gpt-5.1-codex" icon={TerminalSquare} />
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

        <div className="inspector-actions">
          <Button onClick={() => dispatch({ type: "hold-selected" })} variant="outline">
            <PauseCircle data-icon="inline-start" />Hold
          </Button>
          <Button onClick={() => dispatch({ type: "verify-selected" })}>
            <CheckCircle2 data-icon="inline-start" />Verify
          </Button>
        </div>
      </aside>
    </main>
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
