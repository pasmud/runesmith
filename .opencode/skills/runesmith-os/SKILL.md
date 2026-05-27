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
- Proof Plan chooses verification commands.
- Seal Audit decides whether completion can be claimed.
- Runeweave runs engine-owned actions until a real stop condition appears.

## Direct Use

When a coding goal appears, prepare or resume the Runesmith mission before mutating files. Prefer the highest-level Runesmith tool that matches the live Loop Pulse:

- `runesmith_os_run` for the full autonomous OS loop.
- `runesmith_next` for one engine-selected Runebook action.
- `runesmith_proof_run` when implementation evidence exists and proof is missing or stale.
- `runesmith_risk_resolve` when risk evidence needs a decision summary.

## Completion Discipline

Completion requires current evidence in the runtime capsule. Passing proof must be newer than the latest relevant file change or diagnostic. Unresolved risk requires later decision evidence. Stale leases must be recovered before unrelated work continues.

Use Seal Audit as the final completion signal. If it is `collecting-proof`, run the Proof Plan. If it is `blocked`, resolve the listed finding. Only claim completion when Seal Audit is `ready` or `sealed`.

## Fallback

If Runesmith state is missing, call `runesmith_autopilot_prepare` with the latest user goal or let the idle/tool hooks prepare the mission automatically. If the capsule looks invalid, use the Runesmith CLI doctor command from the repository docs.
