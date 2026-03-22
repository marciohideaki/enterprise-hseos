# Architecture Decision Records — Index

**Shard:** Decision Records
**Path:** `.enterprise/.specs/decisions/`
**Authority:** Stack/Cross override only when explicitly approved and versioned
**Format:** ADR-XXXX (zero-padded 4 digits)

---

## Active Decisions

| ID | Title | Status | Affects |
|---|---|---|---|
| [ADR-0001](./ADR-0001-hexagonal-architecture-mandatory.md) | Hexagonal Architecture as Default | Accepted | All stacks |
| [ADR-0002](./ADR-0002-event-sourcing-opt-in.md) | Event Sourcing is Opt-In | Accepted | All stacks |
| [ADR-0003](./ADR-0003-cqrs-with-relational-source-of-truth.md) | CQRS: Relational DB as Source of Truth, Non-Relational for Read Models | Accepted | All stacks |
| [ADR-0007](./ADR-0007-integration-governance-branching-model.md) | Integration Governance Branching Model | Accepted | Governance, branching |
| [ADR-0008](./ADR-0008-structural-execution-governance.md) | Structural Execution Governance | Accepted | Runtime governance |
| [ADR-0009](./ADR-0009-mission-execution-runtime.md) | Mission Execution Runtime | Accepted | Runtime execution |
| [ADR-0010](./ADR-0010-execution-observability-surface.md) | Execution Observability Surface | Accepted | Operational read models |
| [ADR-0011](./ADR-0011-cortex-recall-intelligence.md) | CORTEX Recall Intelligence | Accepted | Context and memory |
| [ADR-0012](./ADR-0012-runtime-baseline-realignment.md) | Runtime Baseline Realignment | Accepted | Runtime baseline, governance alignment |

---

## Status Definitions

| Status | Meaning |
|---|---|
| **Proposed** | Draft — not yet approved |
| **Accepted** | Approved — binding |
| **Superseded** | Replaced by newer ADR (link to successor) |
| **Deprecated** | No longer applies — link to removal reason |
| **Rejected** | Formally rejected — kept for history |

---

## Rules

- ADRs are append-only — never edit accepted ADRs
- ADRs MUST reference the standard(s) they affect
- ADRs MUST be approved before implementation
- A new ADR is required for: performance standard activation, security exception, architectural deviation, dependency exception
- Use `_TEMPLATE.md` for all new ADRs

---

## Creating a New ADR

1. Copy `_TEMPLATE.md` → `ADR-XXXX-short-title.md`
2. Fill all sections — do not leave placeholders
3. Set status to `Proposed`
4. Submit via PR with affected-standards linked
5. After approval: set status to `Accepted`, add to this index
