# Architecture Decision Records (ADRs)

> **For human contributors.** AI agents navigate this directory via `_INDEX.md` — not this README.

---

## What This Directory Is

The `decisions/` directory is the **append-only record of all architectural, governance, and operational decisions** that deviate from or extend the default standards. Every significant choice that cannot be derived from existing standards must have an ADR here.

---

## When an ADR is Required

An ADR is REQUIRED for:

| Situation | Example |
|---|---|
| Architectural deviation | Using a non-hexagonal pattern in a specific service |
| Performance Engineering activation | Enabling PE standard for a high-throughput service |
| Event Sourcing activation | Enabling event sourcing for a specific bounded context |
| Security posture change | Relaxing a security requirement with mitigations |
| Breaking API change | Changing a contract in a way that breaks consumers |
| Governance exception | Temporarily deviating from a cross-cutting standard |
| ADR override | A stack standard being overridden by team decision |

An ADR is NOT required for:
- Following existing standards (just follow them)
- Adding a new service that uses default patterns
- Routine refactoring within the same architectural pattern

---

## File Naming

```
ADR-XXXX-<short-title>.md
```

- `XXXX` is zero-padded sequential (ADR-0001, ADR-0002, ...)
- Short title uses kebab-case
- Examples: `ADR-0006-csharp-payment-service-performance-activation.md`

---

## ADR Lifecycle

```
Proposed → Accepted → (Superseded | Deprecated)
                          ↓
                       Rejected (if not accepted)
```

| Status | Meaning |
|---|---|
| **Proposed** | Draft, under review — not yet binding |
| **Accepted** | Approved and binding for the stated scope |
| **Superseded** | Replaced by a newer ADR — link to successor |
| **Deprecated** | No longer applies — reason documented |
| **Rejected** | Formally declined — kept for historical record |

---

## Active ADRs

| ID | Title | Status |
|---|---|---|
| ADR-0001 | Hexagonal Architecture as Default | Accepted |
| ADR-0002 | Event Sourcing is Opt-In | Accepted |
| ADR-0003 | CQRS: Relational DB as Source of Truth | Accepted |
| ADR-0004 | Flutter Architecture Decisions | Accepted |
| ADR-0005 | Performance Engineering Activation (Template) | Template |

See `_INDEX.md` for the full machine-readable list.

---

## How to Create an ADR

1. Copy `_TEMPLATE.md` → `ADR-XXXX-<short-title>.md`
2. Fill ALL sections — no placeholders left open
3. Set status to `Proposed`
4. Submit via PR linking the affected standards
5. After approval: set status to `Accepted`, add to `_INDEX.md`

---

## Golden Rule

> ADRs are **append-only**. Once accepted, an ADR is never edited.
> To change a decision, create a new ADR that supersedes the old one.

This preserves the full decision history and allows agents to reason about why a given rule is in place.
