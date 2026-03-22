# ADR-0011 — CORTEX Recall Intelligence

**Status:** Accepted
**Date:** 2026-03-22
**Authors:** HSEOS Knowledge Systems
**Affects Standards:** Memory Architecture, Runtime Context, Knowledge Traceability
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS needs a native way to encode, retrieve, and explain contextual memory without relying on opaque recall behavior.

The current gap is operational:

1. memory items are not layered by immediacy or scope
2. retrieval decisions are not traceable enough for review
3. code-context impact lookup has no native entry point in HSEOS

Wave 1 requires a foundation for observable contextual recall under the HSEOS `CORTEX` identity.

## Decision

HSEOS will introduce **CORTEX Recall Intelligence** as a file-backed, layered context subsystem.

Effective immediately:

- CORTEX stores encoded context in explicit layers
- retrieval exposes a traceable explanation of why items were returned
- HSEOS exposes a lightweight impact query for path/symbol discovery

Public CLI surface:

- `hseos cortex encode <file>`
- `hseos cortex retrieve <query>`
- `hseos cortex trace <query>`
- `hseos cortex impact <term>`

## Consequences

### Positive
- Context retrieval becomes observable and reviewable.
- Memory is organized by layer instead of a flat pool.
- Implementation and review flows gain a native impact probe.

### Negative / Trade-offs
- This is a deterministic file-backed foundation, not a semantic vector system.
- Retrieval quality depends on encoded text and simple scoring in this wave.

### Risks
- Users may assume this is already a full semantic memory platform.
  Mitigation: document the wave boundary clearly and expose the trace so retrieval remains inspectable.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Memory Architecture | Context layers | Adds immediate, scoped, and archive layers |
| Runtime Context | Retrieval traceability | Makes recall explanations explicit |
| Knowledge Traceability | Impact lookup | Adds lightweight structural impact inspection |

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
| Keep memory implicit in prompts only | Not inspectable or institutionally traceable |
| Wait for a heavier semantic index | Leaves HSEOS without native context recall primitives |
| Add an external knowledge product first | Breaks HSEOS coherence and governance locality |
