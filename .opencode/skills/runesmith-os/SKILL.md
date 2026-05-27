---
name: runesmith-os
description: Use when debugging Runesmith installation, explaining Runesmith-native orchestration, or needing a fallback reference for the Runesmith Protocol Deck. Normal coding work should be handled by Runesmith tools and runtime state automatically.
---

# Runesmith OS

Runesmith is not a prompt pack or a user-invoked workflow library. It is the OpenCode orchestration OS for this project.

## Operating Rule

Do not ask the user to load skills, name workflows, or manually pick a process. Read the live Runesmith context and let the engine choose:

- Loop Pulse selects the next action.
- Protocol Deck selects the current method.
- Runebook selects the executable card.
- Mission Memory carries the handoff.
- Agent Mesh provides the default Atlas, Oracle, Artificer, Scout, and Steward contracts and lets Dispatch Matrix steer queued task claims without user-authored setup.
- Plan Contract checks whether the engine-owned map is thin, ready, or blocked before broad work starts.
- Dispatch Matrix selects ready, active, blocked, serial, and parallel dispatch slots from leases, dependencies, and agent contracts.
- Proof Plan chooses verification commands, including Runescope impacted tests from changed-file evidence when repository files are discoverable.
- Redline Proof checks whether focused failing proof or proof-file evidence preceded implementation edits when behavior is testable.
- Repair Contract classifies failed proof repair as awaiting a scoped edit, ready for focused proof, over-broad, proven, or Faultline from runtime evidence.
- Seal Audit decides whether completion can be claimed.
- Runeweave runs engine-owned actions until a real stop condition appears.

## Direct Use

When a coding goal appears, prepare or resume the Runesmith mission before mutating files. Prefer the highest-level Runesmith tool that matches the live Loop Pulse:

- `runesmith_os_run` for the full autonomous OS loop.
- `runesmith_next` for one engine-selected Runebook action.
- `runesmith_proof_run` when implementation evidence exists and proof is missing or stale.
- `runesmith_risk_resolve` when risk evidence needs a decision summary.
- `runesmith_faultline_resolve` when repeated failed repairs need an architecture path before more patching.

## Completion Discipline

Completion requires current evidence in the runtime capsule. Passing proof must be newer than the latest relevant file change or diagnostic. Plan Contract is the planning-discipline signal: if it is `thin`, split Forge into concrete proof-backed execution slices before broad autonomous work; if it is `blocked`, add or inherit evidence obligations before claiming the map is actionable. Dispatch Matrix is the routing-discipline signal: claim only `ready` slots, preserve `active` leases, do not parallelize `blocked` slots, and use the recommended contract unless there is a stronger runtime reason. Redline Proof is the review-discipline signal: prefer a focused failing proof or proof-file edit before implementation changes, and treat a missing Redline signal as a Review Lens/Seal Audit finding. Repair Contract is the debugging-discipline signal: after failed proof, make one hypothesis-linked implementation change, then rerun the exact failing command before broad verification; broad or blind repair edits become Review Lens/Seal Audit findings. When Proof Plan includes a `Run impacted test` command, run it before broad verification; the engine selected it from captured file changes. Unresolved risk requires later decision evidence. Stale leases must be recovered before unrelated work continues.

If Loop Pulse selects `Review faultline`, stop ordinary patching. Compare the repeated diagnostics, name the architecture or assumption that made local fixes ineffective, choose a redesign/revert/scope split/new hypothesis, call `runesmith_faultline_resolve` with that path, then rerun the focused proof command only after that breakpoint is resolved.

Use Seal Audit as the final completion signal. If it is `collecting-proof`, run the Proof Plan. If it is `blocked`, resolve the listed finding. Only claim completion when Seal Audit is `ready` or `sealed`.

## Fallback

If Runesmith state is missing, call `runesmith_autopilot_prepare` with the latest user goal or let the idle/tool hooks prepare the mission automatically. If the capsule looks invalid, use the Runesmith CLI doctor command from the repository docs. Proof Runner caps stdout/stderr before storing evidence, so read truncation markers as a signal to rerun the focused command manually only when more log detail is actually needed.

For terminal use, prefer `runesmith go "<goal>"` as the first command. It heals setup, prepares or resumes the mission, claims the active task, runs the OS loop, and can launch OpenCode with pass-through args after `--` without asking the user to learn mission ids. Use `runesmith ignite "<goal>"` only when you want the lower-level setup plus mission/loop primitive without launch behavior. Use `runesmith heal` when config, plugin wiring, or the runtime capsule is missing or corrupt. Runtime saves keep a `.runesmith.prev` last-good capsule, and repair restores it before falling back to a fresh empty capsule. The direct OpenCode package plugin also repairs missing or invalid config and capsule files during startup, so normal chat use should not require manual JSON repair.
