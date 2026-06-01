# OpenCode Run Evidence Dogfood - 2026-06-01

## Scope

Dogfood Runesmith inside a clean OpenCode coding run and verify that normal OpenCode tool activity creates durable mission evidence without manual task IDs.

Flow under test:

`clean project -> package plugin loads -> opencode run receives a normal user goal -> Runesmith starts a mission -> OpenCode edits files -> OpenCode runs npm test -> runtime capsule records file-change and test-result evidence -> Forge task advances`

## Environment

- Runesmith checkout: `E:\dev\Oh-my\runesmith`
- Dogfood project: `E:\dev\Oh-my\runesmith-dogfood-opencode-metadata`
- Plugin entry: `runesmith@file:E:/dev/Oh-my/runesmith`
- OpenCode model: `opencode/deepseek-v4-flash-free`
- Command mode: `opencode run --dangerously-skip-permissions --format json`

## Regression Found

The first real OpenCode coding run exposed an adapter gap:

- OpenCode called `runesmith_autopilot_prepare` with `{}`.
- The adapter did not remember the latest transformed user message as a fallback goal.
- Runesmith rejected mission preparation with `AUTOPILOT_GOAL_MISSING`.

Fix added:

- `experimental.chat.messages.transform` caches the latest user goal.
- `runesmith_autopilot_prepare({})` and `tool.execute.before` use that cached goal when OpenCode omits explicit args.
- Regression test: `prepares from the latest transformed user goal when OpenCode calls autopilot with empty args`.

## Evidence Classification Regression

The next real OpenCode run exposed a second adapter gap:

- OpenCode bash output reported the exit code as `metadata.exit`.
- The adapter only read `exitCode`, `code`, and `statusCode`.
- The successful `npm test` was recorded as `diagnostic` instead of `test-result`.

Fix added:

- Evidence classification now reads `metadata.exit`, `metadata.exitCode`, `metadata.code`, and `metadata.statusCode`.
- Result summaries include stdout, stderr, output, status, and message from metadata when top-level fields are absent.
- Regression test: `classifies OpenCode bash metadata exit zero as proof evidence`.

## Successful Real Run

Command:

```powershell
opencode run --model opencode/deepseek-v4-flash-free --dangerously-skip-permissions --format json "In this repository, add an exported multiply(a, b) function to src/math.js, add a node:test assertion for it in test/math.test.js, then run npm test. Keep the change minimal."
```

Observed OpenCode actions:

- Read `src/math.js`.
- Read `test/math.test.js`.
- Edited `src/math.js` to export `multiply(a, b)`.
- Edited `test/math.test.js` to import and test `multiply`.
- Ran `npm test`.
- Node test output reported `# pass 2` and `# fail 0`.

Runtime capsule evidence:

- Mission: `mission_802fb709-903a-4c3b-be8e-b5c9eb63bdcc`
- Root task: `task_733f2800-6987-4f3f-9e58-83e459dc6e1d`
- Captured evidence:
  - `file-change`: edit changed `src\math.js`
  - `file-change`: edit changed `test\math.test.js`
  - `test-result`: `bash ran npm test`
- The `test-result` payload included:
  - `command`: `npm test`
  - `exitCode`: `0`
  - output containing `# pass 2` and `# fail 0`
- Forge task transitioned from `running` to `complete` after required `file-change` and `test-result` evidence were present.
- Review task was claimed by `agent_oracle`.

## Follow-Up Scope Fix

This dogfood run also proved that the default agent scopes were too specific to the Runesmith monorepo. The adapter now infers project-aware implementation scopes from repository files when a clean app layout is detected. For a repo containing `src/math.js` and `test/math.test.js`, Atlas and Oracle receive `src/**` and `test/**` instead of the monorepo defaults, and Review Lens no longer blocks verified app changes as out-of-scope.

## Follow-Up Manual Tool Fix

The real run also showed OpenCode attempting manual `runesmith_task_evidence` and `runesmith_task_complete` calls without mission/task IDs after the automatic evidence path had advanced Forge. The adapter now resolves omitted mission/task IDs to the focused Worker Dispatch packet or active loop task. It also infers manual evidence type from natural-language summaries such as `Attach decision evidence`, so review and seal steps can proceed without exposing internal IDs to the user or model.

## Remaining Gaps

- Seal was not completed in this dogfood run; the final goal still requires end-to-end repair, review, and seal proof across real repos.

## Verification

Commands run after the fixes:

```powershell
bun test packages/opencode-adapter/tests/plugin.test.ts -t "classifies OpenCode bash metadata exit zero as proof evidence"
bun test packages/opencode-adapter/tests/plugin.test.ts -t "manual evidence and completion tools default to the active task when OpenCode omits ids"
bun test packages/opencode-adapter/tests/plugin.test.ts
bun run build:packages
```

Observed result:

- Focused regression passed.
- Manual no-ID evidence/completion regression passed.
- Full OpenCode adapter suite passed after follow-up fixes.
- Package build completed successfully.
