# Runesmith

Runesmith is an OpenCode orchestration OS. It turns coding work into a durable mission graph with leased execution, typed agent contracts, evidence-gated completion, recovery policies, an agent mesh, and a production control surface.

The goal is not to add another prompt pack or make users manually run a workflow. Runesmith gives OpenCode a small operating system for agentic work:

- Missions are explicit graphs instead of transcript-only state.
- Agents need contracts before they can claim tasks.
- Internal prompt/continuation work is protected by leases and idempotency keys.
- Tasks cannot complete without evidence.
- Recovery policies can detect stale or unsafe work before it silently disappears.
- The Runic Covenant is injected automatically so agents frame, map, claim, forge, prove, review, seal, and recover work without the user babysitting the loop.
- Runesmith Autopilot prepares a mission from the latest OpenCode user request, creates a Forge -> Review -> Seal task plan, claims the next ready task with a stable lease, and replays the same claim instead of duplicating work.
- The first mutating OpenCode tool can auto-start orchestration, so the agent does not have to remember a manual mission-start step before editing.
- Tool execution evidence is captured automatically from OpenCode shell, test, and file-edit hooks.
- Captured proof immediately triggers the evidence gate, so tasks can seal as soon as file-change evidence and passing test-result evidence satisfy the active task contract.
- Idle recovery requeues dependency-ready stale tasks, clears stale ownership, and claims a fresh lease so work can continue without a manual reset.
- Runtime state is stored in a local capsule so missions survive OpenCode restarts.
- OpenCode compaction carries the mission capsule forward so long sessions do not lose orchestration state.
- A live Runesmith Control Brief is injected from runtime state so OpenCode sees the active mission, next Covenant stage, and missing proof without user-managed workflow steps.
- A Runesmith Loop Pulse is injected beside the control brief, giving OpenCode and the dashboard one authoritative next action, health signal, priority, blockers, and active runes.
- The dashboard is an operating surface: forge directives, run guarded autopilot, boost agents, toggle policies, and seal evidence snapshots.

## Packages

- `@runesmith/core`: harness-independent mission runtime.
- `@runesmith/opencode-adapter`: OpenCode plugin tools backed by the core runtime.
- `@runesmith/cli`: local setup and mission inspection commands.
- `@runesmith/testbench`: deterministic harness simulations.
- `@runesmith/dashboard`: OpenClaw OS-inspired mission control surface using shadcn/ui-style components.

## Runic Covenant

Runic Covenant is Runesmith's native agentic workflow layer. It learns from the useful idea of disciplined agent workflows, but it is not an external dependency and users do not need to invoke separate skills by hand.

Once the OpenCode plugin is installed, Runesmith injects the Covenant into the coding session and exposes a `runesmith_covenant_status` tool. The loop is:

1. Mission Frame
2. Mission Map
3. Lease Claim
4. Forge
5. Proof Gate
6. Mirror Review
7. Seal
8. Recovery Sweep

Each stage has gates and evidence requirements. The point is simple: install once, then let the engine drive end-to-end work through leases, proof, review, snapshots, and recovery.

The static Covenant is paired with a live `Runesmith Control Brief`. That brief is derived from the runtime capsule and tells the agent the active mission, active task, next Covenant stage, required evidence, and missing evidence. Failed or unknown test runs stay diagnostic and keep the next stage at Proof Gate until passing proof exists.

The Control Brief also carries active Runebook runes. These are Runesmith-native procedure cards such as `Forge Trace`, `Proofwright`, and `Recovery Loom`. They apply the useful discipline of workflow skills without making the user install, remember, or invoke separate workflows.

The Loop Pulse is the runtime's heartbeat for agentic work. It derives the next OS action from the same mission capsule, including `Wait for goal`, `Continue forge`, `Capture proof`, `Recover stale work`, `Review change`, and `Seal mission`. This keeps OpenCode prompts, compaction context, and dashboard status aligned around one loop decision instead of separate prompt-side heuristics.

Runesmith Autopilot is the OpenCode-facing part of that loop. The plugin injects a short bootstrap that tells the coding agent to call `runesmith_autopilot_prepare` when a real coding goal appears. That tool reads the latest user message when no explicit goal is provided, starts or resumes the matching active mission, creates the default Covenant task graph, claims the next ready task through the lease scheduler, and saves the runtime capsule.

If the agent reaches for a mutating or shell tool before explicitly calling `runesmith_autopilot_prepare`, Runesmith uses `tool.execute.before` to infer the latest user goal, start or resume the mission, and claim the first dependency-ready task. Read-only tools are ignored so repo inspection does not create noisy missions.

After that, Runesmith listens to OpenCode tool execution. Shell commands become `command-output` evidence, passing test commands become `test-result` evidence, failed test commands become `diagnostic` evidence, and file-edit tools become `file-change` evidence on the active task. Each captured evidence event runs the same evidence-gated advance loop, so a task can complete immediately after the required proof appears. When a planned task completes, Runesmith claims the next dependency-ready task automatically. Covenant Review and Seal synthesize their own `decision` evidence from the verified mission state, so routine missions can finish end to end; manual evidence calls remain available for risks, diagnostics, screenshots, external proof, or decisions the tool hooks cannot infer.

When OpenCode reaches an idle point, Runesmith runs an autopilot tick. The tick first runs recovery: an expired running task becomes stale, dependency-ready stale work is requeued, stale ownership is cleared, and Runesmith claims a fresh lease for the task. If the active task still lacks required evidence, the tick holds and reports the missing proof. Once the task contract is satisfied, the tick completes the task through the runtime gate, synthesizes Covenant Review and Seal decisions when safe, claims the next dependency-ready task when one exists, and persists the updated capsule.

## Orchestration OS Surface

The dashboard is intentionally not a static report. It models the working loop an OpenCode harness needs:

- **Mission board**: lane-based tasks with evidence, leases, status transitions, and a selected-task inspector.
- **Command forge**: turn a new directive into a tracked mission task.
- **Autopilot cycle**: recover stale work first, then verify running work under policy.
- **Runic Covenant**: inspect and advance the built-in autonomous coding loop that ships with the plugin.
- **Agent mesh**: inspect agent capacity, active leases, queues, model policy, and boost an agent.
- **Policy gates**: toggle evidence, lease, tool-scope, stall-radar, and human-hold guardrails.
- **Snapshots**: seal replayable mission checkpoints with task, evidence, and readiness counts.

When the local dev dashboard is running, it reads the same runtime capsule through `/api/runtime-capsule` and falls back to seeded data only when no capsule exists yet.

The command forge and guarded autopilot controls call `/api/runtime-control`, mutate the same `.runesmith/runtime/capsule.json` used by OpenCode, and reload the dashboard from the saved capsule. If the control API is unavailable, the UI falls back to the local model so demos still work.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

Bootstrap the local Runesmith OS in one command:

```bash
bun packages/cli/src/index.ts up
```

That creates `.runesmith/config.json`, installs the local OpenCode plugin shim, and creates `.runesmith/runtime/capsule.json` if it does not exist.

Verify the installation:

```bash
bun packages/cli/src/index.ts doctor
```

`doctor` validates the project config, runtime capsule, OpenCode plugin shim, and an internal Forge -> Review -> Seal orchestration smoke test. It exits nonzero when install files are missing or invalid and prints the next command to repair the setup.

Run the dashboard:

```bash
bun run dev:dashboard
```

Inspect persisted missions:

```bash
bun packages/cli/src/index.ts mission start "Build direct CLI orchestration"
bun packages/cli/src/index.ts mission list
bun packages/cli/src/index.ts mission inspect <mission-id>
```

`mission start` creates the same default Forge -> Review -> Seal Covenant graph used by OpenCode and the dashboard, registers the Atlas contract, claims the first task with a lease, and saves `.runesmith/runtime/capsule.json`.

`mission inspect` prints the mission status, Loop Pulse next action, required and missing evidence, active runes, task list, evidence ledger entries, and active leases for that mission.

Runesmith stores the default runtime capsule at `.runesmith/runtime/capsule.json`. The CLI still accepts `--snapshot <path>` for explicit exports, but normal usage does not require it.

## OpenCode

Runesmith supports two install paths:

```bash
# Recommended local development bootstrap. This initializes config, installs
# OpenCode, and creates the runtime capsule used by the plugin and dashboard.
bun packages/cli/src/index.ts up

# Local development install. This writes a generated plugin shim to the
# OpenCode global plugin directory and points it at this checkout.
# The Runic Covenant bootstrap and runtime capsule persistence are included automatically.
bun packages/cli/src/index.ts install

# Npm-style install, matching the OpenCode `plugin` array flow.
bun packages/cli/src/index.ts install --mode npm
bun packages/cli/src/index.ts doctor --mode npm
```

For a project-local install:

```bash
bun packages/cli/src/index.ts install --plugin-dir .opencode/plugins
bun packages/cli/src/index.ts doctor --plugin-dir .opencode/plugins
```

OpenCode loads local plugins from `.opencode/plugins/` and `~/.config/opencode/plugins/` automatically. Npm plugins are added to the `plugin` array in `opencode.json`. See `examples/opencode/runesmith-plugin.json` for the npm-style config shape.

Once installed and OpenCode is restarted, users do not need to invoke a workflow manually. The plugin registers:

- `experimental.chat.system.transform`: injects the Runic Covenant and Runesmith Autopilot bootstrap.
- `experimental.session.compacting`: appends the current mission capsule, Control Brief, and Loop Pulse to compaction context.
- `tool.execute.before`: auto-prepares and claims a mission before the first mutating/shell tool when message context is available.
- `tool.execute.after`: records useful shell, test, and file-change evidence, then runs the evidence-gated advance loop.
- `event`: recovers stale work and advances the active mission on `session.idle` when evidence gates are satisfied.
- `runesmith_autopilot_prepare`: starts or resumes the active mission from the latest user goal and claims the next ready Covenant task.
- `runesmith_autopilot_tick`: manually run the same evidence-gated advance loop.
- `runesmith_covenant_status`: returns the installed Covenant, live Control Brief, Loop Pulse, and active Runebook runes from the runtime capsule.
- Mission tools for status, claim, evidence, completion, and recovery.
