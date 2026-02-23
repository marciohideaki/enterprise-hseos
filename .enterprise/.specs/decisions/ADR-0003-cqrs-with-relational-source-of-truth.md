# ADR-0003 — CQRS: Relational DB as Source of Truth; Non-Relational Allowed for Read Models

**Status:** Accepted
**Date:** 2024-01-01
**Authors:** Platform Architecture
**Affects Standards:** CQRS Standard (CQ-17); Agent Rules Standard (AR-17)
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

A contradiction existed between:
- **AR-17** (Agent Rules Standard): "Relational databases are the only source of truth"
- **CQRS Standard (CQ-17)**: "Read models are derived artifacts — not the source of truth"

This implied that read models stored in Elasticsearch, Redis, or other non-relational stores were compliant, while AR-17's strict reading suggested they were not. Clarification was required.

---

## Decision

The **write side (command model) MUST use a relational database** as the authoritative source of truth for all mutable state. Read models are derived artifacts and **MAY use any storage technology** (relational, document, search index, cache) appropriate to the query pattern, provided:

1. The read model is always reconstructable from the relational write model
2. The read model is never written to directly — only updated via projection/synchronization
3. Read model storage is documented in the service's Architecture Standard

AR-17 is hereby clarified to apply to the write-side only.

---

## Consequences

### Positive
- Resolves ambiguity between AR-17 and CQ-17
- Enables Elasticsearch for full-text search read models
- Enables Redis for low-latency read models
- Maintains single source of truth integrity

### Negative / Trade-offs
- Eventual consistency between write and read models
- Increased infrastructure complexity

### Risks
- Read models becoming stale — mitigated by idempotent projection handlers and monitoring

---

## Affected Standards

| Standard | Section | Change |
|---|---|---|
| Agent Rules Standard | AR-17 | Clarified: relational = write-side source of truth only |
| CQRS Standard | CQ-17 | Confirmed: read models may be non-relational |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Activation date: 2024-01-01
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Relational-only for read models | Prohibitive for full-text search and cache use cases |
| No relational requirement | Loses ACID guarantees on write-side |
