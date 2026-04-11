---
name: spec-driven
tier: quick
version: "1.0.0"
---

# Spec-Driven Development — Quick Check

> Tier 1: use when starting any new feature, service, or significant change.
> Load SKILL.md (Tier 2) for full 4-phase workflow and artifact templates.

---

## Phase Gate Checklist

**Phase 1 — Specify**
- [ ] Feature/service scope defined: what it does and what it does NOT do
- [ ] Functional requirements (FR) listed as acceptance criteria
- [ ] Non-functional requirements (NFR) identified (performance, security, observability, resilience)
- [ ] Out-of-scope items explicitly listed

**Phase 2 — Design**
- [ ] Bounded context and service ownership confirmed
- [ ] Architecture approach documented (patterns: Hexagonal, CQRS, Event Sourcing if applicable)
- [ ] Data model and contracts sketched (API shape, events, DTOs)
- [ ] Integration points with other services identified
- [ ] ADR drafted for non-trivial decisions

**Phase 3 — Tasks**
- [ ] Work decomposed into atomic tasks (each completable in one session/context window)
- [ ] Each task has: description, acceptance criteria, and definition of done
- [ ] Dependencies between tasks identified and sequenced
- [ ] Test strategy defined per task
- [ ] Each task has explicit `input_contract` (files + data needed) and `output_contract` (files + artifacts produced)
- [ ] `execution_mode: isolated` declared — no task depends on chat history from prior tasks

**Phase 4 — Implement**
- [ ] Each task implemented against its acceptance criteria
- [ ] Tests written alongside implementation (not after)
- [ ] PR review gates applied (pr-review skill)

---

## Verdict

**READY** → all phase gates satisfied, proceed.
**BLOCKED** → missing gate — load `SKILL.md` (Tier 2) for full workflow and templates.
