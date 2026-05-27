# Runesmith

Runesmith is an OpenCode orchestration OS. It turns coding work into a durable mission graph with leased execution, typed agent contracts, evidence-gated completion, recovery policies, an agent mesh, and a production control surface.

The goal is not to add another prompt pack or make users manually run a workflow. Runesmith gives OpenCode a small operating system for agentic work:

- Missions are explicit graphs instead of transcript-only state.
- Agents need contracts before they can claim tasks.
- Internal prompt/continuation work is protected by leases and idempotency keys.
- Tasks cannot complete without evidence.
- Recovery policies can detect stale or unsafe work before it silently disappears.
- The Runic Covenant is injected automatically so agents frame, map, claim, forge, prove, repair, review, seal, and recover work without the user babysitting the loop.
- Runesmith Autopilot prepares a mission from the latest OpenCode user request, creates a Forge -> Review -> Seal task plan, claims the next ready task with a stable lease, and replays the same claim instead of duplicating work.
- The first mutating OpenCode tool can auto-start orchestration, so the agent does not have to remember a manual mission-start step before editing.
- Tool execution evidence is captured automatically from OpenCode shell, test, and file-edit hooks.
- Evidence is validated against real mission tasks and refreshes task heartbeat state, so recovery does not reclaim active work just because the agent is producing proof instead of chat.
- Captured proof immediately triggers the evidence gate, so tasks can seal as soon as file-change evidence and passing test-result evidence satisfy the active task contract.
- Failed verification enters Repair Gate with the `Faultwright` rune, turning diagnostic output into a focused repair target before another proof attempt.
- The Runic mission loop is a shared core kernel used by OpenCode, the CLI, and the dashboard, so recovery, decision synthesis, task claiming, and evidence gates cannot drift between surfaces.
- Idle recovery requeues dependency-ready stale tasks, clears stale ownership, and claims a fresh lease so work can continue without a manual reset.
- Runtime state is stored in a local capsule so missions survive OpenCode restarts.
- OpenCode compaction carries the mission capsule forward so long sessions do not lose orchestration state.
- A live Runesmith Control Brief is injected from runtime state so OpenCode sees the active mission, next Covenant stage, and missing proof without user-managed workflow steps.
- A Runesmith Loop Pulse is injected beside the control brief, giving OpenCode and the dashboard one authoritative next action, execution plan, health signal, priority, blockers, and active runes.
- Runesmith Mission Memory condenses the current mission, active task, proof state, latest diagnostics, decisions, and continuation handoff so restarts, compaction, CLI checks, and the dashboard all preserve the same next move.
- Runesmith Proof Plan turns missing proof or failed diagnostics into concrete verification commands, so agents can rerun the failing command, typecheck, test, and build without the user remembering a workflow ritual.
- Runesmith Proof Runner can execute those Proof Plan commands, capture passing `test-result` evidence or failing `diagnostic` evidence, and advance the mission through the same evidence gate.
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
6. Repair Gate
7. Mirror Review
8. Seal
9. Recovery Sweep

Each stage has gates and evidence requirements. The point is simple: install once, then let the engine drive end-to-end work through leases, proof, review, snapshots, and recovery.

The static Covenant is paired with a live `Runesmith Control Brief`. That brief is derived from the runtime capsule and tells the agent the active mission, active task, next Covenant stage, required evidence, and missing evidence. Failed or unknown test runs stay diagnostic, enter Repair Gate, and keep the loop focused on the latest failing command until passing proof exists.

The Control Brief also carries active Runebook runes. These are Runesmith-native procedure cards such as `Forge Trace`, `Proofwright`, `Faultwright`, and `Recovery Loom`. They apply the useful discipline of workflow skills without making the user install, remember, or invoke separate workflows.

The Loop Pulse is the runtime's heartbeat for agentic work. It derives the next OS action from the same mission capsule, including `Wait for goal`, `Continue forge`, `Capture proof`, `Repair diagnostic`, `Recover stale work`, `Review change`, and `Seal mission`. It also expands that action into a small execution plan with active, queued, and blocked steps, required evidence, and active runes. This keeps OpenCode prompts, compaction context, CLI status, and dashboard status aligned around one loop decision instead of separate prompt-side heuristics.

Mission Memory is the durable handoff layer above the pulse. It summarizes whether the mission is idle, active, blocked, waiting for proof, focused on repair, recovering, or sealed; carries latest file-change, diagnostic, test-result, and decision evidence; and writes a single continuation sentence for the agent and operator. This is the Runesmith-owned version of workflow continuity: the user does not install a separate skill pack or remember process steps, because the engine derives the handoff from runtime state.

Proof Plan is the command layer above Mission Memory. It detects when the active task is missing passing `test-result` proof or has a failed diagnostic, then emits the next verification recipe: rerun the latest failing command first, then run the repo's typecheck, test, and build scripts when available. OpenCode prompt injection, compaction, CLI status, CLI mission inspect, and the dashboard all read the same plan.

Proof Runner executes that recipe when OpenCode, the CLI, or the dashboard asks Runesmith to prove the active task. Passing commands become `test-result` evidence; failed commands become `diagnostic` evidence and stop the run so Repair Gate stays focused on the first failing proof. A passing proof run immediately calls the shared mission loop, so verified work can advance without a manual evidence command.

Runesmith Autopilot is the OpenCode-facing part of that loop. The plugin injects a short bootstrap that tells the coding agent to call `runesmith_autopilot_prepare` when a real coding goal appears. That tool reads the latest user message when no explicit goal is provided, starts or resumes the matching active mission, creates the default Covenant task graph, claims the next ready task through the lease scheduler, and saves the runtime capsule.

If the agent reaches for a mutating or shell tool before explicitly calling `runesmith_autopilot_prepare`, Runesmith uses `tool.execute.before` to infer the latest user goal, start or resume the mission, and claim the first dependency-ready task. Read-only tools are ignored so repo inspection does not create noisy missions.

After that, Runesmith listens to OpenCode tool execution. Shell commands become `command-output` evidence, passing test commands become `test-result` evidence, failed test commands become `diagnostic` evidence, and file-edit tools become `file-change` evidence on the active task. Each captured evidence event runs the same evidence-gated advance loop, so a task can complete immediately after the required proof appears. When a planned task completes, Runesmith claims the next dependency-ready task automatically. Covenant Review and Seal synthesize their own `decision` evidence from the verified mission state, so routine missions can finish end to end; manual evidence calls remain available for risks, diagnostics, screenshots, external proof, or decisions the tool hooks cannot infer.

When OpenCode reaches an idle point, Runesmith runs an autopilot tick. The tick first runs recovery: an expired running task becomes stale, dependency-ready stale work is requeued, stale ownership is cleared, and Runesmith claims a fresh lease for the task. If the active task still lacks required evidence, the tick holds and reports the missing proof. If failed verification is present, the tick also returns diagnostic summaries and a `Repair diagnostic` Loop Pulse so the agent knows what to fix next. Once the task contract is satisfied, the tick completes the task through the runtime gate, synthesizes Covenant Review and Seal decisions when safe, claims the next dependency-ready task when one exists, and persists the updated capsule.

That same advance loop lives in `@runesmith/core` and is reused by the OpenCode plugin, `runesmith mission tick`, and the dashboard control plane. Each surface can provide its own holder name and idempotency scope, but the state machine is shared.

## Orchestration OS Surface

The dashboard is intentionally not a static report. It models the working loop an OpenCode harness needs:

- **Mission board**: lane-based tasks with evidence, leases, status transitions, and a selected-task inspector.
- **Command forge**: turn a new directive into a tracked mission task.
- **Autopilot cycle**: recover stale work first, then verify running work under policy.
- **Runic Covenant**: inspect and advance the built-in autonomous coding loop that ships with the plugin.
- **Mission Memory**: see the durable handoff, proof state, latest diagnostic, and sealed mission status without reading the transcript.
- **Proof Plan**: see the exact verification commands Runesmith wants next, including focused diagnostic reruns before broad proof.
- **Proof Runner**: run the active proof plan from the dashboard and persist the resulting proof or diagnostic evidence.
- **Agent mesh**: inspect agent capacity, active leases, queues, model policy, and boost an agent.
- **Policy gates**: toggle evidence, lease, tool-scope, stall-radar, and human-hold guardrails.
- **Snapshots**: seal replayable mission checkpoints with task, evidence, and readiness counts.

When the local dev dashboard is running, it reads the same runtime capsule through `/api/runtime-capsule` and falls back to seeded data only when no capsule exists yet.

The command forge and guarded autopilot controls call `/api/runtime-control`, mutate the same `.runesmith/runtime/capsule.json` used by OpenCode, and reload the dashboard from the saved capsule. If the control API is unavailable, the UI falls back to the local model so demos still work.

## Direct OpenCode Install

For OpenCode users, the direct path is a single plugin entry:

```json
{
  "plugin": ["runesmith@git+https://github.com/pasmud/runesmith.git"]
}
```

Add it to your global or project `opencode.json`, restart OpenCode, and let OpenCode install the package at startup. The repo root exports the Runesmith OpenCode plugin, runs the package build during git-package preparation, and loads the same Runic Covenant, Control Brief, Loop Pulse, tool hooks, runtime capsule, and evidence-gated autopilot described above.

This is the Runesmith-native version of the useful Superpowers install lesson: one line for the user, automatic behavior inside the harness. Users should not need to manually load skills, invoke workflows, or remember process names for normal coding work.

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

That creates `.runesmith/config.json`, installs the local OpenCode plugin shim, and creates `.runesmith/runtime/capsule.json` if it does not exist. It also checks whether the `opencode` command is available. When OpenCode is not on PATH, `up` reports the OS as staged instead of ready and tells you to install OpenCode before launch.

Verify the installation:

```bash
bun packages/cli/src/index.ts doctor
```

`doctor` validates the project config, runtime capsule, OpenCode CLI command, OpenCode plugin shim, and an internal Forge -> Review -> Seal orchestration smoke test. It exits nonzero when install files are missing or invalid, or when `opencode` is not discoverable, and prints the next command to repair the setup.

Check the operating loop without learning the mission subcommands:

```bash
bun packages/cli/src/index.ts status
```

`status` prints the Runesmith install state, OpenCode CLI readiness, Loop Pulse next action, execution plan, active mission and task, missing evidence, diagnostics, active runes, and Proof Plan commands from the runtime capsule. It also stays useful before bootstrap by showing the idle engine state and the next launch/dashboard commands.

Run the active proof plan and let Runesmith write evidence:

```bash
bun packages/cli/src/index.ts prove
```

`prove` reads the runtime capsule, runs the active Proof Plan commands, records each passing command as `test-result` evidence, records the first failing command as `diagnostic` evidence, saves the capsule, and advances the shared mission loop when proof passes.

Launch OpenCode through Runesmith after bootstrap:

```bash
bun packages/cli/src/index.ts launch -- <opencode args>
```

`launch` runs the same bootstrap path as `up`, refuses to continue when the `opencode` command is missing, then hands off to OpenCode. Arguments after `--` are passed directly to OpenCode.

Run the dashboard:

```bash
bun run dev:dashboard
```

Inspect persisted missions:

```bash
bun packages/cli/src/index.ts mission start "Build direct CLI orchestration"
bun packages/cli/src/index.ts mission evidence mission_cli_1 task_cli_1 --type file-change --summary "Changed files"
bun packages/cli/src/index.ts mission evidence mission_cli_1 task_cli_1 --type test-result --summary "Tests passed" --payload-json "{\"exitCode\":0}"
bun packages/cli/src/index.ts mission tick
bun packages/cli/src/index.ts mission list
bun packages/cli/src/index.ts mission inspect <mission-id>
```

`mission start` creates the same default Forge -> Review -> Seal Covenant graph used by OpenCode and the dashboard, registers the Atlas contract, claims the first task with a lease, and saves `.runesmith/runtime/capsule.json`.

`mission evidence` records proof on a task, and `mission tick` advances the persisted capsule through the same evidence gate used by OpenCode. When diagnostics are attached, both commands print the active repair summary so the next action is visible at the terminal. When Forge proof is satisfied, the tick can complete Forge, synthesize safe Review and Seal decisions, and finish the mission.

`mission inspect` prints the mission status, Loop Pulse next action, Proof Plan commands, required and missing evidence, active diagnostics, active runes, task list, evidence ledger entries, and active leases for that mission.

Runesmith stores the default runtime capsule at `.runesmith/runtime/capsule.json`. The CLI still accepts `--snapshot <path>` for explicit exports, but normal usage does not require it.

## OpenCode

Runesmith supports two install paths:

```bash
# Recommended local development bootstrap. This initializes config, installs
# the Runesmith OpenCode plugin shim, and creates the runtime capsule used by
# the plugin and dashboard. It verifies that the opencode command exists.
bun packages/cli/src/index.ts up

# One-command handoff. This performs the same bootstrap/readiness work and then
# runs OpenCode, passing everything after `--` to the OpenCode CLI.
bun packages/cli/src/index.ts launch -- <opencode args>

# Local development install. This writes a generated plugin shim to the
# OpenCode global plugin directory and points it at this checkout.
# The Runic Covenant bootstrap and runtime capsule persistence are included automatically.
bun packages/cli/src/index.ts install

# OpenCode package install, matching the `plugin` array flow.
bun packages/cli/src/index.ts install --mode npm
bun packages/cli/src/index.ts doctor --mode npm
```

For a project-local install:

```bash
bun packages/cli/src/index.ts install --plugin-dir .opencode/plugins
bun packages/cli/src/index.ts doctor --plugin-dir .opencode/plugins
```

OpenCode itself must be installed separately so `opencode` resolves on PATH. Runesmith handles its own project config, runtime capsule, and plugin wiring; `doctor` confirms that the host OpenCode CLI is present before reporting ready. OpenCode loads local plugins from `.opencode/plugins/` and `~/.config/opencode/plugins/` automatically. Package plugins are added to the `plugin` array in `opencode.json`; by default Runesmith writes `runesmith@git+https://github.com/pasmud/runesmith.git`. See `examples/opencode/runesmith-plugin.json` for the direct package config shape.

Once installed and OpenCode is restarted, users do not need to invoke a workflow manually. The plugin registers:

- `experimental.chat.system.transform`: injects the Runic Covenant and Runesmith Autopilot bootstrap.
- `experimental.session.compacting`: appends the current mission capsule, Control Brief, Loop Pulse, Mission Memory, and Proof Plan to compaction context.
- `tool.execute.before`: auto-prepares and claims a mission before the first mutating/shell tool when message context is available.
- `tool.execute.after`: records useful shell, test, and file-change evidence, then runs the evidence-gated advance loop.
- `event`: recovers stale work and advances the active mission on `session.idle` when evidence gates are satisfied.
- `runesmith_autopilot_prepare`: starts or resumes the active mission from the latest user goal and claims the next ready Covenant task.
- `runesmith_autopilot_tick`: manually run the same evidence-gated advance loop and return the live Loop Pulse and Proof Plan, including repair diagnostics when verification failed.
- `runesmith_proof_run`: execute the active Proof Plan inside OpenCode, record proof or diagnostics, and advance the mission when verification passes.
- `runesmith_covenant_status`: returns the installed Covenant, live Control Brief, Loop Pulse, Proof Plan, and active Runebook runes from the runtime capsule.
- Mission tools for status, claim, evidence, completion, and recovery.
