# ADR-0009 — Mission Execution Runtime

**Status:** Accepted
**Date:** 2026-03-22
**Authors:** HSEOS Runtime Systems
**Affects Standards:** Runtime Operations, Execution Governance, Worktree Isolation
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS defines strong institutional roles and phase discipline, but it lacked a native runtime adapter
for queueable work items that could be claimed, isolated, reconciled, and inspected consistently.

That created an execution gap:

1. External or queued work items had no canonical path into HSEOS runtime state.
2. Execution evidence for queued work lacked a stable runtime record.
3. Workspace isolation for mission-style execution was left to ad hoc operator behavior.

Wave 1 requires a concrete execution runtime that remains HSEOS-native and auditable.

## Decision

HSEOS will introduce a **Mission Execution Runtime** as a native runtime adapter for work items.

Effective immediately:

- a work item can be claimed through `hseos run work-item <input>`
- runtime state is persisted under `.hseos/data/runtime/`
- each claimed work item receives an isolated workspace directory and runtime manifest
- runtime state can be reconciled through `hseos run reconcile`
- runtime status can be inspected through `hseos run status <id>`

This runtime does not bypass existing governance. It creates isolated, auditable mission state that
later execution layers can consume.

## Consequences

### Positive
- HSEOS gains a deterministic execution surface for queued work.
- Claim, reconcile, and status transitions become explicit runtime artifacts.
- Workspace isolation becomes visible and repeatable.

### Negative / Trade-offs
- Runtime state management introduces new operational files under `.hseos/data/runtime/`.
- This is a foundation layer; it does not yet execute downstream agent work automatically.

### Risks
- Operators may overestimate this runtime as a full orchestration engine.
  Mitigation: document it clearly as a foundational adapter and evidence layer.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Runtime Operations | Mission handling | Adds claim, reconcile, status, and isolated workspace state |
| Execution Governance | Runtime traceability | Requires persisted state and evidence per mission |
| Worktree Isolation | Workspace discipline | Establishes isolated mission workspace directories |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Activation date: 2026-03-22
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep mission handling as operator convention only | Not auditable or structurally enforceable |
| Introduce an external orchestration product | Breaks HSEOS coherence and governance locality |
| Delay runtime state until a full control plane exists | Leaves queued execution without institutional traceability |
