# Installing Runesmith for OpenCode

## Direct Install

Add Runesmith to the `plugin` array in your global or project `opencode.json`:

```json
{
  "plugin": ["runesmith@git+https://github.com/pasmud/runesmith.git"]
}
```

Restart OpenCode. OpenCode installs package plugins with Bun at startup, then loads the Runesmith plugin entrypoint from this repo. The package plugin creates `.runesmith/config.json` and `.runesmith/runtime/capsule.json` on first load when they are missing, backs up and repairs invalid local OS files when needed, resumes that capsule on later starts, and persists each mission mutation back into the same file.

## What Loads

Runesmith injects the Runic Covenant, default Agent Mesh, live Control Brief, Loop Pulse, active Runebook card, Protocol Deck, compact first-user-message bootstrap, bundled Runesmith OS reference docs through OpenCode `skills.paths`, Runeweave OS loop, Mission Memory handoff, Mission Map, Plan Contract, Plan Refinery, Dispatch Matrix, Proof Plan commands, Runescope impacted-test proof, Redline Proof ordering, Repair Contract debugging state, Seal Audit completion gate, `runesmith_os_run`, `runesmith_next`, `runesmith_plan_refine`, `runesmith_proof_run`, `runesmith_risk_resolve`, `runesmith_faultline_resolve`, Proof Runner evidence capture, compaction context, automatic mission preparation, automatic evidence capture, idle mission start, idle Runeweave execution, recovery, risk decision holds, Faultline breakpoints for repeated failed repairs, and evidence-gated task advancement. The Protocol Deck is Runesmith's own install-once workflow layer: OpenCode receives the active protocol automatically, with objective, procedure, verification, forbidden moves, and tool hints, without users loading skills or naming workflows. Agent Mesh registers Atlas, Oracle, Artificer, Scout, and Steward contracts by default, and the shared loop uses Dispatch Matrix recommendations when claiming queued or recovered Covenant tasks, so Review and Seal can move to the right built-in role without user-authored contract setup. Plan Contract is the native planning-discipline signal: it classifies the active map as thin, ready, or blocked and tells OpenCode to decompose broad Forge work into concrete proof-backed slices before autonomous execution. Plan Refinery is the mutation path for that signal: `runesmith_plan_refine` remaps a thin mission into proof-backed slices, records the planning decision, persists the capsule, and re-enters the shared loop so independent ready work is claimed automatically. When no custom task graph is supplied, Pathfinder Goal Weave profiles the mission goal and chooses install, runtime, UI, repair, docs, or focused Forge slices instead of forcing every project through a canned map. Dispatch Matrix is the native agent-routing signal: it classifies work as serial, parallel, blocked, drained, or idle from dependency readiness, active leases, and matching agent contracts, then claims every independent ready slot it can safely route in the same loop pass. Redline Proof is the native proof-first signal: it surfaces whether focused failing proof or proof-file evidence came before implementation edits without making users invoke a TDD workflow manually. Repair Contract is the native debugging contract: it reads failed diagnostics and later edits, then classifies the repair as awaiting a scoped change, ready for focused proof, over-broad, proven, or Faultline without asking users to invoke a debugging workflow. Seal Audit combines proof, scope, Redline, repair, review, and Sealmark decision state so OpenCode does not claim completion while evidence is still weak. The compact message bootstrap carries the current Loop Pulse, active protocol, Plan Contract, Dispatch Matrix, Redline status, and Repair Contract once per message transform, which keeps the install path resilient without asking users to manage prompt packs. On OpenCode idle, Runesmith can prepare the first mission from chat context, run Runeweave over the active mission, recover stale work, run the active Proof Plan after implementation evidence exists, prepend impacted tests derived from changed-file evidence and repository files, advance Review and Seal, write a `runeweave.stopped` mission event with the stop reason, hold failed proof as a repair target, escalate three repeated failed repairs into Faultline architecture review, hold unresolved risk until later decision evidence exists, resolve risk and Faultline holds through first-class tools when summaries are supplied, and retry proof only after a new repair edit or explicit Faultline path is captured. Users do not need to look up mission ids or invoke a workflow by name.

## Local Development

From a cloned checkout:

```bash
bun install
bun packages/cli/src/index.ts go "Build the next feature"
bun packages/cli/src/index.ts ignite "Build the next feature"
bun packages/cli/src/index.ts heal
bun packages/cli/src/index.ts up
bun packages/cli/src/index.ts up --mode npm
bun packages/cli/src/index.ts status
bun packages/cli/src/index.ts dashboard
bun packages/cli/src/index.ts run
bun packages/cli/src/index.ts next
bun packages/cli/src/index.ts prove
bun packages/cli/src/index.ts risk resolve --summary "Operator accepts the active risk after review"
bun packages/cli/src/index.ts faultline resolve --summary "Split the failing boundary before another repair"
bun packages/cli/src/index.ts go "Build the next feature" -- <opencode args>
bun packages/cli/src/index.ts launch -- <opencode args>
```

Use `go "<goal>"` for the direct path: it defaults to the package plugin, writes OpenCode config, heals missing or invalid local state, creates or resumes the matching Covenant mission, claims the active task, runs the OS loop once, and can launch OpenCode when args are supplied after `--`. Use `ignite "<goal>"` when you only want the lower-level setup plus mission/loop preparation primitive. Use `dashboard` for the packaged mission-control UI; it repairs missing config, creates the configured runtime capsule when needed, builds missing dashboard assets, then serves the dashboard and control API against that capsule. Use `heal` when config, capsule, or plugin wiring looks broken; it backs up invalid local OS files before replacing them. Use plain `up` for a local development shim, or `up --mode npm` to initialize Runesmith and write the direct package plugin entry into OpenCode config. Existing projects can also use only the package entry above; Runesmith will bootstrap the default config and runtime capsule when OpenCode loads the plugin.

Use `bun packages/cli/src/index.ts doctor` when OpenCode does not load the plugin or the runtime capsule looks invalid.
