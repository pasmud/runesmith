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
- A native Runic Covenant workflow layer that installs automatically with the OpenCode plugin and drives frame, map, claim, forge, prove, review, seal, and recovery behavior without manual workflow invocation.
- A default runtime capsule at `.runesmith/runtime/capsule.json` so mission state survives OpenCode restarts and CLI inspection works without requiring a manual snapshot flag.
- Runesmith Autopilot hooks for OpenCode system bootstrap and compaction continuity, so the engine can prepare and resume missions without the user loading separate workflow skills.
- Zero-touch mission preparation from OpenCode `tool.execute.before` when a mutating or shell tool is about to run and no active mission exists.
- Automatic evidence capture from OpenCode tool execution events for shell commands, test runs, and file edits, followed by an immediate evidence-gated advance attempt.
- Evidence-gated autopilot ticks that can complete the active task on OpenCode idle events once proof requirements are satisfied.
- A state-aware Runesmith Control Brief that tells OpenCode the active mission, active task, next Runic Covenant stage, required evidence, and missing proof directly from runtime state.
- A Runesmith Loop Pulse that derives one authoritative next action, health signal, priority, blockers, and active runes from the runtime capsule.
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
- Serialization to and from JSON snapshots.

### `packages/opencode-adapter`

Owns OpenCode integration.

Responsibilities:

- Export an OpenCode plugin module.
- Register mission tools.
- Inject the Runic Covenant and Runesmith Autopilot through OpenCode's system transform hook.
- Inject a mission capsule summary through OpenCode's compaction hook.
- Record evidence from OpenCode tool execution hooks without requiring the agent to call evidence tools manually for routine shell, test, and file-change proof.
- Advance the active mission from idle events only through the runtime evidence gate.
- Translate OpenCode events into core runtime events.
- Use the core lease scheduler before sending any internal prompt or continuation.
- Keep OpenCode-specific types and instability out of `packages/core`.

### `packages/cli`

Owns local user commands.

Responsibilities:

- `runesmith up`: one-command bootstrap that writes project config, installs OpenCode, and creates the runtime capsule if needed.
- `runesmith init`: create project config.
- `runesmith doctor`: validate config, runtime capsule, OpenCode plugin wiring, and an internal Forge -> Review -> Seal loop smoke test; exit nonzero with an actionable repair hint when setup is incomplete.
- `runesmith mission list`: print active mission summaries from snapshots.
- `runesmith mission inspect <id>`: print graph, evidence, leases, and recovery state.

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
For `test-result` requirements, evidence must prove a passing run, such as `exitCode: 0` or an explicit success status. Failed or unknown test runs are diagnostic context, not completion proof.

### Runtime Capsule

The runtime capsule is the default durable state file for a local project. It is a versioned JSON envelope containing graphs, ledgers, leases, and contracts. OpenCode plugin mutations save the capsule after successful mission, claim, evidence, completion, and recovery operations.

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
- Mirror Review: inspect diff and behavior for gaps.
- Seal: capture a replayable checkpoint.
- Recovery Sweep: recover stale or blocked work before drift.

Every stage carries gates and evidence signals. The covenant is a workflow policy layer; the runtime remains the source of truth for mission state, leases, and evidence.

The runtime also derives a live Runesmith Control Brief from the current snapshot. This brief does not ask the user to run a skill. It tells the coding agent what stage comes next, which mission and task are active, what proof is required, and which evidence is still missing. Failed or unknown test runs are treated as diagnostics, so the brief keeps the task in Proof Gate until passing test proof exists.

The Control Brief also includes Runesmith-native Runebook runes. A rune is a small procedure card selected from runtime state, such as `Forge Trace` during scoped edits, `Proofwright` when evidence is missing, or `Recovery Loom` when work is stale. This borrows the useful discipline of explicit workflows while keeping the user experience install-once and automatic; users should not need to invoke external skills or remember process names.

The Loop Pulse sits beside the Control Brief. It converts the live runtime state into one next action such as `Wait for goal`, `Continue forge`, `Capture proof`, `Recover stale work`, `Review change`, or `Seal mission`. OpenCode prompt injection, compaction context, and the dashboard should all show this same pulse so the OS has one source of truth for what the agentic loop should do next.

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

For zero-touch operation, the adapter also uses `tool.execute.before`. When the first mutating or shell tool is about to run, and no active task exists, Runesmith infers the latest user goal from message context and runs the same prepare path. Read-only tools and Runesmith's own tools are ignored to avoid creating noisy missions.

After a mission is prepared, the `tool.execute.after` hook records routine proof automatically. Shell commands become `command-output` evidence, recognized passing test commands become `test-result` evidence, failed test commands become `diagnostic` evidence, and file mutation tools become `file-change` evidence on the active non-terminal task. After recording evidence, the hook runs the evidence-gated advance loop so a task can seal immediately when the required proof exists. If the mission has another dependency-ready task, autopilot claims it immediately so the agent continues the loop instead of stopping after implementation proof. Covenant Review and Seal stages synthesize `decision` evidence from the verified mission state, allowing routine missions to finish without the user invoking workflow tools. Runesmith ignores read-only tools and its own tools to avoid noisy ledgers and feedback loops.

The `runesmith_autopilot_tick` tool, and the same loop on OpenCode `session.idle` events, checks the active task's assigned contract and task-level evidence requirements. If required evidence is missing, it holds with a missing-evidence list. If proof is present, it calls the runtime completion gate, synthesizes safe Covenant decisions for Review and Seal, claims the next dependency-ready task when one exists, and persists the capsule. This keeps the agent loop automatic while preserving evidence-gated completion.

Before an idle or explicit autopilot tick checks proof, it runs the recovery policy in reclaim mode. A running task with an expired heartbeat is marked stale, dependency-ready stale work is requeued with stale ownership cleared, and the adapter claims a fresh lease for the task. Tool-execution evidence hooks skip this recovery pass so proof captured from a long-running command can complete the task instead of being treated as silence.

The compaction hook appends a mission capsule summary containing active missions, tasks, leases, and evidence counts. This gives continuation sessions enough orchestration state to recover or keep working before starting a new loop.

The same compaction path appends the live Runesmith Control Brief, so resumed sessions keep the next stage and proof obligations without requiring the user to install or invoke an external workflow.

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
- `runesmith_autopilot_tick`: advance the active task through the evidence gate and complete it when the contract is satisfied.
- `runesmith_covenant_status`: report the active autonomous workflow stages installed by Runesmith.
- `runesmith_mission_start`: create a mission from a user goal.
- `runesmith_mission_status`: summarize graph state.
- `runesmith_task_claim`: claim a task with an agent contract.
- `runesmith_task_evidence`: attach evidence to a task.
- `runesmith_task_complete`: attempt task completion with evidence validation.
- `runesmith_recover`: run recovery policies and return suggested actions.

The adapter must not complete tasks directly. It delegates all state transitions to `packages/core`.

The adapter also exposes documented OpenCode hooks:

- `experimental.chat.system.transform`: injects the Runic Covenant and Runesmith Autopilot bootstrap.
- `experimental.session.compacting`: appends the current mission capsule summary to compaction context.
- `tool.execute.before`: starts or resumes orchestration before mutating/shell tools run when no active task exists.
- `tool.execute.after`: records useful command, test, and file-change evidence against the active Runesmith task, then runs the evidence-gated advance loop.
- `event`: runs the autopilot tick on `session.idle` events.

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
- Command Forge starts a planned Covenant mission from the dashboard directive, registers the default Atlas contract, claims the first task, and saves the capsule.
- Guarded Autopilot runs an evidence-gated cycle over the persisted mission. It recovers stale work first, holds if proof is missing, completes through the runtime gate once required evidence exists, synthesizes Review and Seal decisions, and claims the next dependency-ready task.
- The right rail shows the Loop Pulse with health, priority, next action, missing evidence, and active runes from the same runtime capsule used by OpenCode.

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
