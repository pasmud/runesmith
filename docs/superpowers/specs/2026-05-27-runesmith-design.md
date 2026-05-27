# Runesmith Design Spec

## Purpose

Runesmith is an OpenCode mission runtime. It turns a user request into a durable mission graph with explicit agent contracts, leased execution, evidence capture, recovery rules, and a control surface. The first release is not a fork of oh-my-openagent. It uses the lessons from that project to build a smaller, more reliable kernel that can grow into a stronger harness.

## Product Thesis

Most coding-agent harnesses become fragile because coordination is encoded as prompt text and hook side effects. Runesmith treats coordination as runtime state. Prompts, tools, sessions, and agents become events against a mission graph, and only the scheduler may advance that graph.

The result should feel magical to users because work becomes visible, recoverable, and verifiable. The system can answer what is running, who owns each file, why an agent is blocked, what evidence proves a task is done, and what recovery action is safe.

## First Release Scope

The first production slice includes:

- A TypeScript/Bun monorepo named `runesmith`.
- A core package with mission graph, lease scheduler, agent contracts, evidence ledger, tool router, and recovery primitives.
- An OpenCode adapter package that exposes mission tools through the OpenCode plugin API.
- A CLI package with `init`, `doctor`, and mission inspection commands.
- A dashboard package using shadcn/ui conventions and an OpenClaw OS-inspired layout for mission visibility.
- A testbench package with deterministic simulations for duplicate prompt leases, stale tasks, missing capabilities, and evidence verification.
- A root OpenCode package entrypoint so users can install Runesmith with one `opencode.json` plugin line: `runesmith@git+https://github.com/pasmud/runesmith.git`.
- A root `runesmith` package binary that points at the built CLI, so the same direct install can expose setup, status, proof, run, doctor, and launch commands without requiring users to know the monorepo layout.
- A native Runic Covenant workflow layer that installs automatically with the OpenCode plugin and drives frame, map, claim, forge, prove, repair, review, seal, and recovery behavior without manual workflow invocation.
- A default runtime capsule at `.runesmith/runtime/capsule.json` so mission state survives OpenCode restarts and CLI inspection works without requiring a manual snapshot flag.
- Runesmith Autopilot hooks for OpenCode system bootstrap and compaction continuity, so the engine can prepare and resume missions without the user loading separate workflow skills.
- Zero-touch mission preparation from OpenCode `tool.execute.before` when a mutating or shell tool is about to run and no active mission exists.
- Zero-touch mission preparation from OpenCode `session.idle` when chat context is present and no active mission exists.
- Automatic evidence capture from OpenCode tool execution events for shell commands, test runs, and file edits, followed by an immediate evidence-gated advance attempt.
- Evidence writes are validated against the mission graph and refresh task heartbeat/timeline state, so active proof collection is not mistaken for stale work.
- Fresh-proof evidence gates that reject passing `test-result` evidence when a newer file-change or diagnostic exists on the task.
- Human-hold risk gates that reject completion after unresolved `risk` evidence until a later `decision` explicitly clears, accepts, or holds the risk.
- Direct risk resolution controls in core, OpenCode, CLI, and dashboard surfaces so the user does not need to inspect mission ids or write raw decision evidence.
- Direct OpenCode package startup repairs missing or invalid project config and runtime capsules with a backup-first repair path, so corrupt local state does not prevent the plugin from loading tools.
- Engine-owned OpenCode idle orchestration that runs Runeweave automatically, recovers stale work first, prepares the first mission from chat context, runs the active Proof Plan after implementation evidence exists, advances Review and Seal when evidence requirements are satisfied, records a `runeweave.stopped` mission event, holds failed proof as a repair target, and retries after a new repair edit.
- A shared Runic mission loop kernel in `packages/core` so OpenCode, CLI, and dashboard surfaces use the same recovery, claim, evidence, decision, and completion state machine.
- A state-aware Runesmith Control Brief that tells OpenCode the active mission, active task, next Runic Covenant stage, required evidence, and missing proof directly from runtime state.
- A Runesmith Loop Pulse that derives one authoritative next action, compact execution plan, health signal, priority, blockers, required evidence, and active runes from the runtime capsule.
- A Runesmith Runebook that turns the live Loop Pulse into one active procedure card with autonomy mode, trigger, intent, steps, required evidence, commands, tool hints, and stop conditions.
- A Runesmith Protocol Deck that turns Loop Pulse state into engine-selected protocols with objective, procedure, verification, forbidden moves, and tool hints, giving Runesmith its own install-once workflow layer instead of relying on external skill names.
- A Runesmith Proof Plan that turns missing proof, stale proof, and failed diagnostics into exact verification commands across OpenCode, CLI, and dashboard surfaces, including lint when a repository exposes it.
- A Runesmith Proof Runner that executes the active Proof Plan, records passing proof or failing diagnostics, and advances the shared mission loop when proof passes.
- A Runesmith Scope Sentinel that checks captured file-change evidence against the assigned agent contract's `fileScope`, surfaces drift in OpenCode, CLI, and dashboard views, and feeds critical scope findings into Review Lens before Seal.
- A Runesmith Seal Audit that combines Proof Plan, Scope Sentinel, Review Lens, mission state, and Sealmark decision evidence into one engine-owned completion gate across OpenCode, CLI, and dashboard surfaces.
- A Runesmith Next router that executes the active Runebook card from one OpenCode tool, one CLI command, and one dashboard action, selecting proof, repair, recovery, supplied risk decision, or loop advancement from runtime state.
- A Runeweave OS loop that repeatedly runs Runesmith Next over engine-owned cards until work is sealed or the runtime reaches a concrete stop condition: idle, needs implementation evidence, failed proof, risk hold, blocker, or safety step limit.
- A default Covenant task plan that expands coding goals into Forge, Review, and Seal tasks with dependency-aware claiming and task-level evidence requirements.

Out of scope for the first slice:

- True distributed agents across machines.
- Provider billing integration.
- Full visual app generation.
- Long-term semantic memory beyond scoped in-repo mission capsules.

## Package Architecture

### `packages/core`

Owns all harness-independent logic. It has no OpenCode imports.

Responsibilities:

- Mission graph lifecycle.
- Mission, task, agent, lease, capability, event, and evidence types.
- Agent contract validation.
- Lease-based scheduling.
- Tool routing.
- Evidence ledger.
- Recovery policy evaluation.
- Protocol Deck derivation from Loop Pulse, Runebook, and Proof Plan.
- Serialization to and from JSON snapshots.

### `packages/opencode-adapter`

Owns OpenCode integration.

Responsibilities:

- Export an OpenCode plugin module.
- Register mission tools.
- Inject the Runic Covenant and Runesmith Autopilot through OpenCode's system transform hook.
- Inject a mission capsule summary through OpenCode's compaction hook.
- Record evidence from OpenCode tool execution hooks without requiring the agent to call evidence tools manually for routine shell, test, and file-change proof.
- Advance the active mission from idle events through Runeweave and the runtime evidence gate, with automatic Proof Plan execution gated by implementation or repair evidence and stop reasons recorded on the mission graph.
- Translate OpenCode events into core runtime events.
- Use the core lease scheduler before sending any internal prompt or continuation.
- Keep OpenCode-specific types and instability out of `packages/core`.

### `packages/cli`

Owns local user commands.

Responsibilities:

- `runesmith up`: one-command bootstrap that writes project config, installs the Runesmith OpenCode plugin wiring, creates the runtime capsule if needed, and reports whether the host `opencode` CLI is available. `up --mode npm` uses the direct package plugin entry while still creating the Runesmith runtime capsule, so users do not need to learn a separate install command before first launch.
- `runesmith heal`: self-repair command that recreates missing config, backs up and replaces invalid runtime capsules, restores OpenCode package or shim plugin wiring, reruns doctor, and reports ready versus staged when OpenCode itself is not installed yet.
- `runesmith ignite "<goal>"`: least-ceremony first use. It defaults to the direct package-plugin install path, writes or refreshes OpenCode config, creates the runtime capsule, prepares or resumes the matching Covenant mission through the shared ignition primitive, claims the active task, and runs Runeweave until the next honest stop.
- `runesmith launch -- <opencode args>`: run the same bootstrap/readiness path, refuse to continue when `opencode` is missing, then hand off to the OpenCode CLI with pass-through arguments.
- `runesmith init`: create project config.
- `runesmith doctor`: validate config, runtime capsule, host OpenCode CLI availability, OpenCode plugin wiring, and an internal Forge -> Review -> Seal loop smoke test; exit nonzero with an actionable repair hint when setup is incomplete.
- `runesmith install --mode npm`: write only the default git-installable OpenCode package entry for existing projects, while keeping `--package` available for pinned tags, forks, or future registry releases.
- `runesmith status`: print the current OS state, OpenCode CLI readiness, Loop Pulse next action, execution plan, Mission Map summary, Scope Sentinel status, Review Lens status, Seal Audit status, active mission and task, missing proof, diagnostics, active runes, active Runebook card, and Proof Plan commands without requiring users to learn the lower-level mission commands.
- `runesmith run`: run Runeweave over the runtime capsule until Runesmith seals the mission or stops at implementation work, failed proof, unresolved risk, blocker, idle state, or a safety step limit.
- `runesmith next`: execute the active Runebook card from the runtime capsule, proving, repairing, recovering, applying a supplied risk decision, or advancing the shared mission loop without requiring users to choose a lower-level command.
- `runesmith prove`: execute the active Proof Plan from the runtime capsule, record passing commands as `test-result` evidence, record the first failing command as `diagnostic` evidence, and advance the shared mission loop after passing proof.
- Published packages expose built `dist` entrypoints, keep Bun source imports for local agent execution, and use publishable internal dependency ranges instead of workspace-only dependency specifiers.
- `runesmith mission start <goal>`: bootstrap local config if needed, create the default Forge -> Review -> Seal Covenant mission, record the `mission.mapped` task/dependency/evidence trace, register Atlas, claim the first task, and persist the runtime capsule for OpenCode/dashboard resumption.
- `runesmith risk resolve --summary <summary>`: record a decision for the active unresolved risk and advance the shared mission loop without requiring mission or task ids.
- `runesmith mission evidence <mission-id> <task-id>` and `runesmith mission tick`: record task proof and advance the persisted capsule through the same evidence gate used by OpenCode, including active repair diagnostics and safe autonomous Review and Seal decisions.
- `runesmith mission list`: print active mission summaries from snapshots.
- `runesmith mission inspect <id>`: print graph, Loop Pulse, Mission Map, Scope Sentinel, Review Lens, Seal Audit, Runebook card, Proof Plan, missing proof, active diagnostics, active runes, evidence, leases, and recovery state.

### `packages/dashboard`

Owns the local control surface.

Responsibilities:

- Vite React app.
- shadcn/ui component conventions.
- OpenClaw OS-inspired structure: workspace sidebar, mission lanes, live evidence, tool/action timeline, agent/session visibility, direct controls.
- Reads the local runtime capsule through a Vite dev API and falls back to seeded data only when no capsule exists.
- Exposes a runtime control API for dashboard actions that should persist into the same capsule OpenCode uses.

### `packages/testbench`

Owns deterministic harness simulations.

Responsibilities:

- Fake session/event bus.
- Duplicate prompt race simulation.
- Stale background task simulation.
- Missing capability simulation.
- Evidence-required completion simulation.

## Core Concepts

### Mission Graph

A mission graph contains a root mission and nodes for tasks, agents, tool calls, checks, evidence, blockers, and decisions. Nodes have stable IDs, timestamps, status, parent-child relationships, dependencies, task-level evidence requirements, and event history.

Mission statuses:

- `draft`
- `running`
- `blocked`
- `verifying`
- `complete`
- `failed`
- `cancelled`

Task statuses:

- `queued`
- `running`
- `blocked`
- `stale`
- `verifying`
- `complete`
- `failed`
- `cancelled`

### Leases

A lease is an exclusive permission to advance a mission target. The scheduler grants leases for actions such as starting a task, prompting an agent, retrying a task, continuing a session, or marking completion.

Lease properties:

- `leaseId`
- `targetId`
- `holder`
- `purpose`
- `idempotencyKey`
- `expiresAt`
- `status`

Only one active lease may exist for the same target and purpose. Replaying the same idempotency key returns the existing lease instead of creating another action.

### Agent Contracts

An agent contract declares what an agent can do and how it must prove completion.

Contract fields:

- `id`
- `displayName`
- `description`
- `capabilities`
- `allowedTools`
- `modelPolicy`
- `fileScope`
- `completionCriteria`
- `requiredEvidence`
- `fallbacks`

Contracts are validated before task assignment. If a task requires a capability the agent lacks, the runtime rejects the assignment. Task-level `requiredEvidence` can narrow or specialize a contract for a specific stage. For example, Forge requires `file-change` and passing `test-result`, while Review and Seal can require `decision` evidence.

### Evidence Ledger

The evidence ledger records proof that work happened.

Evidence types:

- `file-change`
- `command-output`
- `test-result`
- `diagnostic`
- `decision`
- `risk`

A task cannot move to `complete` unless its task-level or contract-level required evidence exists. This is the primary guard against false completion.
For `test-result` requirements, evidence must prove a passing run, such as `exitCode: 0` or an explicit success status. It must also be fresh against the task ledger: if a newer `file-change` or `diagnostic` exists, earlier passing proof is stale and does not satisfy completion. Failed or unknown test runs are diagnostic context, not completion proof.
For `risk` evidence, the ledger opens a human-hold gate. If the latest risk is newer than the latest decision on the same task, `decision` becomes required evidence even when the original task contract did not ask for it. The task cannot complete until a later decision clears, accepts, or deliberately holds the risk. The shared `resolveRunicRisk` primitive records that decision on the active Loop Pulse task and then re-enters the same evidence-gated loop used by proof, CLI ticks, dashboard controls, and OpenCode idle orchestration.

### Runtime Capsule

The runtime capsule is the default durable state file for a local project. It is a versioned JSON envelope containing graphs, ledgers, leases, and contracts. The direct OpenCode package plugin creates the default project config and capsule on first load when they are missing, backs up and repairs invalid config or capsule files on startup, resumes an existing capsule on later starts, and saves plugin mutations after successful mission, claim, evidence, completion, and recovery operations.

Default path:

- `.runesmith/runtime/capsule.json`

CLI commands read this capsule automatically:

- `runesmith mission list`
- `runesmith mission inspect <id>`

Explicit `--snapshot <path>` remains available for exported or test fixtures.

### Tool Router

The tool router selects the smallest useful tool set for a task from the agent contract and mission context. The first slice uses deterministic routing only. Model-assisted ranking is excluded from the first release.

### Runic Covenant

Runic Covenant is the Runesmith-owned agentic workflow doctrine. It is not an external workflow dependency and should not require users to invoke separate skills by name. The OpenCode adapter injects it into the session automatically.

Stages:

- Mission Frame: understand the user goal and repo context.
- Mission Map: turn the goal into an ordered mission graph.
- Lease Claim: claim work with a contract, idempotency key, and minimal tool scope.
- Forge: make scoped implementation changes.
- Proof Gate: attach required evidence before completion.
- Repair Gate: turn failed verification diagnostics into focused repair work before another proof attempt.
- Mirror Review: inspect diff and behavior for gaps.
- Seal: capture a replayable checkpoint.
- Recovery Sweep: recover stale or blocked work before drift.

Every stage carries gates and evidence signals. The covenant is a workflow policy layer; the runtime remains the source of truth for mission state, leases, and evidence.

The runtime also derives a live Runesmith Control Brief from the current snapshot. This brief does not ask the user to run a skill. It tells the coding agent what stage comes next, which mission and task are active, what proof is required, which evidence is still missing, and which risks are unresolved. Failed or unknown test runs are treated as diagnostics, so the brief moves the task into Repair Gate and keeps the agent focused on the latest failing command until passing test proof exists. Unresolved risk evidence moves the task into Mirror Review with a critical decision hold.

The Control Brief also includes Runesmith-native runes. The Runebook converts those runes and the live Loop Pulse into a concrete procedure card selected from runtime state, such as `Forge Trace implementation loop` during scoped edits, `Proofwright proof gate` when evidence is missing, `Faultwright repair loop` when verification fails, or `Mirrorglass risk decision` when risk is newer than decision evidence. Each card carries autonomy mode, trigger, intent, steps, evidence requirements, exact Proof Plan commands, OpenCode tool hints, and stop conditions. This borrows the useful discipline of explicit workflows while keeping the user experience install-once and automatic; users should not need to invoke external skills or remember process names.

The Protocol Deck sits beside the Runebook as Runesmith's own workflow-method layer. It derives one active protocol from Loop Pulse and Proof Plan, such as `Forge Trace Protocol`, `Proofwright Proof Protocol`, `Faultwright Repair Protocol`, `Recovery Loom Protocol`, or `Mirrorglass Risk Protocol`. Each protocol carries objective, procedure, verification, forbidden moves, and tool hints. This is where Runesmith internalizes the useful concept of explicit agent methods while keeping the user experience direct: users install Runesmith once, and the engine selects the protocol automatically.

Scope Sentinel sits beside Mission Map as the contract drift surface. It reads file-change evidence for the active implementation task, extracts changed paths, and checks them against the assigned contract's `fileScope`. In-scope changes are clear. Missing contract scope or uninspectable paths are attention states. Out-of-scope changes become critical findings and block Review Lens until they are reverted, justified through a later decision, or the contract scope is intentionally updated.

Review Lens sits beside Mission Map as the pre-seal review surface. It derives a checklist from the runtime capsule: implementation evidence, scope health, proof freshness, unresolved risk state, and review decision state. If proof is missing, risk is unresolved, or Scope Sentinel reports critical drift, it produces findings and holds review as waiting or blocked. When proof, risk, and scope gates are clear, it marks the mission ready for Mirror Review, and autonomous review decisions include a compact Review Lens summary in their decision evidence.

Seal Audit sits above Review Lens as the final completion-claim gate. It derives mission-state, proof-gate, scope-gate, review-gate, and seal-decision checks from the same runtime capsule. `collecting-proof` means the agent must run the Proof Plan before claiming done. `blocked` means scope, review, mission, or repair findings must be resolved first. `ready` means Sealmark can record the final checkpoint. `sealed` means the shared loop already produced completion evidence. This internalizes the useful "verification before completion" discipline while keeping the user experience automatic.

The Loop Pulse sits beside the Control Brief. It converts the live runtime state into one next action such as `Wait for goal`, `Continue forge`, `Capture proof`, `Repair diagnostic`, `Resolve risk`, `Recover stale work`, `Review change`, or `Seal mission`. It also derives an execution plan from that action, with active, queued, and blocked steps, required evidence, and the runes that should guide each step. OpenCode prompt injection, compaction context, CLI status, and the dashboard should all show this same pulse so the OS has one source of truth for what the agentic loop should do next.

Mission Memory sits above the pulse as the durable continuation layer. It classifies the mission as idle, active, blocked, needs-proof, needs-repair, needs-recovery, or sealed; summarizes active task, open and completed task counts, latest change evidence, passing proof, diagnostics, and decisions; and produces one handoff sentence that can survive OpenCode restart, compaction, CLI inspection, or dashboard reload. This is how Runesmith internalizes the useful continuity discipline of workflow systems without asking users to install or invoke a separate process.

Proof Plan sits above Mission Memory as the automatic verification recipe. It detects missing `test-result` proof, stale passing proof, and failed diagnostics. It reruns the latest failing command first during repair, reruns the last stale targeted proof command after newer edits invalidate it, then asks for the repository's typecheck, lint, test, and build scripts when those scripts exist. The plan is derived from runtime state and package metadata, so users get one install-once orchestration loop instead of a separate checklist they need to remember.

Proof Runner executes the active recipe. It is harness-independent in `packages/core`: callers provide a command runner, evidence ids, and a clock, while the core runner converts command outcomes into task evidence. OpenCode, CLI, and dashboard surfaces use that same runner, so a proof run from chat, the terminal, or the control surface writes the same ledger evidence.

Runesmith Next sits above the Runebook and dispatches the active procedure card without exposing the internal command tree to the user. `Capture proof` and `Repair diagnostic` cards execute Proof Runner, `Resolve risk` cards hold until a decision summary is supplied and then record decision evidence, recovery cards reclaim stale work, and ordinary advance cards reuse the shared Runic mission loop. This is the core product lesson borrowed from workflow skill systems but made native: the discipline is explicit, while the interaction stays install-once and engine-owned.

Runeweave sits above Runesmith Next as the full OS run loop. It repeatedly executes engine-owned cards with a maximum step budget, aggregates proof commands, and returns a final status and stop reason. It is allowed to handle recovery, proof, risk decisions when supplied, Review, Seal, and task claiming. It deliberately stops at `Continue forge` because scoped implementation edits are creative work for the coding agent, not a fake state transition. This gives users one magical command while keeping the runtime honest about what it can prove.

The default Covenant task plan is:

- Forge: implementation work requiring `file-change` and passing `test-result` evidence.
- Review: dependent review work requiring `decision` evidence, generated automatically when verified Forge proof exists.
- Seal: dependent checkpoint and handoff work requiring `decision` evidence, generated automatically after Review completes.

### Runesmith Autopilot

Runesmith Autopilot is the install-once bridge between OpenCode chat and the runtime. The system transform hook tells the coding agent to prepare a mission when a real coding goal appears. The `runesmith_autopilot_prepare` tool then:

- Infers the goal from the explicit tool argument or latest user message.
- Reuses a matching active mission instead of creating duplicate work.
- Creates the default Covenant task graph when starting a new mission.
- Claims the next dependency-ready task with the default Atlas contract and a stable idempotency key.
- Persists the runtime capsule after mission creation and claim.
- Returns mission, task, lease, replay, and agent metadata for subsequent evidence and completion calls.

The same preparation semantics live in core as Runesmith Mission Ignition. OpenCode Autopilot and the CLI use that shared primitive so package install, terminal `ignite`, tool hooks, and idle orchestration all create or resume missions with the same goal matching, task selection, lease idempotency, and Covenant task graph.

For zero-touch operation, the adapter also uses `tool.execute.before`. When the first mutating or shell tool is about to run, and no active task exists, Runesmith infers the latest user goal from message context and runs the same prepare path. OpenCode `session.idle` events use that same preparation path when no mission exists and chat context is present, so the orchestration loop can start before the first file or shell action. Read-only tools and Runesmith's own tools are ignored to avoid creating noisy missions.

After a mission is prepared, the `tool.execute.after` hook records routine proof automatically. Shell commands become `command-output` evidence, recognized passing test commands become `test-result` evidence, failed test commands become `diagnostic` evidence, and file mutation tools become `file-change` evidence on the active non-terminal task. After recording evidence, the hook runs the evidence-gated advance loop so a task can seal immediately when the required proof exists. The core gate treats passing test proof as stale when a newer file-change or diagnostic exists, forcing proof to follow the latest edit or repair target. The same gate treats unresolved risk evidence as a decision hold, forcing an explicit later decision before completion. If the mission has another dependency-ready task, autopilot claims it immediately so the agent continues the loop instead of stopping after implementation proof. Covenant Review and Seal stages synthesize `decision` evidence from the verified mission state, allowing routine missions to finish without the user invoking workflow tools. Runesmith ignores read-only tools and its own tools to avoid noisy ledgers and feedback loops.

The `runesmith_os_run` tool is the preferred OpenCode tool for routine progress. It runs Runeweave until the current mission is sealed or until a real stop condition appears. The `runesmith_next` tool remains available for a single bounded card execution: it reads the active Runebook card and delegates to Proof Runner, recovery, risk decision application, or the shared mission loop as needed. The `runesmith_autopilot_tick` tool remains available as an explicit low-level advance control: it checks the active task's assigned contract and task-level evidence requirements. If required evidence is missing, it holds with a missing-evidence list. If failed verification is present, the tool response includes diagnostic summaries plus the live `Repair diagnostic` Loop Pulse so OpenCode can repair without a separate user-invoked workflow. If unresolved risk is present, the tool response includes the live `Resolve risk` Loop Pulse and refuses completion until later decision evidence exists. The `runesmith_risk_resolve` tool records that decision directly, then advances the mission loop so the agent does not need to ask the user for raw evidence plumbing. If proof is present, the tick calls the runtime completion gate, synthesizes safe Covenant decisions for Review and Seal, claims the next dependency-ready task when one exists, and persists the capsule.

The adapter also injects a compact `<RUNESMITH_BOOTSTRAP>` block into the first OpenCode user message through `experimental.chat.messages.transform`. This borrows the useful OpenCode plugin lesson that message transforms can be a lower-bloat bootstrap channel than repeatedly expanding system messages. Runesmith keeps it native: the block only states that the OS is installed, names the current Loop Pulse next action and active protocol, and tells the agent not to ask the user to load skills or invoke workflows by name.

The OpenCode `config` hook registers the bundled `.opencode/skills` directory so OpenCode can discover a terse Runesmith OS reference when installation or protocol behavior needs explanation. This is fallback documentation, not the primary workflow path. The primary path remains engine-owned: Loop Pulse selects the next action, Protocol Deck selects the method, Runebook selects the executable card, and tools mutate the runtime capsule.

OpenCode `session.idle` events run the same Runeweave OS loop exposed by `runesmith_os_run`. Idle can prepare the first mission from chat context, recover stale work, run eligible Proof Plan commands, advance through Review and Seal, and write a `runeweave.stopped` mission event that includes mode, status, stop reason, final action, proof status, and command summaries. A failed proof run becomes diagnostic evidence and stops the run. Runesmith will not repeat the same failed proof on every idle event; it waits until a later file-change evidence entry shows that the agent made a repair edit, then reruns the focused diagnostic command before broader proof. This keeps the user experience install-once while preventing noisy retry loops.

OpenCode shell telemetry uses the same proof matrix. Passing test, typecheck, lint, and build commands are recorded as `test-result` evidence; failing verification commands are recorded as `diagnostic` evidence. Non-verification shell commands remain `command-output`. This lets normal OpenCode work satisfy Runesmith's proof gate without asking the user or agent to attach raw evidence by hand.

The tick logic is implemented once in the core Runic mission loop and reused by OpenCode, `runesmith mission tick`, and dashboard runtime controls. Surface adapters only provide holder identity, idempotency scope, persistence, and response formatting.

Before an idle or explicit autopilot tick checks proof, it runs the recovery policy in reclaim mode. A running task with an expired heartbeat is marked stale, dependency-ready stale work is requeued with stale ownership cleared, and the adapter claims a fresh lease for the task. Tool-execution evidence hooks skip this recovery pass so proof captured from a long-running command can complete the task instead of being treated as silence.

The compaction hook appends a mission capsule summary containing active missions, tasks, leases, and evidence counts. This gives continuation sessions enough orchestration state to recover or keep working before starting a new loop.

The same compaction path appends the live Runesmith Control Brief, Loop Pulse, Mission Map, Scope Sentinel, Review Lens, Seal Audit, Runebook, Mission Memory, and Proof Plan, so resumed sessions keep the next stage, procedure card, scope guard, proof obligations, completion gate, exact verification commands, and handoff without requiring the user to install or invoke an external workflow.

### Recovery Policies

Recovery policies are pure functions that inspect graph state and events.

Initial policies:

- A running task with no event heartbeat past its stale threshold becomes `stale`.
- A stale task whose dependencies are complete becomes `queued` for reassignment; stale ownership is cleared and the next lease claim validates the agent contract before work resumes.
- A completion attempt without required evidence is rejected and moves the task to `verifying`.
- A duplicate prompt attempt with the same idempotency key returns the existing lease.

## OpenCode Adapter Tools

The first adapter exposes these tools:

- `runesmith_autopilot_prepare`: infer or accept the current goal, start or resume a mission, claim the next dependency-ready task, and persist the capsule.
- `runesmith_os_run`: run Runeweave until the active mission is sealed or stopped by implementation work, failed proof, unresolved risk, blocker, idle state, or safety limit.
- `runesmith_next`: run the active Runebook card through proof execution, repair proof, recovery, supplied risk decision, or normal loop advancement.
- `runesmith_autopilot_tick`: advance the active task through the evidence gate, surface repair diagnostics when verification failed, and complete it when the contract is satisfied.
- `runesmith_proof_run`: execute the active Proof Plan inside OpenCode, record passing commands as `test-result` evidence, record failing commands as `diagnostic` evidence, and advance the shared mission loop when proof passes.
- `runesmith_risk_resolve`: record accepted or cleared decision evidence for the active unresolved risk and advance the shared mission loop.
- `runesmith_covenant_status`: report the installed autonomous workflow plus the live Control Brief, Loop Pulse, Mission Map, Scope Sentinel, Review Lens, Seal Audit, Runebook card, Proof Plan, and active runes from runtime state.
- `runesmith_mission_start`: create a mission from a user goal.
- `runesmith_mission_status`: summarize graph state.
- `runesmith_task_claim`: claim a task with an agent contract.
- `runesmith_task_evidence`: attach evidence to a task.
- `runesmith_task_complete`: attempt task completion with evidence validation.
- `runesmith_recover`: run recovery policies and return suggested actions.

The adapter must not complete tasks directly. It delegates all state transitions to `packages/core`.

The adapter also exposes documented OpenCode hooks:

- `experimental.chat.system.transform`: injects the Runic Covenant and Runesmith Autopilot bootstrap.
- `experimental.session.compacting`: appends the current mission capsule summary, live Control Brief, Loop Pulse, Mission Map, Scope Sentinel, Review Lens, Seal Audit, Runebook, Protocol Deck, Mission Memory, and Proof Plan to compaction context.
- `tool.execute.before`: starts or resumes orchestration before mutating/shell tools run when no active task exists.
- `tool.execute.after`: records useful command, test, and file-change evidence against the active Runesmith task, then runs the evidence-gated advance loop.
- `event`: runs Runeweave on `session.idle` events: prepare the first mission from chat context when no active mission exists, recover stale work first, run eligible Proof Plan commands, hold failed proof until a repair edit appears, advance through Review and Seal, and record the OS stop reason.

## Dashboard Direction

The dashboard uses OpenClaw OS as a product reference: a structured workspace for agents, sessions, artifacts, apps, visibility, and control. Runesmith adapts that idea to coding missions.

Primary layout:

- Left sidebar: missions, agents, policies, snapshots.
- Main canvas: mission graph lanes and active task cards.
- Right inspector: selected task details, evidence, leases, recovery state.
- Bottom timeline: tool calls, prompts, checks, and state transitions.

Runtime-backed controls:

- `/api/runtime-capsule` reads the local runtime capsule.
- `/api/runtime-control` accepts dashboard actions and persists the resulting capsule.
- Command Forge starts a planned Covenant mission from the dashboard directive, records the durable mission map trace, registers the default Atlas contract, claims the first task, and saves the capsule.
- Run OS executes Runeweave through the same router used by OpenCode and CLI, making the primary dashboard action prove, repair, recover, resolve supplied risk decisions, advance, and seal until a stop condition is reached.
- Run Next executes only the active Runebook card when a single bounded step is needed.
- Run Proof executes the active Proof Plan on the server side, persists `test-result` or `diagnostic` evidence, and advances the mission loop when the run passes.
- Resolve Risk records accepted decision evidence for the active `Resolve risk` Loop Pulse state and persists the advanced capsule.
- Guarded Autopilot runs an evidence-gated cycle over the persisted mission. It recovers stale work first, holds if proof is missing, holds unresolved risk until a later decision exists, completes through the runtime gate once required evidence exists, synthesizes Review and Seal decisions, and claims the next dependency-ready task.
- The right rail shows the Loop Pulse with health, priority, next action, execution plan, Mission Map, Scope Sentinel, Review Lens, Seal Audit, missing evidence, active runes, active Runebook card, Mission Memory, and Proof Plan commands from the same runtime capsule used by OpenCode.

Visual rules:

- shadcn/ui components for buttons, cards, badges, tabs, scroll areas, separators, tooltips, and shell controls.
- Dense but readable operational UI.
- No marketing hero.
- No decorative gradient-orb background.
- 8px or lower card radius unless shadcn defaults require otherwise.
- Buttons use icons where the action is familiar.

## Testing Strategy

Core behavior is test-first.

Required first-slice tests:

- Mission creation creates a root graph and initial queued task.
- Lease acquisition blocks competing active leases for the same target and purpose.
- Lease acquisition with the same idempotency key returns the original lease.
- Agent contract validation rejects missing capabilities.
- Task completion without required evidence is rejected.
- Task completion with required evidence succeeds.
- Recovery marks stale tasks when heartbeats expire.
- Tool routing only returns tools allowed by contract and context.
- OpenCode adapter tool calls mutate state only through the core runtime.
- Dashboard renders mission, task, evidence, and recovery seeded data without layout overflow.

## Error Handling

All core operations return typed results with success or structured failure. Runtime failures include a stable code, message, and safe details object.

Core errors:

- `MISSION_NOT_FOUND`
- `TASK_NOT_FOUND`
- `LEASE_CONFLICT`
- `CONTRACT_INVALID`
- `CAPABILITY_MISSING`
- `EVIDENCE_REQUIRED`
- `INVALID_TRANSITION`
- `SNAPSHOT_INVALID`

The OpenCode adapter converts errors into readable tool responses without throwing uncaught exceptions.

## Repository Quality Bar

The repo must ship with:

- `README.md` explaining the concept and first runnable path.
- `LICENSE`.
- TypeScript strict mode.
- Bun workspace scripts.
- Unit tests.
- Build scripts.
- Lint or typecheck command.
- Example OpenCode plugin config.
- Architecture documentation.
- No copied oh-my-openagent source.

## Success Criteria

The first build is successful when:

- `bun test` passes.
- `bun run typecheck` passes.
- `bun run build` passes for all packages.
- The OpenCode adapter exports a plugin module.
- The CLI can create config and inspect seeded/saved mission state.
- The dashboard runs locally and renders the Runesmith mission control UI.
- The core runtime demonstrates leases, evidence-gated completion, stale recovery, and contract validation in tests.
