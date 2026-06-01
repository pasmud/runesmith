# Dashboard Browser QA - 2026-06-01

## Scope

Dogfood the Runesmith dashboard as a production OS surface against the local Vite server.

Flow under test:

`dashboard loads -> mission directive is forged -> plan is refined through runtime control -> Run next is exercised -> state remains visible and error-free`

## Environment

- URL: `http://127.0.0.1:5173/`
- Server: `bun run dev:dashboard`
- Browser path: Codex in-app Browser for DOM, console, and interactions.
- Screenshot fallback: `npx --package @playwright/cli playwright-cli` because the in-app Browser screenshot API timed out on `Page.captureScreenshot`.
- Viewports checked: desktop `1280x720`, mobile `390x844`.

## Evidence

- Page identity: `Runesmith Mission Control` at `http://127.0.0.1:5173/`.
- Blank-page check: DOM snapshot contained the Runesmith OS sidebar, Home/Agents/Covenant/Policies/Snapshots navigation, mission directive input, Run OS, Run next, Run proof, and seeded dashboard cards before runtime creation.
- Console health: in-app Browser console checks returned no `error` or `warn` entries after load, Forge, Refine plan, and Run next.
- Interaction proof:
  - Filled mission directive with `Dogfood dashboard QA worker focus`.
  - Clicked `Forge`.
  - Dashboard created a runtime capsule and switched from seeded mode to `Loaded runtime capsule`.
  - Clicked `Refine plan`.
  - Dashboard remapped the mission into proof-backed slices and displayed `Continue forge`.
  - Clicked `Run next`.
  - Dashboard stayed on the correct runtime state with `Continue forge`, active Artificer-owned work, Mission Map, Worker Dispatch, and Proof Plan context visible.
- State-gating proof: `Claim packet` was present but disabled after refinement because the active Worker Dispatch packet was already leased by the dashboard runtime control path.
- Visual proof: desktop and mobile Playwright screenshots showed the white OpenClaw-style layout rendering without framework overlay, blank shell, obvious first-viewport overlap, or clipped primary controls.

## Runtime Capsule Highlights

The dogfood run generated a local runtime capsule with:

- Mission: `Dogfood dashboard QA worker focus`
- Refined task map:
  - `Plan: Dogfood dashboard QA worker focus` complete with `decision` evidence.
  - `Forge: operator interface path` running and assigned to `agent_artificer`.
  - `Review: proof and risk gate` queued behind Forge.
  - `Seal: install and handoff` queued behind Review.
- Focus event:
  - `worker.dispatch.claimed`
  - holder: `runesmith-dashboard`
  - agent: `agent_artificer`
  - target: `interface_forge`

## Result

Dashboard browser QA passed for the core OS flow above. Clean OpenCode install and recovery dogfood are now recorded separately in `docs/qa/2026-06-01-clean-opencode-install-dogfood.md` and `docs/qa/2026-06-01-install-recovery-dogfood.md`. The remaining QA coverage still needed before the full final goal is complete is additional real-repository dogfooding with captured proof after each major runtime or UI change.

## Follow-Up Sealed Capsule QA

After the OpenCode seal-gate hardening work, the dashboard was re-tested against a real sealed OpenCode capsule instead of seeded state.

Environment:

- Runtime capsule: `E:\dev\Oh-my\runesmith-dogfood-opencode-bom\.runesmith\runtime\capsule.json`
- Server command: `RUNESMITH_RUNTIME_CAPSULE=E:/dev/Oh-my/runesmith-dogfood-opencode-bom/.runesmith/runtime/capsule.json bun run dev:dashboard`
- URL: `http://127.0.0.1:5173/`
- Browser path: Codex in-app Browser for DOM, console, and interaction checks.
- Screenshot fallback: bundled Playwright runtime because the in-app Browser screenshot API again timed out on `Page.captureScreenshot`.
- Viewports captured: desktop `1280x720`, mobile `390x844`.

Flow under test:

`dashboard loads sealed runtime capsule -> completed Mission Map renders -> Plan Contract reflects terminal state -> primary nav and runtime controls remain interactive -> console stays clean`

Regression found:

- Mission Map showed all Forge/Review/Seal tasks as `complete`.
- Plan Contract still reported the same sealed mission as `thin` and showed `Refine plan`.
- Root cause: `derivePlanContract` applied the stage-only Covenant thin heuristic before considering that every mapped task was already complete.

Fix added:

- Plan Contract now has a `complete` state for mapped missions where every task is complete and required evidence is present.
- Completed stage-only Covenant maps are classified as `complete`, not `thin`.
- The dashboard styles `complete` Plan Contract slices with the same verified treatment as ready plans.
- Regression test: `marks a completed Covenant map as complete instead of thin`.

Evidence after fix:

- Page identity: `Runesmith Mission Control` at `http://127.0.0.1:5173/`.
- Blank-page check: DOM snapshot contained the Runesmith OS sidebar, Capsule, Snapshot, Run OS, Run next, Run proof, Autopilot cycle, mission lanes, Mission Map, Plan Contract, and live capsule data.
- Console health: no `error` or `warn` entries after load, navigation, capsule refresh, or Run OS on the sealed mission.
- Mission Map: Forge, Review, and Seal all rendered as `complete`.
- Plan Contract: rendered `complete` with summary `Plan contract complete for mission_95392fc4-d8fc-4fa3-b947-ced6481a14c8: all 3 mapped tasks are complete with required evidence.`
- `Refine plan` was no longer visible for the sealed mission.
- Interaction proof:
  - Agents navigation opened the Agent Mesh view.
  - Snapshots navigation opened the Evidence Ledger view.
  - Home returned to Mission lanes with the complete Plan Contract still visible.
  - Review task selection updated task focus.
  - Capsule refresh reloaded the same live capsule.
  - Run OS on the sealed mission stayed idle with the complete Plan Contract intact.

Verification commands:

```powershell
bun test packages/core/tests/plan-contract.test.ts -t "completed Covenant"
bun run build:packages
bun test packages/core/tests/plan-contract.test.ts
bun test packages/dashboard/tests
bun test
bun run typecheck
bun run build
bun pm pack --dry-run
git diff --check
```

Observed result:

- Focused regression passed.
- Package build completed so the dashboard dev server consumed the updated core package output.
- Plan Contract suite passed: 6 tests, 0 failures.
- Dashboard test suite passed: 40 tests, 0 failures.
- Full repo test suite passed: 311 tests, 0 failures.
- Typecheck, production build, package dry-run, and diff whitespace check completed successfully.

## Follow-Up Adapter Evidence QA

After guarded OpenCode evidence was changed so manual Review/Seal decision evidence re-enters the shared loop immediately, the dashboard was smoke-tested again against the current local dev server.

Environment:

- URL: `http://127.0.0.1:5173/`
- Browser path: Codex in-app Browser for DOM, console, and click checks.
- Runtime state shown: sealed OpenCode dogfood capsule with Forge, Review, and Seal tasks complete.

Flow under test:

`dashboard loads current runtime capsule -> sidebar navigation remains interactive -> Snapshot and Run next controls remain responsive -> sealed Mission Map and Plan Contract remain visible -> console stays clean`

Evidence:

- Page identity: `Runesmith Mission Control` at `http://127.0.0.1:5173/`.
- DOM snapshot contained the OpenClaw-style Runesmith OS shell, Home/Agents/Covenant/Policies/Snapshots navigation, Capsule, Snapshot, Run OS, Run next, Run proof, Autopilot cycle, mission lanes, Mission Map, Plan Contract, and live capsule artifact.
- Navigation clicks exercised: Agents, Covenant, Policies, Snapshots, Home.
- Runtime control clicks exercised: Run next and Snapshot.
- Run next returned `Autopilot found no pending work.` for the sealed capsule.
- Snapshot created a `Manual checkpoint` artifact without console errors.
- Console health: no browser console errors after load, navigation, Run next, or Snapshot.
- The in-app Browser could not type into the Mission directive input because its virtual clipboard was unavailable. The typed Forge flow remains covered by `packages/dashboard/tests/runtime-control-plane.test.ts` and `packages/dashboard/tests/dashboard-model.test.ts`; a future browser QA run should repeat typed Forge with a browser backend that supports text input.
