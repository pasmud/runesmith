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

Dashboard browser QA passed for the core OS flow above. The remaining QA coverage still needed before the full final goal is complete is a clean OpenCode-project install run plus dogfooding on additional real repositories with captured proof and docs updated from those runs.
