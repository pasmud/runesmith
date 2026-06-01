# Clean OpenCode Install Dogfood - 2026-06-01

## Scope

Dogfood Runesmith from clean OpenCode project directories on Windows.

This run focused on two install paths:

1. CLI-first user flow: `runesmith go "<goal>"` writes project-local OpenCode plugin config, creates the runtime capsule, starts the mission, refines the plan, and stops at real implementation work.
2. Direct OpenCode package-plugin startup: a project containing only `opencode.json` loads the Runesmith package plugin and lets plugin startup create `.runesmith/config.json` and `.runesmith/runtime/capsule.json`.

## Environment

- Runesmith checkout: `E:\dev\Oh-my\runesmith`
- Clean CLI dogfood project: `E:\dev\Oh-my\runesmith-dogfood-clean-opencode`
- Clean plugin-startup project: `E:\dev\Oh-my\runesmith-dogfood-plugin-startup`
- OpenCode CLI: `C:\nvm4w\nodejs\opencode.cmd`
- Plugin entry used for dogfood: `runesmith@file:E:/dev/Oh-my/runesmith`

## CLI-First Flow

Command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts go "Clean OpenCode install dogfood mission" --config E:/dev/Oh-my/runesmith-dogfood-clean-opencode/opencode.json --package runesmith@file:E:/dev/Oh-my/runesmith
```

Observed output:

```text
Runesmith Go
mode: direct
setup: ready
install: package
opencode config: E:/dev/Oh-my/runesmith-dogfood-clean-opencode/opencode.json
plugin: runesmith@file:E:/dev/Oh-my/runesmith
mission: mission_cli_1 created
task: task_cli_1
lease: lease_cli_1
run: needs-work
reason: The active Runebook card requires implementation evidence before Runesmith can continue autonomously.
steps: 1
1. refine-plan -> plan-refined
- none
next: Continue forge [attention/high]
runtime: .runesmith/runtime/capsule.json
dashboard: runesmith dashboard
launch: runesmith go "<goal>" -- <opencode args>
```

Verification command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts doctor --mode npm --config E:/dev/Oh-my/runesmith-dogfood-clean-opencode/opencode.json
```

Observed output:

```text
Runesmith doctor
config: found (.runesmith/config.json)
runtime capsule: valid (.runesmith/runtime/capsule.json)
opencode cli: found (opencode) - C:\nvm4w\nodejs\opencode.cmd
opencode plugin: found (E:/dev/Oh-my/runesmith-dogfood-clean-opencode/opencode.json)
dashboard: ready (E:\dev\Oh-my\runesmith\packages\dashboard\dist\index.html)
loop smoke: passed (mission completed)
status: ready
```

Status evidence:

```text
next: Continue forge [attention/high]
plan contract: ready; Plan contract ready for mission_cli_1: 2 focused implementation slices are mapped with proof evidence.
dispatch matrix: serial; Dispatch Matrix serial for mission_cli_1: 2 dispatch slots are active or ready.
worker dispatch: active; Worker Dispatch has 2 leased packets for mission_cli_1.
runebook: Forge Trace implementation loop [auto]
protocol: Forge Trace Protocol [auto]
proof plan: bun test
```

Generated OpenCode config:

```json
{
  "plugin": [
    "runesmith@file:E:/dev/Oh-my/runesmith"
  ]
}
```

Runtime capsule highlights:

- Mission `mission_cli_1` was created for `Clean OpenCode install dogfood mission`.
- Pathfinder generated a 5-task goal-aware plan:
  - `Plan: Clean OpenCode install dogfood mission`
  - `Forge: orchestration engine path`
  - `Forge: direct install surface`
  - `Review: proof and risk gate`
  - `Seal: install and handoff`
- The planning task completed with `decision` evidence from `runesmith-plan-refinery`.
- Runtime and install Forge slices were claimed and leased.
- Worker Dispatch wrote a focused `worker.dispatch.claimed` event for `task_cli_1_runtime_forge`.

## Direct OpenCode Plugin Startup

Initial project contents:

```json
{
  "plugin": ["runesmith@file:E:/dev/Oh-my/runesmith"]
}
```

Command:

```powershell
opencode debug config
```

Observed OpenCode config resolution:

```json
{
  "plugin": [
    "runesmith@file:E:/dev/Oh-my/runesmith"
  ],
  "plugin_origins": [
    {
      "spec": "runesmith@file:E:/dev/Oh-my/runesmith",
      "source": "E:\\dev\\Oh-my\\runesmith-dogfood-plugin-startup\\opencode.json",
      "scope": "local"
    }
  ],
  "skills": {
    "paths": [
      "E:\\dev\\Oh-my\\runesmith\\.opencode\\skills"
    ]
  }
}
```

Startup side effects:

```text
.runesmith/config.json
.runesmith/runtime/capsule.json
```

Generated config:

```json
{
  "version": 1,
  "runtimeDir": ".runesmith/runtime",
  "defaultStaleAfterMs": 120000
}
```

Generated capsule:

```json
{
  "version": 1,
  "runtime": {
    "graphs": {},
    "ledgers": {},
    "leases": {
      "leases": {}
    },
    "contracts": {}
  }
}
```

## Result

Clean OpenCode install dogfood passed for:

- Project-local OpenCode config writing.
- OpenCode config resolution of the Runesmith package plugin.
- Plugin startup injection of bundled Runesmith OS skills.
- First-load creation of `.runesmith/config.json`.
- First-load creation of `.runesmith/runtime/capsule.json`.
- CLI `go` mission ignition, plan refinement, multi-slice dispatch, Worker Dispatch focus, and honest stop at implementation evidence.
- `doctor` readiness against the clean project.

Remaining production dogfood still needed before the full final goal is complete:

- Run an actual OpenCode `run` coding request with model credentials and capture file/shell/tool evidence through OpenCode hooks.
- Dogfood against at least one additional real repository beyond the Runesmith checkout and the clean synthetic projects.
