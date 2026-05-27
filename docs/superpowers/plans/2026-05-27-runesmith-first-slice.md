# Runesmith First Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production slice of Runesmith: a tested mission runtime, OpenCode adapter, CLI, seeded dashboard, and harness testbench.

**Architecture:** The core runtime is harness-independent and owns all mission state transitions. OpenCode, CLI, dashboard, and testbench packages consume the core through explicit APIs instead of mutating graph state directly.

**Tech Stack:** Bun workspaces, TypeScript strict mode, Vitest-compatible Bun tests, React + Vite, Tailwind CSS, shadcn/ui-style local components, lucide-react.

---

## File Structure

- `package.json`: root workspace scripts.
- `tsconfig.base.json`: shared strict TypeScript config.
- `README.md`: product overview, usage, package map.
- `LICENSE`: MIT license.
- `packages/core/src/types.ts`: domain types and result helpers.
- `packages/core/src/errors.ts`: stable runtime error constructors.
- `packages/core/src/mission-graph.ts`: mission and task lifecycle operations.
- `packages/core/src/lease-scheduler.ts`: lease acquisition, replay, expiry, release.
- `packages/core/src/contracts.ts`: agent contract validation and assignment checks.
- `packages/core/src/evidence-ledger.ts`: evidence append/query and completion gate helpers.
- `packages/core/src/tool-router.ts`: deterministic tool selection.
- `packages/core/src/recovery.ts`: stale task and evidence recovery policies.
- `packages/core/src/runtime.ts`: high-level runtime facade.
- `packages/core/src/index.ts`: public exports.
- `packages/core/tests/*.test.ts`: core behavior tests.
- `packages/opencode-adapter/src/plugin.ts`: OpenCode plugin shape and mission tools.
- `packages/opencode-adapter/tests/plugin.test.ts`: adapter tests using core runtime.
- `packages/cli/src/index.ts`: command parser and CLI commands.
- `packages/cli/tests/cli.test.ts`: CLI tests.
- `packages/testbench/src/index.ts`: deterministic runtime scenarios.
- `packages/testbench/tests/scenarios.test.ts`: duplicate prompt and stale task scenarios.
- `packages/dashboard/*`: Vite React dashboard, shadcn-style UI components, seeded mission state.
- `examples/opencode/runesmith-plugin.json`: example OpenCode config.

## Task 1: Workspace Scaffold

- [ ] Create root package metadata, TypeScript config, README, license, and package directories.
- [ ] Add per-package `package.json` files with `build`, `typecheck`, and `test` scripts.
- [ ] Run `bun install`.
- [ ] Run `bun run typecheck` and expect initial failures only for packages that do not yet have source files.
- [ ] Commit with `chore: scaffold runesmith workspace`.

## Task 2: Core Types and Result Model

- [ ] Write failing tests for creating typed success/failure results and basic mission/task shapes.
- [ ] Implement `types.ts` and `errors.ts`.
- [ ] Run `bun test packages/core/tests/types.test.ts`.
- [ ] Commit with `feat(core): add runtime domain types`.

## Task 3: Mission Graph

- [ ] Write failing tests that mission creation produces a root mission and one queued task.
- [ ] Write failing tests for valid and invalid task status transitions.
- [ ] Implement `mission-graph.ts`.
- [ ] Run `bun test packages/core/tests/mission-graph.test.ts`.
- [ ] Commit with `feat(core): add mission graph lifecycle`.

## Task 4: Lease Scheduler

- [ ] Write failing tests for exclusive leases by target and purpose.
- [ ] Write failing tests for idempotency replay returning the original active lease.
- [ ] Write failing tests for expired lease replacement.
- [ ] Implement `lease-scheduler.ts`.
- [ ] Run `bun test packages/core/tests/lease-scheduler.test.ts`.
- [ ] Commit with `feat(core): add lease scheduler`.

## Task 5: Contracts, Evidence, Tool Routing, Recovery

- [ ] Write failing tests for missing capability rejection.
- [ ] Write failing tests for completion blocked by missing evidence.
- [ ] Write failing tests for deterministic tool routing.
- [ ] Write failing tests for stale task recovery.
- [ ] Implement `contracts.ts`, `evidence-ledger.ts`, `tool-router.ts`, and `recovery.ts`.
- [ ] Run `bun test packages/core/tests`.
- [ ] Commit with `feat(core): add contracts evidence routing and recovery`.

## Task 6: Runtime Facade

- [ ] Write failing tests that high-level runtime methods create missions, claim tasks, add evidence, complete tasks, and recover stale tasks through core modules.
- [ ] Implement `runtime.ts` and `index.ts`.
- [ ] Run `bun test packages/core/tests/runtime.test.ts`.
- [ ] Commit with `feat(core): expose mission runtime facade`.

## Task 7: OpenCode Adapter

- [ ] Write failing tests that adapter tools call runtime methods and format structured responses.
- [ ] Implement `packages/opencode-adapter/src/plugin.ts`.
- [ ] Add example OpenCode config.
- [ ] Run `bun test packages/opencode-adapter/tests/plugin.test.ts`.
- [ ] Commit with `feat(opencode): add runesmith plugin adapter`.

## Task 8: CLI

- [ ] Write failing tests for `init`, `doctor`, `mission list`, and `mission inspect`.
- [ ] Implement CLI command parser with no global side effects on import.
- [ ] Run `bun test packages/cli/tests/cli.test.ts`.
- [ ] Commit with `feat(cli): add runesmith commands`.

## Task 9: Testbench

- [ ] Write failing tests for duplicate prompt replay, stale background task recovery, and evidence-gated completion.
- [ ] Implement deterministic scenarios in `packages/testbench/src/index.ts`.
- [ ] Run `bun test packages/testbench/tests/scenarios.test.ts`.
- [ ] Commit with `test(testbench): add harness simulations`.

## Task 10: Dashboard

- [ ] Create Vite React dashboard using shadcn/ui composition patterns.
- [ ] Build an OpenClaw OS-inspired operational screen: sidebar, mission lanes, inspector, evidence panel, and timeline.
- [ ] Use lucide-react icons in buttons.
- [ ] Add seeded mission data from core-compatible shapes.
- [ ] Run `bun run --filter @runesmith/dashboard build`.
- [ ] Commit with `feat(dashboard): add mission control dashboard`.

## Task 11: Verification and Publish

- [ ] Run `bun test`.
- [ ] Run `bun run typecheck`.
- [ ] Run `bun run build`.
- [ ] Start the dashboard locally and verify desktop/mobile render with browser automation.
- [ ] Create the GitHub repository if authentication is available.
- [ ] Push commits to the new remote.
- [ ] Commit any final documentation fixes with `docs: prepare runesmith release`.
