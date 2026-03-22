# ADR-0012 — Runtime Baseline Realignment

**Status:** Accepted
**Date:** 2026-03-22
**Authors:** HSEOS Runtime Architecture
**Affects Standards:** Runtime Operations, Governance Evidence, Operational Read Models, Memory Architecture
**Supersedes:** Wave-boundary portions of ADR-0009, ADR-0010, ADR-0011
**Superseded By:** N/A

---

## Context

HSEOS Wave 1 established four runtime primitives:

1. structural execution governance
2. mission execution runtime
3. execution observability surface
4. CORTEX recall intelligence

Subsequent approved implementation work extended those foundations materially:

- mission runtime gained richer mission metadata and explicit retry control
- structural execution governance became mission-aware
- the observability surface gained approval recording and unified posture aggregation
- CORTEX gained mission-scoped recall injection and impact-aware context attachment

The accepted ADRs and playbooks for ADR-0009, ADR-0010, and ADR-0011 still reflected their
original wave-boundary language. That created a governance drift: code and tests had become more
capable than the accepted architectural record.

## Decision

HSEOS adopts the current post-Wave-1 runtime baseline as the authoritative operational model.

Effective immediately:

- mission runtime includes governed retry as a first-class runtime transition
- runtime retries remain explicit operator actions, not autonomous scheduling
- structural execution governance may evaluate mission context in addition to structural selections
- execution observability includes approval state and posture aggregation, not only read-only summaries
- CORTEX claim-time context injection includes mission-scoped recall and impact traces

This ADR does not replace ADR-0009, ADR-0010, or ADR-0011 as capability origins.
It realigns their accepted operational boundary to match the implemented baseline.

## Consequences

### Positive
- Governance records match the real system operators now run.
- Retry, approval, mission-aware governance, and CORTEX mission context become explicitly sanctioned baseline behavior.
- Future work can build on a stable, documented runtime baseline instead of an implicit one.

### Negative / Trade-offs
- The runtime baseline is now more complex than the original Wave 1 narrative.
- Operational documentation must be maintained more actively to avoid future drift.

### Risks
- Operators may infer that approval or retry implies full control-plane capabilities.
  Mitigation: document that these remain local-first operational controls, not a full orchestration product.

- Teams may overextend mission-aware policy into workflow logic.
  Mitigation: keep policy declarative and runtime control explicit.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Runtime Operations | Mission lifecycle | Adds governed retry and richer mission posture as baseline behavior |
| Governance Evidence | Operational continuation | Recognizes approval recording as part of governed runtime control |
| Operational Read Models | Posture aggregation | Recognizes unified posture as baseline operator surface |
| Memory Architecture | Mission context attachment | Recognizes mission-scoped recall and impact injection during claim |

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
| Keep the older ADRs unchanged and treat new behavior as implementation detail | Leaves accepted architecture materially behind the running system |
| Replace ADR-0009, ADR-0010, and ADR-0011 entirely | Loses the original capability decisions and their provenance |
| Delay architectural realignment until a later wave | Extends governance drift and weakens the enterprise baseline |
