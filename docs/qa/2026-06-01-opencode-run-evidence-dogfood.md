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

## Remaining Gaps

- OpenCode still attempted manual `runesmith_task_evidence` and `runesmith_task_complete` calls without mission/task IDs after the automatic evidence path had already advanced Forge. The automatic path is working, but tool guidance should reduce these manual dead-end calls.
- Review scope policy still reflects the Runesmith repository defaults (`packages/**`, `docs/**`, `examples/**`). Generic project scope inference is still needed before the product can be called production-ready for arbitrary repos.
- Seal was not completed in this dogfood run; the final goal still requires end-to-end repair, review, and seal proof across real repos.

## Verification

Commands run after the fixes:

```powershell
bun test packages/opencode-adapter/tests/plugin.test.ts -t "classifies OpenCode bash metadata exit zero as proof evidence"
bun test packages/opencode-adapter/tests/plugin.test.ts
bun run build:packages
```

Observed result:

- Focused regression passed.
- Full OpenCode adapter suite passed: `48 pass`, `0 fail`.
- Package build completed successfully.
