# Runesmith

Runesmith is an OpenCode orchestration OS. It turns coding work into a durable mission graph with leased execution, typed agent contracts, evidence-gated completion, recovery policies, an agent mesh, and a production control surface.

The goal is not to add another prompt pack or make users manually run a workflow. Runesmith gives OpenCode a small operating system for agentic work:

- Missions are explicit graphs instead of transcript-only state.
- Agents need contracts before they can claim tasks.
- Internal prompt/continuation work is protected by leases and idempotency keys.
- Tasks cannot complete without evidence.
- Recovery policies can detect stale or unsafe work before it silently disappears.
- The Runic Covenant is injected automatically so agents frame, map, claim, forge, prove, review, seal, and recover work without the user babysitting the loop.
- Runesmith Autopilot prepares a mission from the latest OpenCode user request, claims the root task with a stable lease, and replays the same claim instead of duplicating work.
- The first mutating OpenCode tool can auto-start orchestration, so the agent does not have to remember a manual mission-start step before editing.
- Tool execution evidence is captured automatically from OpenCode shell, test, and file-edit hooks.
- Captured proof immediately triggers the evidence gate, so tasks can seal as soon as file-change evidence and passing test-result evidence satisfy the agent contract.
- Runtime state is stored in a local capsule so missions survive OpenCode restarts.
- OpenCode compaction carries the mission capsule forward so long sessions do not lose orchestration state.
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

Runesmith Autopilot is the OpenCode-facing part of that loop. The plugin injects a short bootstrap that tells the coding agent to call `runesmith_autopilot_prepare` when a real coding goal appears. That tool reads the latest user message when no explicit goal is provided, starts or resumes the matching active mission, claims the mission root through the lease scheduler, and saves the runtime capsule.

If the agent reaches for a mutating or shell tool before explicitly calling `runesmith_autopilot_prepare`, Runesmith uses `tool.execute.before` to infer the latest user goal, start or resume the mission, and claim the root task first. Read-only tools are ignored so repo inspection does not create noisy missions.

After that, Runesmith listens to OpenCode tool execution. Shell commands become `command-output` evidence, passing test commands become `test-result` evidence, failed test commands become `diagnostic` evidence, and file-edit tools become `file-change` evidence on the active task. Each captured evidence event runs the same evidence-gated advance loop, so a task can complete immediately after the required proof appears. Manual evidence calls are still available for decisions, risks, diagnostics, screenshots, review notes, and proof that happens outside OpenCode tools.

When OpenCode reaches an idle point, Runesmith runs an autopilot tick. If the active task still lacks required evidence, the tick holds and reports the missing proof. Once the contract is satisfied, the tick completes the task through the runtime gate and persists the updated capsule.

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

Run the dashboard:

```bash
bun run dev:dashboard
```

Inspect persisted missions:

```bash
bun packages/cli/src/index.ts mission list
bun packages/cli/src/index.ts mission inspect <mission-id>
```

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

# Future npm-style install, matching the OpenCode `plugin` array flow.
bun packages/cli/src/index.ts install --mode npm --package runesmith@latest
```

For a project-local install:

```bash
bun packages/cli/src/index.ts install --plugin-dir .opencode/plugins
```

OpenCode loads local plugins from `.opencode/plugins/` and `~/.config/opencode/plugins/` automatically. Npm plugins are added to the `plugin` array in `opencode.json`. See `examples/opencode/runesmith-plugin.json` for the npm-style config shape.

Once installed and OpenCode is restarted, users do not need to invoke a workflow manually. The plugin registers:

- `experimental.chat.system.transform`: injects the Runic Covenant and Runesmith Autopilot bootstrap.
- `experimental.session.compacting`: appends the current mission capsule to compaction context.
- `tool.execute.before`: auto-prepares and claims a mission before the first mutating/shell tool when message context is available.
- `tool.execute.after`: records useful shell, test, and file-change evidence, then runs the evidence-gated advance loop.
- `event`: advances the active mission on `session.idle` when evidence gates are satisfied.
- `runesmith_autopilot_prepare`: starts or resumes the active mission from the latest user goal and claims its root task.
- `runesmith_autopilot_tick`: manually run the same evidence-gated advance loop.
- Mission tools for status, claim, evidence, completion, covenant status, and recovery.
