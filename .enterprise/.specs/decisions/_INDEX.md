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
