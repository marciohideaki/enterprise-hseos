# A4 Checkpoint — Durable Context Assembly and Token Budget

**Artifact type:** Governed goal checkpoint
**Scope:** A4 deterministic context precedence, durable lineage, provider-bound budgets and bounded overflow
**Governing documents:** Enterprise Constitution; ADR-0001; ADR-0024; Automated Validation Rules

## Accepted deliverables

- `@hseos/agent-context` exposes one fail-closed `ContextAssembler.assembleAndRecord` operation; no model request is returned until its exact request, sources, budget and overflow decision are appended and reconstructed.
- Constitution, project, adapter, agent and skill instructions are ordered deterministically. Runtime, reference and memory blocks are quoted as data; the current durable user turn is always last.
- Completed history is derived from the session ledger as a contiguous suffix. Callers cannot inject history, replace the provider manifest or widen the remaining session budget.
- Provider limits come from a nominal immutable registry snapshot. Session accounting debits prior input budgets and either durable output usage or the full output reservation when usage telemetry is absent.
- Messages, tool definitions and model parameters participate in deterministic accounting. Optional overflow removes whole recent-history/memory entries and durably records every omission.
- `hseos.context/v1` makes A4 events distinguishable and mandatory. Replay enforces the preamble, constitution/project layers, source and tool lineage, durable final turn, provider/model identity, history continuity and balanced budget.
- Source, message, tool, parameter and reference bounds fail closed; secret-classified sources and credential-bearing schema fields are rejected before append.

## Independent refutation and corrections

Independent review caused corrections for duck-typed stores, unchecked append receipts, caller-controlled history and provider limits, paired counter drift, unbounded parameters/references, direct `context.assembled` forgery and missing session accounting for providers without `usage`. The final rerun reproduced none of those bypasses and found no residual BLOCKER/HIGH/MEDIUM issue.

## Verification

- `npm run test:agent-context` — 9/9.
- `npm run test:agentic-contracts` — 9/9.
- `npm run test:agentic-session-store` — 7/7.
- `npm run test:model-providers` — 14/14.
- `npm test` — passed.
- Strict code gate — 0 failures, 1 unrelated pre-existing documentation warning.
- Gate log — `.logs/validation/gate-20260822T024106.log`.
- Gate SHA-256 — `3040e4d1d44832f373b11d5543e15b1ba70677aa797817ecee1377b5521f71d2`.
- Independent verifier — `READY`; no residual BLOCKER/HIGH/MEDIUM.
- Contracts, session store, providers and context packages pack, install together and load from a clean temporary prefix.

## Boundary and rollback

No real credential, provider call, operational database, merge, push, PR, deployment or activation was touched. Before activation, rollback is the single A4 task commit. After activation, retain canonical session events and disable the context profile rather than rewriting history.

## Next node

A5 may integrate the general `ToolRuntime` with governed execution. Any classified effect must remain behind the governed port and preserve pre/guard/approval/dispatch/post/result ordering.
