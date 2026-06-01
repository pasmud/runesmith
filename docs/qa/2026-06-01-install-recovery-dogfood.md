# Install And Recovery Dogfood - 2026-06-01

## Scope

Dogfood the install-once and self-healing OpenCode path from a fresh Windows project directory after reboot-style restart conditions.

Project:

```text
E:\dev\Oh-my\runesmith-dogfood-install-recovery-2026-06-01
```

Runesmith checkout:

```text
E:\dev\Oh-my\runesmith
```

OpenCode CLI:

```text
C:\nvm4w\nodejs\opencode.cmd
```

Package plugin entry:

```text
runesmith@file:E:/dev/Oh-my/runesmith
```

## Clean Install

Command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts up --mode npm --config opencode.json --package runesmith@file:E:/dev/Oh-my/runesmith
```

Observed:

```text
Runesmith OS is ready
config: .runesmith/config.json
install: package
opencode config: opencode.json
plugin: runesmith@file:E:/dev/Oh-my/runesmith
runtime: .runesmith/runtime/capsule.json
opencode: found C:\nvm4w\nodejs\opencode.cmd
covenant: automatic
dashboard: runesmith dashboard
```

Generated `opencode.json`:

```json
{
  "plugin": [
    "runesmith@file:E:/dev/Oh-my/runesmith"
  ]
}
```

Generated `.runesmith/config.json`:

```json
{
  "version": 1,
  "runtimeDir": ".runesmith/runtime",
  "defaultStaleAfterMs": 120000
}
```

Generated `.runesmith/runtime/capsule.json` contained an empty versioned runtime capsule with `graphs`, `ledgers`, `leases`, and `contracts`.

## Doctor And OpenCode Resolution

Command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts doctor --mode npm --config opencode.json
```

Observed:

```text
Runesmith doctor
config: found (.runesmith/config.json)
runtime capsule: valid (.runesmith/runtime/capsule.json)
opencode cli: found (opencode) - C:\nvm4w\nodejs\opencode.cmd
opencode plugin: found (opencode.json)
dashboard: ready (E:\dev\Oh-my\runesmith\packages\dashboard\dist\index.html)
loop smoke: passed (mission completed)
status: ready
```

`opencode debug config` resolved the local package plugin from the clean project and injected the bundled Runesmith skills path:

```text
plugin: runesmith@file:E:/dev/Oh-my/runesmith
source: E:\dev\Oh-my\runesmith-dogfood-install-recovery-2026-06-01\opencode.json
skills.path: E:\dev\Oh-my\runesmith\.opencode\skills
```

## Goal Start And Resume

Command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts go "Clean recovery dogfood goal" --config opencode.json --package runesmith@file:E:/dev/Oh-my/runesmith
```

Observed first run:

```text
Runesmith Go
mode: direct
setup: ready
install: package
opencode config: opencode.json
plugin: runesmith@file:E:/dev/Oh-my/runesmith
mission: mission_cli_1 created
task: task_cli_1
lease: lease_cli_1
run: needs-work
reason: The active Runebook card requires implementation evidence before Runesmith can continue autonomously.
steps: 1
1. refine-plan -> plan-refined
next: Continue forge [attention/high]
runtime: .runesmith/runtime/capsule.json
```

Observed second run:

```text
mission: mission_cli_1 resumed
task: task_cli_1_runtime_forge
lease: lease_cli_2
run: needs-work
1. continue-forge -> advanced
next: Continue forge [attention/high]
```

Status after resume showed the same runtime capsule driving mission state, proof plan, mission map, plan contract, dispatch matrix, worker dispatch, repair contract, review lens, seal audit, Runebook, and protocol deck.

Key status evidence:

```text
state: ready
next: Continue forge [attention/high]
plan: Inspect scoped surface -> Make scoped change -> Run targeted verification
proof plan: bun test
mission map: 4 tasks; next task_cli_1_runtime_forge
plan contract: ready; Plan contract ready for mission_cli_1: 1 focused implementation slice is mapped with proof evidence.
dispatch matrix: serial; Dispatch Matrix serial for mission_cli_1: 1 dispatch slot is active or ready.
worker dispatch: active; Worker Dispatch has 1 leased packet for mission_cli_1.
mission: mission_cli_1 running Clean recovery dogfood goal
task: task_cli_1_runtime_forge running Forge: orchestration engine path
missing evidence: file-change, test-result
runebook: Forge Trace implementation loop [auto]
protocol: Forge Trace Protocol [auto]
```

## Corrupt State Recovery

The dogfood project was intentionally corrupted:

```powershell
Set-Content -LiteralPath '.runesmith/config.json' -Value '{broken config' -NoNewline
Set-Content -LiteralPath '.runesmith/runtime/capsule.json' -Value '{broken capsule' -NoNewline
```

Doctor correctly reported both invalid local OS files:

```text
Runesmith doctor
config: invalid (.runesmith/config.json) - Project config is not valid JSON
runtime capsule: invalid (.runesmith/runtime/capsule.json) - Runtime capsule is not valid JSON
opencode cli: found (opencode) - C:\nvm4w\nodejs\opencode.cmd
opencode plugin: found (opencode.json)
dashboard: ready (E:\dev\Oh-my\runesmith\packages\dashboard\dist\index.html)
loop smoke: passed (mission completed)
status: incomplete
next: run `runesmith heal` to repair config, runtime, and OpenCode plugin wiring.
```

Heal command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts heal --config opencode.json --package runesmith@file:E:/dev/Oh-my/runesmith
```

Observed:

```text
Runesmith Heal
config: repaired
runtime: repaired
install: package
opencode config: opencode.json
plugin: runesmith@file:E:/dev/Oh-my/runesmith
opencode: found C:\nvm4w\nodejs\opencode.cmd
doctor: ready
next: runesmith go "<goal>" or runesmith go "<goal>" -- <opencode args>
```

Post-heal doctor returned `status: ready`.

Post-heal runtime evidence:

```text
capsuleGoal=Clean recovery dogfood goal
runtimeBackup={broken capsule
configBackup={broken config
```

This proves heal backed up the corrupt files and restored the previous last-good runtime capsule instead of discarding the mission.

Post-heal `go` resumed the same mission:

```text
mission: mission_cli_1 resumed
task: task_cli_1_runtime_forge
run: needs-work
next: Continue forge [attention/high]
```

## Issues Found And Fixed

1. Basename OpenCode config paths such as `opencode.json` crashed on Windows because the Node host attempted `mkdir "."` before writing the file. Fixed by only creating a parent directory when the path has a real parent.
2. Doctor previously treated any existing `.runesmith/config.json` as found even when the file was corrupt. Fixed by loading and validating the project config and reporting `config: invalid` with the snapshot error.

Regression coverage:

```text
bun test packages/cli/tests/cli.test.ts
49 pass
0 fail
```

## Result

The clean install and recovery dogfood passed after fixes:

- Fresh project install writes project-local OpenCode package plugin config.
- OpenCode resolves the package plugin from the clean project.
- Runesmith creates valid project config and runtime capsule files.
- `doctor` validates config, runtime capsule, plugin wiring, dashboard readiness, OpenCode CLI, and loop smoke.
- A normal goal starts a goal-aware mission and a repeat goal resumes it.
- Status reads the same runtime capsule used by CLI and OpenCode install wiring.
- Corrupt config and runtime capsule are detected.
- `heal` backs up corrupt files, restores last-good mission state, rewires OpenCode, and returns doctor to ready.
