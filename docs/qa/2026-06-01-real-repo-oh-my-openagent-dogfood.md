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
