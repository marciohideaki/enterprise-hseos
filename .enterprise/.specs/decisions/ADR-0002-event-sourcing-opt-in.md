# ADR-0002 — Event Sourcing is Opt-In

**Status:** Accepted
**Date:** 2024-01-01
**Authors:** Platform Architecture
**Affects Standards:** Event Sourcing Standard (ES-01); CQRS Standard (CQ-02)
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

Event Sourcing was discussed as a default pattern for all services. However, the operational complexity — event schema versioning, snapshot management, event store infrastructure — creates disproportionate overhead for services that do not benefit from full event history or temporal queries.

---

## Decision

**Event Sourcing is opt-in.** A service must have an approved ADR (referencing this one) before adopting Event Sourcing. Services not explicitly activated remain on standard CRUD persistence with CQRS read-model projection.

---

## Consequences

### Positive
- Reduces operational complexity for simple services
- Event Sourcing applied only where value is clear
- Standard CQRS model (relational write + projected read) is sufficient for most cases

### Negative / Trade-offs
- Services that might benefit may not adopt it proactively
- Requires explicit ADR to activate — adds process overhead for early stages

### Risks
- Teams may retroactively need Event Sourcing — migration path is complex. Mitigated by designing domain events from the start even without full ES.

---

## Affected Standards

| Standard | Section | Change |
|---|---|---|
| Event Sourcing Standard | ES-01 | Confirms opt-in; activation requires child ADR |
| CQRS Standard | CQ-02 | Read models may derive from relational projections, not event log, by default |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Event Sourcing Standard updated (ES-01)
- [x] Activation date: 2024-01-01
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Event Sourcing mandatory | Too costly for simple services; operational burden unacceptable |
| Event Sourcing forbidden | Loses value for complex audit-trail and temporal-query use cases |
