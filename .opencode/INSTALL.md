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

Runesmith injects the Runic Covenant, live Control Brief, Loop Pulse, active Runebook card, Protocol Deck, compact first-user-message bootstrap, bundled Runesmith OS reference docs through OpenCode `skills.paths`, Runeweave OS loop, Mission Memory handoff, Proof Plan commands, Seal Audit completion gate, `runesmith_os_run`, `runesmith_next`, `runesmith_proof_run`, `runesmith_risk_resolve`, Proof Runner evidence capture, compaction context, automatic mission preparation, automatic evidence capture, idle mission start, idle Runeweave execution, recovery, risk decision holds, and evidence-gated task advancement. The Protocol Deck is Runesmith's own install-once workflow layer: OpenCode receives the active protocol automatically, with objective, procedure, verification, forbidden moves, and tool hints, without users loading skills or naming workflows. Seal Audit combines proof, scope, review, and Sealmark decision state so OpenCode does not claim completion while evidence is still weak. The compact message bootstrap carries the current Loop Pulse and active protocol once per message transform, which keeps the install path resilient without asking users to manage prompt packs. On OpenCode idle, Runesmith can prepare the first mission from chat context, run Runeweave over the active mission, recover stale work, run the active Proof Plan after implementation evidence exists, advance Review and Seal, write a `runeweave.stopped` mission event with the stop reason, hold failed proof as a repair target, hold unresolved risk until later decision evidence exists, resolve that hold through one next-action tool when a decision summary is supplied, and retry only after a new repair edit is captured. Users do not need to look up mission ids or invoke a workflow by name.

## Local Development

From a cloned checkout:

```bash
bun install
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
bun packages/cli/src/index.ts launch -- <opencode args>
```

Use `ignite "<goal>"` for the least-ceremony path: it defaults to the direct package plugin, writes OpenCode config, heals missing or invalid local state, creates or resumes the matching Covenant mission, claims the active task, and runs the OS loop once. Use `dashboard` for the packaged mission-control UI; it repairs missing config, creates the configured runtime capsule when needed, then serves the built dashboard and control API against that capsule. Use `heal` when config, capsule, or plugin wiring looks broken; it backs up invalid local OS files before replacing them. Use plain `up` for a local development shim, or `up --mode npm` to initialize Runesmith and write the direct package plugin entry into OpenCode config. Existing projects can also use only the package entry above; Runesmith will bootstrap the default config and runtime capsule when OpenCode loads the plugin.

Use `bun packages/cli/src/index.ts doctor` when OpenCode does not load the plugin or the runtime capsule looks invalid.
