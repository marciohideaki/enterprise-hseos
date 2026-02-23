# ADR-0001 — Hexagonal Architecture as Mandatory Default

**Status:** Accepted
**Date:** 2024-01-01
**Authors:** Platform Architecture
**Affects Standards:** Hexagonal & Clean Architecture Standard (all sections); all stack Architecture Standards
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

Multiple service implementation approaches existed across teams — layered architecture, transaction script, anemic domain model, and clean architecture variants. This divergence increased onboarding cost, made cross-team code reviews difficult, and violated bounded context isolation.

---

## Decision

We will adopt **Hexagonal Architecture (Ports & Adapters)** as the mandatory default for all backend services across all stacks. The domain layer MUST be free of infrastructure dependencies. All external systems are accessed via ports (interfaces) and adapters (implementations).

---

## Consequences

### Positive
- Consistent architecture across all stacks
- Domain logic is fully testable without infrastructure
- Infrastructure can be replaced without touching domain
- Clear boundaries for agents to validate compliance

### Negative / Trade-offs
- Higher initial complexity for simple CRUD services
- Requires discipline to maintain layer boundaries

### Risks
- Over-engineering for trivial services — mitigated by allowing simplified structure for pure CRUD with explicit ADR exception

---

## Affected Standards

| Standard | Section | Change |
|---|---|---|
| Hexagonal & Clean Architecture Standard | All | Defines mandatory implementation |
| All stack Architecture Standards | §1 | Reference this ADR as authority |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] All stack Architecture Standards aligned
- [x] Activation date: 2024-01-01
- [x] Review date: Permanent (until superseded)

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Layered Architecture (N-tier) | Infrastructure coupling; harder to test domain |
| Transaction Script | No domain model; scales poorly with complexity |
| Per-team choice | Divergence cost too high for cross-team reviews |
