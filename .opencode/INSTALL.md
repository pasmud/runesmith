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

Runesmith injects the Runic Covenant, live Control Brief, Loop Pulse, Mission Memory handoff, Proof Plan commands, compaction context, automatic mission preparation, automatic evidence capture, recovery, and evidence-gated task advancement. Users do not need to load skills or invoke a workflow by name.

## Local Development

From a cloned checkout:

```bash
bun install
bun packages/cli/src/index.ts up
bun packages/cli/src/index.ts status
bun packages/cli/src/index.ts launch -- <opencode args>
```

Use `bun packages/cli/src/index.ts doctor` when OpenCode does not load the plugin or the runtime capsule looks invalid.
