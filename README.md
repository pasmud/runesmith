# Runesmith

Runesmith is an OpenCode orchestration OS. It turns coding work into a durable mission graph with leased execution, typed agent contracts, evidence-gated completion, recovery policies, an agent mesh, and a production control surface.

The goal is not to add another prompt pack or make users manually run a workflow. Runesmith gives OpenCode a small operating system for agentic work:

- Missions are explicit graphs instead of transcript-only state.
- Agents need contracts before they can claim tasks.
- Internal prompt/continuation work is protected by leases and idempotency keys.
- Tasks cannot complete without evidence.
- Recovery policies can detect stale or unsafe work before it silently disappears.
- The Runic Covenant is injected automatically so agents frame, map, claim, forge, prove, repair, review, seal, and recover work without the user babysitting the loop.
- Runesmith Autopilot prepares a mission from the latest OpenCode user request, creates a Forge -> Review -> Seal task plan, records a durable `mission.mapped` trace, claims the next ready task with a stable lease, and replays the same claim instead of duplicating work.
- The first mutating OpenCode tool can auto-start orchestration, so the agent does not have to remember a manual mission-start step before editing.
- OpenCode idle events can also prepare the first mission from chat context, so a session can enter the orchestration loop before any file or shell tool runs.
- Tool execution evidence is captured automatically from OpenCode shell, test, and file-edit hooks.
- Evidence is validated against real mission tasks and refreshes task heartbeat state, so recovery does not reclaim active work just because the agent is producing proof instead of chat.
- Passing proof must be fresh after the latest file-change or diagnostic evidence, so an agent cannot seal new edits with stale tests from earlier in the loop.
- Unresolved `risk` evidence opens a human-hold gate: Runesmith adds a required later `decision`, surfaces `Resolve risk` as a critical action, and blocks completion until that decision clears, accepts, or holds the risk.
- Captured proof immediately triggers the evidence gate, so tasks can seal as soon as file-change evidence and passing test-result evidence satisfy the active task contract.
- Failed verification enters Repair Gate with the `Faultwright` rune, turning diagnostic output into a focused repair target before another proof attempt.
- The Runic mission loop is a shared core kernel used by OpenCode, the CLI, and the dashboard, so recovery, decision synthesis, task claiming, and evidence gates cannot drift between surfaces.
- Idle recovery requeues dependency-ready stale tasks, clears stale ownership, and claims a fresh lease so work can continue without a manual reset.
- Runtime state is stored in a local capsule so missions survive OpenCode restarts.
- OpenCode compaction carries the mission capsule forward so long sessions do not lose orchestration state.
- A live Runesmith Control Brief is injected from runtime state so OpenCode sees the active mission, next Covenant stage, and missing proof without user-managed workflow steps.
- A compact first-user-message bootstrap also carries the current Loop Pulse and active protocol, giving OpenCode a low-bloat fallback when message hooks are more reliable than repeated system prompt injection.
- The OpenCode config hook registers bundled Runesmith OS reference docs for fallback discovery, while normal coding work stays driven by Loop Pulse, Protocol Deck, Runebook, and tools instead of manual skill loading.
- A Runesmith Loop Pulse is injected beside the control brief, giving OpenCode and the dashboard one authoritative next action, execution plan, health signal, priority, blockers, and active runes.
- A Runesmith Runebook is derived from the same pulse, turning the current state into one active procedure card such as `Forge Trace implementation loop`, `Proofwright proof gate`, `Faultwright repair loop`, or `Mirrorglass risk decision`.
- The Runesmith Protocol Deck is the built-in, engine-selected workflow layer: OpenCode receives the right Runesmith protocol automatically, such as `Forge Trace Protocol`, `Proofwright Proof Protocol`, or `Faultwright Repair Protocol`, without the user invoking external skills or workflow names.
- Runesmith Mission Memory condenses the current mission, active task, proof state, latest diagnostics, decisions, and continuation handoff so restarts, compaction, CLI checks, and the dashboard all preserve the same next move.
- Runesmith Mission Map turns the persisted task/dependency/evidence graph into a live prompt, CLI, and dashboard surface, so OpenCode sees the engine-owned plan without asking the user to load workflows or choose stages.
- Runesmith Scope Sentinel checks file-change evidence against the assigned agent contract's `fileScope`, promotes out-of-scope edits into critical review findings, and keeps the same scope signal visible in OpenCode, CLI, and dashboard surfaces.
- Runesmith Review Lens turns proof, risk, and decision state into a pre-seal checklist with findings, so autonomous Review carries inspectable reasoning instead of a vague approval note.
- Runesmith Seal Audit binds proof, scope, review, and the final Sealmark decision into one completion gate, so OpenCode sees whether it may claim done, must run proof, must repair, or must resolve drift before sealing.
- Runesmith Proof Plan turns missing proof or failed diagnostics into concrete verification commands, so agents can rerun the failing command, typecheck, lint, test, and build without the user remembering a workflow ritual.
- Runesmith Proof Runner can execute those Proof Plan commands, capture passing `test-result` evidence or failing `diagnostic` evidence, and advance the mission through the same evidence gate.
- Runesmith Ignite is the least-ceremony terminal entrypoint: one command installs/configures the OpenCode package plugin, prepares or resumes the matching Covenant mission, claims the active task, and runs the OS loop once.
- Runesmith Next is the hands-off router over the Runebook: one CLI command, one OpenCode tool, and one dashboard button that proves, repairs, resolves a supplied risk decision, recovers, or advances whichever card is active.
- Runeweave is the OS run loop over Runesmith Next: one command, OpenCode tool, or dashboard button that keeps executing engine-owned Runebook cards until work is sealed or the loop reaches a real stop condition such as implementation work, failed proof, unresolved risk, or a blocker.
- OpenCode idle events run Runeweave automatically: they can prepare the first mission from chat, recover stale work, prove ready work, advance Review and Seal, and record a `runeweave.stopped` mission event with the concrete stop reason. Failed proof is held as a repair target and will not be retried until a new repair edit is captured.
- The dashboard is an operating surface: forge directives, run guarded autopilot, resolve active risks, boost agents, toggle policies, and seal evidence snapshots.

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

When Runesmith creates a planned mission, it writes a `mission.mapped` event into the runtime capsule with every Covenant task, dependency, required capability, and evidence gate. That is the Runesmith-native version of explicit agent workflows: the plan is durable, inspectable, and replayable, but it is produced by the engine instead of handed to the user as another manual checklist.

The static Covenant is paired with a live `Runesmith Control Brief`. That brief is derived from the runtime capsule and tells the agent the active mission, active task, next Covenant stage, required evidence, and missing evidence. Failed or unknown test runs stay diagnostic, enter Repair Gate, and keep the loop focused on the latest failing command until passing proof exists.

The Control Brief carries active runes, and the Runebook turns those runes into one concrete procedure card. A card includes autonomy mode (`auto`, `guarded`, or `hold`), trigger, intent, steps, required evidence, exact Proof Plan commands, OpenCode tool hints, and stop conditions. This is the Runesmith-native version of workflow skills: the user does not install, remember, or invoke process names, because the engine derives the card from the runtime capsule.

The Protocol Deck sits beside the Runebook as Runesmith's own version of agentic workflow discipline. It converts the live Loop Pulse into an engine-selected protocol with objective, procedure, verification, forbidden moves, and tool hints. It borrows the useful idea of explicit methods, but keeps the interaction install-once: OpenCode sees `Faultwright Repair Protocol` after a diagnostic, `Proofwright Proof Protocol` when implementation proof is ready, `Recovery Loom Protocol` when a lease is stale, and `Mirrorglass Risk Protocol` when a decision hold is active. The user never has to load or name a protocol.

The Loop Pulse is the runtime's heartbeat for agentic work. It derives the next OS action from the same mission capsule, including `Wait for goal`, `Continue forge`, `Capture proof`, `Repair diagnostic`, `Resolve risk`, `Recover stale work`, `Review change`, and `Seal mission`. It also expands that action into a small execution plan with active, queued, and blocked steps, required evidence, and active runes. This keeps OpenCode prompts, compaction context, CLI status, and dashboard status aligned around one loop decision instead of separate prompt-side heuristics.

Mission Memory is the durable handoff layer above the pulse. It summarizes whether the mission is idle, active, blocked, waiting for proof, focused on repair, recovering, or sealed; carries latest file-change, diagnostic, test-result, and decision evidence; and writes a single continuation sentence for the agent and operator. This is the Runesmith-owned version of workflow continuity: the user does not install a separate skill pack or remember process steps, because the engine derives the handoff from runtime state.

Proof Plan is the command layer above Mission Memory. It detects when the active task is missing passing `test-result` proof, has stale passing proof, or has a failed diagnostic, then emits the next verification recipe: rerun the latest failing command first during repair, rerun the last stale targeted proof command after newer edits, then run the repo's typecheck, lint, test, and build scripts when available. The active Runebook card embeds those commands so OpenCode prompt injection, compaction, CLI status, CLI mission inspect, and the dashboard all read the same proof recipe.

Proof Runner executes that recipe when OpenCode, the CLI, or the dashboard asks Runesmith to prove the active task. Passing commands become `test-result` evidence; failed commands become `diagnostic` evidence and stop the run so Repair Gate stays focused on the first failing proof. A passing proof run immediately calls the shared mission loop, so verified work can advance without a manual evidence command.

Runesmith Ignite sits above setup and mission commands for first use. `runesmith ignite "Ship the feature"` defaults to the direct package-plugin install path, writes or refreshes OpenCode config, creates the runtime capsule, starts or resumes the matching Covenant mission, claims the current task, and runs Runeweave once. The command is intentionally higher level than `up`, `mission start`, and `run`: new users get one useful entrypoint, while operators can still drop to lower-level controls when debugging.

Runesmith Next is the default hands-off surface above the Runebook. It reads the active card and takes the smallest safe engine-owned action: run Proof Runner for `Capture proof` and `Repair diagnostic`, apply a supplied decision for `Resolve risk`, recover stale work, claim the next dependency-ready task, or advance through Review and Seal when evidence is already present. This is the Runesmith-owned version of workflow-skill dispatch: the user runs `runesmith next`, clicks `Run next`, or lets OpenCode call `runesmith_next`; the engine chooses the lower-level operation from runtime state.

Runeweave is the default OS run loop above Runesmith Next. It repeatedly executes engine-owned Runebook cards with a safety step limit, then stops with a concrete reason: sealed, idle, needs implementation evidence, proof failed, risk held, blocked, or step limit reached. This is the boundary that keeps the product magical without faking autonomy: Runesmith handles leases, recovery, proof, decisions, Review, and Seal; the coding agent still performs creative implementation edits when the active card says `Continue forge`.

Runesmith Autopilot is the OpenCode-facing part of that loop. The plugin injects a short bootstrap that tells the coding agent to call `runesmith_autopilot_prepare` when a real coding goal appears. That tool reads the latest user message when no explicit goal is provided, starts or resumes the matching active mission, creates the default Covenant task graph with its mission map trace, claims the next ready task through the lease scheduler, and saves the runtime capsule.

If the agent reaches for a mutating or shell tool before explicitly calling `runesmith_autopilot_prepare`, Runesmith uses `tool.execute.before` to infer the latest user goal, start or resume the mission, and claim the first dependency-ready task. If OpenCode reaches `session.idle` first and includes chat messages, Runesmith uses that same prepare path from the latest user message. Read-only tools are ignored so repo inspection does not create noisy missions.

After that, Runesmith listens to OpenCode tool execution. Shell commands become `command-output` evidence, passing verification commands such as test, typecheck, lint, and build become `test-result` evidence, failing verification commands become `diagnostic` evidence, and file-edit tools become `file-change` evidence on the active task. Each captured evidence event runs the same evidence-gated advance loop, so a task can complete immediately after the required proof appears. The gate requires passing proof to be newer than the latest edit or diagnostic on that task, which keeps completion tied to the current work rather than earlier green runs. It also treats unresolved `risk` evidence as a human-hold gate that requires a later `decision`, so high-risk findings cannot be washed away by passing tests. When a planned task completes, Runesmith claims the next dependency-ready task automatically. Covenant Review and Seal synthesize their own `decision` evidence from the verified mission state, so routine missions can finish end to end; manual evidence calls remain available for risks, diagnostics, screenshots, external proof, or decisions the tool hooks cannot infer.

When OpenCode reaches an idle point, Runesmith runs Runeweave, the same OS loop exposed by `runesmith_os_run`, against the active capsule. If no mission exists and chat context contains a coding goal, idle first prepares and claims the Forge task, then lets Runeweave classify the next stop. From there the loop gives stale recovery priority, runs eligible Proof Plan commands, writes passing `test-result` evidence or failing `diagnostic` evidence, advances Review and Seal when evidence gates are satisfied, and persists a `runeweave.stopped` mission event with mode, status, stop reason, final action, proof status, and command summaries. If a proof run failed, Runesmith holds the repair target and does not rerun the failing command again until a new repair edit is captured. If unresolved risk is present, the Loop Pulse switches to `Resolve risk` and the runtime refuses completion until a later decision evidence entry exists; OpenCode can call `runesmith_next` with a risk summary or `runesmith_risk_resolve` directly so the agent does not need to ask the user for mission ids or raw evidence commands.

That same advance loop lives in `@runesmith/core` and is reused by the OpenCode plugin, `runesmith mission tick`, and the dashboard control plane. Each surface can provide its own holder name and idempotency scope, but the state machine is shared.

## Orchestration OS Surface

The dashboard is intentionally not a static report. It models the working loop an OpenCode harness needs:

- **Mission board**: lane-based tasks with evidence, leases, status transitions, and a selected-task inspector.
- **Command forge**: turn a new directive into a tracked mission task.
- **Autopilot cycle**: recover stale work first, then verify running work under policy.
- **Runic Covenant**: inspect and advance the built-in autonomous coding loop that ships with the plugin.
- **Mission Map**: inspect the engine-owned task graph, next task, dependencies, and evidence requirements from the same runtime capsule used by OpenCode.
- **Scope Sentinel**: see whether captured file changes stay inside the active agent contract's file scope before Review or Seal.
- **Review Lens**: inspect the pre-seal review checklist, proof blockers, unresolved risks, and findings derived from the same evidence ledger.
- **Seal Audit**: inspect the proof, scope, review, and final seal-decision checks that determine whether Runesmith can claim completion.
- **Mission Memory**: see the durable handoff, proof state, latest diagnostic, and sealed mission status without reading the transcript.
- **Runebook card**: see the current procedure card, autonomy mode, tool hint, evidence requirement, and exact commands Runesmith wants the agent to follow.
- **Run OS**: run Runeweave from one primary control, so the dashboard keeps executing engine-owned cards until the mission seals or a stop condition needs code, risk, repair, or operator input.
- **Run Next**: execute just the active Runebook card when the operator wants a single bounded step.
- **Proof Plan**: see the exact verification commands Runesmith wants next, including focused diagnostic reruns before broad proof.
- **Proof Runner**: run the active proof plan from the dashboard and persist the resulting proof or diagnostic evidence.
- **Risk Resolver**: when Loop Pulse says `Resolve risk`, record the decision and re-enter the shared mission loop from the dashboard or OpenCode tool.
- **Agent mesh**: inspect agent capacity, active leases, queues, model policy, and boost an agent.
- **Policy gates**: toggle evidence, lease, tool-scope, stall-radar, and human-hold guardrails, with unresolved risks promoted into critical `Resolve risk` work.
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

Add it to your global or project `opencode.json`, restart OpenCode, and let OpenCode install the package at startup. The repo root exports the Runesmith OpenCode plugin, runs the package build during git-package preparation, creates `.runesmith/runtime/capsule.json` on first load when it is missing, resumes that capsule on later OpenCode starts, and loads the same Runic Covenant, Control Brief, Loop Pulse, Runebook, `runesmith_os_run`, `runesmith_next`, tool hooks, runtime capsule, and evidence-gated autopilot described above.

The same root package also ships the `runesmith` CLI binary from `packages/cli/dist/index.js`, so package installs expose one command for bootstrap, status, proof, run, launch, doctor, and risk resolution. The source commands below are the local development equivalents of that packaged binary.

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

For the direct package-plugin path that mirrors the one-line `opencode.json` install, use:

```bash
bun packages/cli/src/index.ts up --mode npm
```

That initializes the same runtime capsule and writes the Runesmith package entry into the OpenCode config in one step. Add `--config <path>` or `--package <entry>` for pinned tags, forks, or project-local OpenCode config files.

For the least ceremony, ignite a goal directly:

```bash
bun packages/cli/src/index.ts ignite "Build direct CLI orchestration"
```

`ignite` defaults to the direct package-plugin path, writes the OpenCode config entry, prepares or resumes the matching mission, claims the active task, runs the OS loop, and prints the next honest stop. Pass `--mode local --plugin-dir <dir> --source <plugin.ts>` when developing against a checkout shim.

Verify the installation:

```bash
bun packages/cli/src/index.ts doctor
```

`doctor` validates the project config, runtime capsule, OpenCode CLI command, OpenCode plugin shim, and an internal Forge -> Review -> Seal orchestration smoke test. It exits nonzero when install files are missing or invalid, or when `opencode` is not discoverable, and prints the next command to repair the setup.

Check the operating loop without learning the mission subcommands:

```bash
bun packages/cli/src/index.ts status
```

`status` prints the Runesmith install state, OpenCode CLI readiness, Loop Pulse next action, execution plan, Mission Map summary, Scope Sentinel status, Review Lens status, Seal Audit status, active mission and task, missing evidence, diagnostics, active runes, active Runebook card, active Protocol Deck protocol, and Proof Plan commands from the runtime capsule. It also stays useful before bootstrap by showing the idle engine state and the next launch/dashboard commands.

Run the OS loop until Runesmith reaches a real stop condition:

```bash
bun packages/cli/src/index.ts run
```

`run` is the default hands-off terminal operation. It runs Runeweave over the active runtime capsule, repeatedly executing engine-owned Runebook cards until the mission is sealed, proof fails, risk needs a decision, implementation evidence is required, a blocker is active, or the safety step limit is reached. Use `--max-steps <n>` to tighten the loop for debugging.

Run the active Runebook card without choosing the lower-level command:

```bash
bun packages/cli/src/index.ts next
```

`next` is the default hands-off terminal control. It reads the Loop Pulse and Runebook, then proves, repairs, recovers, resolves a supplied risk decision, or advances the shared mission loop from the same runtime capsule used by OpenCode and the dashboard.

Run the active proof plan and let Runesmith write evidence:

```bash
bun packages/cli/src/index.ts prove
```

`prove` reads the runtime capsule, runs the active Proof Plan commands, records each passing command as `test-result` evidence, records the first failing command as `diagnostic` evidence, saves the capsule, and advances the shared mission loop when proof passes.

Resolve the active risk hold without looking up mission or task ids:

```bash
bun packages/cli/src/index.ts risk resolve --verdict accepted --summary "Operator accepts the active risk after review"
```

`risk resolve` records a `decision` on the active `Resolve risk` Loop Pulse task, saves the runtime capsule, and calls the shared mission loop so verified work can continue through Review and Seal.

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

`mission inspect` prints the mission status, Loop Pulse next action, Proof Plan commands, Mission Map tasks, Scope Sentinel changes, Review Lens findings, Seal Audit checks, active Runebook card, required and missing evidence, active diagnostics, active runes, task list, evidence ledger entries, and active leases for that mission.

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

# Least-ceremony direct use. This installs/configures, starts or resumes the
# matching Covenant mission, and runs the Runesmith OS loop once.
bun packages/cli/src/index.ts ignite "Build the next feature"

# Local development install. This writes a generated plugin shim to the
# OpenCode global plugin directory and points it at this checkout.
# The Runic Covenant bootstrap and runtime capsule persistence are included automatically.
bun packages/cli/src/index.ts install

# Direct package install, matching the `plugin` array flow while also
# initializing Runesmith config and the runtime capsule.
bun packages/cli/src/index.ts up --mode npm
bun packages/cli/src/index.ts doctor --mode npm

# Package-only wiring is still available for existing projects.
# On first OpenCode load, the package plugin also creates the default capsule
# automatically and then persists every mission mutation there.
bun packages/cli/src/index.ts install --mode npm
```

For a project-local install:

```bash
bun packages/cli/src/index.ts install --plugin-dir .opencode/plugins
bun packages/cli/src/index.ts doctor --plugin-dir .opencode/plugins
```

OpenCode itself must be installed separately so `opencode` resolves on PATH. Runesmith handles its own project config, runtime capsule, and plugin wiring; `doctor` confirms that the host OpenCode CLI is present before reporting ready. OpenCode loads local plugins from `.opencode/plugins/` and `~/.config/opencode/plugins/` automatically. Package plugins are added to the `plugin` array in `opencode.json`; by default Runesmith writes `runesmith@git+https://github.com/pasmud/runesmith.git`. See `examples/opencode/runesmith-plugin.json` for the direct package config shape.

Once installed and OpenCode is restarted, users do not need to invoke a workflow manually. The plugin registers:

- `experimental.chat.system.transform`: injects the Runic Covenant and Runesmith Autopilot bootstrap.
- `experimental.session.compacting`: appends the current mission capsule, Control Brief, Loop Pulse, Mission Map, Scope Sentinel, Review Lens, Seal Audit, Runebook, Mission Memory, and Proof Plan to compaction context.
- `Runesmith Protocol Deck`: injected into system and compaction context so OpenCode follows the engine-selected protocol without user-invoked workflow names.
- `Runesmith Mission Map`: injected into system and compaction context so OpenCode sees the live task graph, dependencies, next task, and evidence gates without a manual planning workflow.
- `Runesmith Scope Sentinel`: injected into system and compaction context so OpenCode sees contract file-scope drift before Review or Seal.
- `Runesmith Review Lens`: injected into system and compaction context so OpenCode sees the pre-seal checklist and findings before autonomous Review or Seal.
- `Runesmith Seal Audit`: injected into system and compaction context so OpenCode does not claim completion until proof, scope, review, and seal-decision checks are satisfied.
- `tool.execute.before`: auto-prepares and claims a mission before the first mutating/shell tool when message context is available.
- `tool.execute.after`: records useful shell, test, and file-change evidence, then runs the evidence-gated advance loop.
- `event`: on `session.idle`, prepares the first mission from chat context when possible, then runs Runeweave automatically so recovery, proof, Review, Seal, and stop-condition reporting use the same OS loop as `runesmith_os_run`.
- `runesmith_autopilot_prepare`: starts or resumes the active mission from the latest user goal and claims the next ready Covenant task.
- `runesmith_os_run`: run Runeweave, repeatedly executing engine-owned Runebook cards until sealed or stopped by implementation work, failed proof, risk, blocker, idle state, or safety limit.
- `runesmith_next`: run the active Runebook card from one tool, including proof execution, repair proof, recovery, risk decision application when supplied, or normal loop advancement.
- `runesmith_autopilot_tick`: manually run the same evidence-gated advance loop and return the live Loop Pulse and Proof Plan, including repair diagnostics when verification failed and risk holds when unresolved risk needs a later decision.
- `runesmith_proof_run`: execute the active Proof Plan inside OpenCode, record proof or diagnostics, and advance the mission when verification passes.
- `runesmith_risk_resolve`: record a decision for the active unresolved risk and advance the shared mission loop without raw evidence plumbing.
- `runesmith_covenant_status`: returns the installed Covenant, live Control Brief, Loop Pulse, Mission Map, Scope Sentinel, Review Lens, Seal Audit, Runebook card, Proof Plan, and active runes from the runtime capsule.
- Mission tools for status, claim, evidence, completion, and recovery.
