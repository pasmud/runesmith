# Runesmith

Runesmith is an OpenCode orchestration OS. It turns coding work into a durable mission graph with leased execution, typed agent contracts, evidence-gated completion, recovery policies, an agent mesh, and a production control surface.

The goal is not to add another prompt pack. Runesmith gives OpenCode a small operating system for agentic work:

- Missions are explicit graphs instead of transcript-only state.
- Agents need contracts before they can claim tasks.
- Internal prompt/continuation work is protected by leases and idempotency keys.
- Tasks cannot complete without evidence.
- Recovery policies can detect stale or unsafe work before it silently disappears.
- The dashboard is an operating surface: forge directives, run guarded autopilot, boost agents, toggle policies, and seal evidence snapshots.

## Packages

- `@runesmith/core`: harness-independent mission runtime.
- `@runesmith/opencode-adapter`: OpenCode plugin tools backed by the core runtime.
- `@runesmith/cli`: local setup and mission inspection commands.
- `@runesmith/testbench`: deterministic harness simulations.
- `@runesmith/dashboard`: OpenClaw OS-inspired mission control surface using shadcn/ui-style components.

## Orchestration OS Surface

The dashboard is intentionally not a static report. It models the working loop an OpenCode harness needs:

- **Mission board**: lane-based tasks with evidence, leases, status transitions, and a selected-task inspector.
- **Command forge**: turn a new directive into a tracked mission task.
- **Autopilot cycle**: recover stale work first, then verify running work under policy.
- **Agent mesh**: inspect agent capacity, active leases, queues, model policy, and boost an agent.
- **Policy gates**: toggle evidence, lease, tool-scope, stall-radar, and human-hold guardrails.
- **Snapshots**: seal replayable mission checkpoints with task, evidence, and readiness counts.

Every dashboard control mutates local OS state today. Runtime-backed streaming can plug into the same model boundary.

## Development

```bash
bun install
bun test
bun run typecheck
bun run build
```

Run the dashboard:

```bash
bun run dev:dashboard
```

## OpenCode

Runesmith supports two install paths:

```bash
# Local development install. This writes a generated plugin shim to the
# OpenCode global plugin directory and points it at this checkout.
bun packages/cli/src/index.ts install

# Future npm-style install, matching the OpenCode `plugin` array flow.
bun packages/cli/src/index.ts install --mode npm --package runesmith@latest
```

For a project-local install:

```bash
bun packages/cli/src/index.ts install --plugin-dir .opencode/plugins
```

OpenCode loads local plugins from `.opencode/plugins/` and `~/.config/opencode/plugins/` automatically. Npm plugins are added to the `plugin` array in `opencode.json`. See `examples/opencode/runesmith-plugin.json` for the npm-style config shape.
