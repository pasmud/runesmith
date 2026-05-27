# Installing Runesmith for OpenCode

## Direct Install

Add Runesmith to the `plugin` array in your global or project `opencode.json`:

```json
{
  "plugin": ["runesmith@git+https://github.com/pasmud/runesmith.git"]
}
```

Restart OpenCode. OpenCode installs package plugins with Bun at startup, then loads the Runesmith plugin entrypoint from this repo.

## What Loads

Runesmith injects the Runic Covenant, live Control Brief, Loop Pulse, active Runebook card, Runeweave OS loop, Mission Memory handoff, Proof Plan commands, `runesmith_os_run`, `runesmith_next`, `runesmith_proof_run`, `runesmith_risk_resolve`, Proof Runner evidence capture, compaction context, automatic mission preparation, automatic evidence capture, idle mission start, idle Runeweave execution, recovery, risk decision holds, and evidence-gated task advancement. On OpenCode idle, it can prepare the first mission from chat context, run Runeweave over the active mission, recover stale work, run the active Proof Plan after implementation evidence exists, advance Review and Seal, write a `runeweave.stopped` mission event with the stop reason, hold failed proof as a repair target, hold unresolved risk until later decision evidence exists, resolve that hold through one next-action tool when a decision summary is supplied, and retry only after a new repair edit is captured. Users do not need to load skills, look up mission ids, or invoke a workflow by name.

## Local Development

From a cloned checkout:

```bash
bun install
bun packages/cli/src/index.ts up
bun packages/cli/src/index.ts up --mode npm
bun packages/cli/src/index.ts status
bun packages/cli/src/index.ts run
bun packages/cli/src/index.ts next
bun packages/cli/src/index.ts prove
bun packages/cli/src/index.ts risk resolve --summary "Operator accepts the active risk after review"
bun packages/cli/src/index.ts launch -- <opencode args>
```

Use plain `up` for a local development shim, or `up --mode npm` to initialize Runesmith and write the direct package plugin entry into OpenCode config.

Use `bun packages/cli/src/index.ts doctor` when OpenCode does not load the plugin or the runtime capsule looks invalid.
