---
name: ddd-boundary-check
tier: quick
version: "1.0"
description: "Use when reviewing cross-context dependencies, domain layer violations, or infrastructure leaking into domain code"
---

# DDD Boundary Check — Quick Check

> Tier 1: use for PR review when domain/, application/, infrastructure/, or api/ are touched.
> Load SKILL.md (Tier 2) if a WARN/FAIL is found and fix guidance is needed.

---

## Checklist (ALL must pass)

**Dependency Direction**
- [ ] No `Domain` → `Infrastructure` imports introduced
- [ ] No `Domain` → `API` / delivery imports introduced
- [ ] No `Application` → concrete Infrastructure implementations (must use ports/interfaces)

**Bounded Context Isolation**
- [ ] No direct imports from another context's `domain` or `internal` packages
- [ ] Cross-context interaction occurs only via `contracts/`, `integration/`, `clients/`, or explicit ACL

**Domain Purity**
- [ ] No ORM annotations/attributes inside Domain types
- [ ] No HTTP, broker, or database libraries imported in Domain
- [ ] No direct IO or system calls in Domain (no time, filesystem, network)

**Aggregates & Side Effects**
- [ ] Invariants enforced inside aggregate methods — not in controllers or handlers
- [ ] Side effects (IO, broker publish, DB writes) live in Application/Infrastructure only

---

## Verdict

**PASS** → all items clear.
**WARN** → minor concern, not blocking — note it in PR review.
**FAIL** → blocking violation — load `SKILL.md` (Tier 2) for full fix guidance and refactor plan.
