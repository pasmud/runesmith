# Real Repo Dogfood: oh-my-openagent - 2026-06-01

## Scope

Dogfood Runesmith as an installed OpenCode package plugin against a real monorepo, using a normal `opencode run` coding request and no user-managed mission or task ids.

## Environment

- Runesmith checkout: `E:\dev\Oh-my\runesmith`
- Real repo under test: `E:\dev\Oh-my\oh-my-openagent`
- Dogfood worktree: `E:\dev\Oh-my\runesmith-dogfood-oh-my-openagent-2`
- Base commit: `c731969872c2ae1710b6f17e7ec15d0f0d089e68`
- Plugin entry: `runesmith@file:E:/dev/Oh-my/runesmith`
- OpenCode session: `ses_17d2d77a2ffe9WyWJZq4J1T5ws`

Local `opencode.json`:

```json
{
  "plugin": [
    "runesmith@file:E:/dev/Oh-my/runesmith"
  ]
}
```

## Command

```powershell
opencode run --model opencode/deepseek-v4-flash-free --dangerously-skip-permissions --format json "In this repository, update docs/reference/known-issues.md by adding one concise sentence near the top that says each known issue should include the affected version range when it is known. Keep the documentation change minimal. Then run bun test src/plugin/session-status-normalizer.test.ts. Let Runesmith continue the mission through proof, review, and seal using its active tools; do not ask me for mission ids or task ids."
```

## First Run Findings

The first real-repo run succeeded at the requested repo work, but exposed two Runesmith product gaps:

- Project-aware agent scopes narrowed Atlas/Oracle to `src/**` and `tests/**`, so a valid `docs/**` change was blocked by the review scope sentinel.
- `runesmith_task_evidence` rejected nested OpenCode-shaped manual evidence like `{ evidence: { decision: "..." } }` with `EVIDENCE_TYPE_MISSING`.

These were fixed with regression coverage in `packages/opencode-adapter/tests/plugin.test.ts`.

## Repeat Run Result

The repeat run completed the mission:

- Mission: `mission_6f36ac42-e3d8-4c32-8a63-a309586ff7e3`
- Forge task: `complete`
- Review task: `complete`
- Seal task: `complete`
- Mission status: `complete`

Runtime contract proof:

```json
{
  "agent_atlas": ["src/**", "tests/**", "packages/**", "docs/**", "bun.lock", "package.json", "tsconfig.json"],
  "agent_oracle": ["src/**", "tests/**", "packages/**", "docs/**", "bun.lock", "package.json", "tsconfig.json"]
}
```

Requested repo diff:

```diff
-Tracks bugs that are present in the current release but have been intentionally deferred. Each entry should explain the symptom, the history, any workaround, and the planned resolution.
+Tracks bugs that are present in the current release but have been intentionally deferred. Each entry should explain the symptom, the history, any workaround, and the planned resolution. Each known issue should include the affected version range when it is known.
```

Proof command:

```text
bun test v1.3.13 (bf2e2cec)

6 pass
0 fail
6 expect() calls
Ran 6 tests across 1 file. [380.00ms]
```

Recovery proof:

- Initial proof failed because workspace packages were not linked in the clean worktree.
- The agent diagnosed the missing `@oh-my-opencode/rules-engine` workspace link.
- It ran `bun install`.
- Install completed and generated `assets/oh-my-opencode.schema.json`.
- The original test passed after dependency recovery.

Evidence ledger highlights:

- `file-change`: edit to `docs/reference/known-issues.md`
- `diagnostic`: first failing `bun test src/plugin/session-status-normalizer.test.ts`
- `command-output`: dependency and workspace diagnostics
- `command-output`: `bun install`
- `test-result`: passing `bun test src/plugin/session-status-normalizer.test.ts`
- `decision`: autonomous review approval
- `decision`: seal decision

## Remaining Follow-Up

The run exposed one non-blocking ergonomics issue: after runtime advanced to the seal task, the model attached a broad manual evidence note (`file-change and test-result evidence`) to the seal task before adding the required seal decision. The gate behaved correctly and rejected completion until decision evidence existed, but the tool guidance should make seal/review evidence expectations more obvious.

Follow-up fix:

- `runesmith_task_evidence` now explicitly says Review or Seal should receive decision evidence only after Review Lens or Seal Audit says ready.
- `runesmith_task_complete` now tells OpenCode that Review and Seal still run through Review Lens and Seal Audit, and to use `runesmith_next` or `runesmith_autopilot_tick` when those gates can decide autonomously.
- The injected Runesmith Autopilot prompt now says not to attach broad file/test summaries as Review or Seal evidence.
- Regression test: `guides Review and Seal through decision gates instead of broad manual evidence`.

## Repair/Seal Regression Dogfood

A third clean local clone was used to dogfood the repair loop after the repeat run exposed a seal-stage retry loop:

```text
E:\dev\Oh-my\runesmith-dogfood-oh-my-openagent-3
```

Install command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts up --mode npm --config opencode.json --package runesmith@file:E:/dev/Oh-my/runesmith
```

Observed install result:

```text
Runesmith OS is ready
config: .runesmith/config.json
install: package
opencode config: opencode.json
plugin: runesmith@file:E:/dev/Oh-my/runesmith
runtime: .runesmith/runtime/capsule.json
opencode: found C:\nvm4w\nodejs\opencode.cmd
```

The OpenCode run completed the requested documentation edit and recovered missing workspace links with `bun install`, but then surfaced a Runesmith bug:

- A later failed `bun run build 2>&1 | head -30` diagnostic belonged to the completed Forge task.
- The active task had already advanced to Seal.
- Loop Pulse and Proof Plan initially treated the mission as a seal action instead of redirecting to the unresolved Forge repair contract.

Fixes added:

- Loop Pulse now treats unresolved mission-level Repair Contracts as higher priority than Review/Seal decision guards.
- Proof Plan now targets the original repair task when a repair contract is active, even if the active task is Seal.
- Repair Contract now recognizes successful dependency install commands such as `bun install` as a scoped repair variable.
- Repair Contract requires a passing rerun of the exact failing command when the diagnostic captured a command.
- Faultline decisions now release the task back into focused repair instead of leaving it permanently escalated.

Regression coverage:

```powershell
bun test packages/core/tests/loop-pulse.test.ts -t "prioritizes unresolved Forge repair contract before sealing"
bun test packages/core/tests/proof-plan.test.ts -t "targets unresolved Forge repair proof while the active task is Seal"
bun test packages/core/tests/repair-contract.test.ts
bun test packages/core/tests/runebook-next.test.ts
```

Post-fix dogfood status before proof:

```text
next: Repair diagnostic [attention/high]
proof plan: bun run build 2>&1 | head -30 -> bun run typecheck -> bun test -> bun run build
repair contract: ready-for-proof; Repair contract ready for task_d8ea19f4-0396-4097-9682-c6566909ec01: one repair variable changed after the diagnostic; rerun bun run build 2>&1 | head -30.
seal audit: blocked; 1 finding
```

Proof command:

```powershell
bun E:/dev/Oh-my/runesmith/packages/cli/src/index.ts prove
```

Observed proof result:

```text
Proof plan executed
mission: mission_30873680-d91b-4eca-ab75-d0d018d742d7
task: task_d8ea19f4-0396-4097-9682-c6566909ec01
- PASS Rerun failing command: bun run build 2>&1 | head -30
- PASS Run typecheck: bun run typecheck
- PASS Run tests: bun test
- PASS Run build: bun run build
status: completed
next: Wait for goal [clear/low]
```

Final Runesmith status:

```text
next: Wait for goal [clear/low]
handoff: Mission mission_30873680-d91b-4eca-ab75-d0d018d742d7 is sealed with passing proof and 2 decision records.
proof plan: none
plan contract: complete; all 3 mapped tasks are complete with required evidence.
dispatch matrix: drained
worker dispatch: idle
repair contract: proven
review lens: sealed; 0 findings
seal audit: sealed; 0 findings
mission: none
task: none
missing evidence: none
diagnostics: none
```
