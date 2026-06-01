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

## Follow-Up Seal and BOM Dogfood

A later clean OpenCode run used a dogfood project with a UTF-8 BOM in `package.json` to verify project detection through the real package plugin path.

Dogfood project:

- `E:\dev\Oh-my\runesmith-dogfood-opencode-bom`
- `opencode.json`: `{"plugin":["runesmith@file:E:/dev/Oh-my/runesmith"]}`
- `package.json`: Node ESM app with `scripts.test = "node --test"` and a UTF-8 BOM.

Command:

```powershell
opencode run --model opencode/deepseek-v4-flash-free --dangerously-skip-permissions --format json "In this repository, add an exported divide(a, b) function to src/math.js, add a node:test assertion for it in test/math.test.js, then run npm test. Keep the code change minimal. Let Runesmith continue the mission through review and seal using its active task tools; do not ask me for mission ids or task ids."
```

Observed OpenCode actions:

- `runesmith_autopilot_prepare({})` created mission `mission_95392fc4-d8fc-4fa3-b947-ced6481a14c8`.
- Edited `src/math.js` to export `divide(a, b)`.
- Edited `test/math.test.js` to import and test `divide`.
- Ran `npm test`.
- Node test output reported `# pass 2` and `# fail 0`.
- `runesmith_autopilot_tick({})` sealed the mission without manual mission IDs or task IDs.

Runtime capsule proof:

- Mission status: `complete`.
- Forge, review, and seal tasks: `complete`.
- Captured evidence:
  - 3 `file-change` records from OpenCode edit tools.
  - 1 `test-result` record from OpenCode bash metadata with `exitCode: 0`.
  - 1 autonomous review `decision` containing Review Lens status `ready`.
  - 1 autonomous seal `decision` containing Seal Audit status `ready`.
- Inferred project scopes:
  - `agent_atlas.fileScope`: `["src/**", "test/**", "package.json"]`
  - `agent_oracle.fileScope`: `["src/**", "test/**", "package.json"]`
- Seal Audit scope gate passed; no critical scope findings were present.

Regressions fixed from this dogfood:

- `package.json` parsing now strips a UTF-8 BOM before `JSON.parse`, so clean Windows-created app repos still receive project-aware scopes instead of monorepo defaults.
- Review and seal completion re-run Decision Guard even when decision evidence was manually attached, so manual decisions cannot bypass Review Lens or Seal Audit blockers.

## Remaining Gaps

- End-to-end OpenCode seal now passes on a clean app repo.
- The final goal still requires additional dogfooding on real non-fixture repos and dashboard browser QA after each major UI/runtime change.

## Verification

Commands run after the fixes:

```powershell
bun test packages/opencode-adapter/tests/plugin.test.ts -t "classifies OpenCode bash metadata exit zero as proof evidence"
bun test packages/opencode-adapter/tests/plugin.test.ts -t "manual evidence and completion tools default to the active task when OpenCode omits ids"
bun test packages/opencode-adapter/tests/plugin.test.ts -t "UTF-8 BOM"
bun test packages/core/tests/runic-loop.test.ts -t "manual"
bun test packages/opencode-adapter/tests/plugin.test.ts
bun test packages/core/tests/runic-loop.test.ts
bun test
bun run typecheck
bun run build
bun pm pack --dry-run
git diff --check
```

Observed result:

- Focused regressions passed.
- Manual no-ID evidence/completion regression passed.
- Full OpenCode adapter and core runic-loop suites passed.
- Full repo test suite passed: 310 tests, 0 failures.
- Typecheck, production build, package dry-run, and diff whitespace check completed successfully.
