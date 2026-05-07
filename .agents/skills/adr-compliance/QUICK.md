---
name: adr-compliance
tier: quick
version: "1.0.0"
description: "Use when reviewing or creating an ADR, or checking whether an ADR is required before proceeding with a change"
---

# ADR Compliance — Quick Check

> Tier 1: use when creating, reviewing, or referencing an ADR.
> Load SKILL.md (Tier 2) for complete format requirements and governance rules.

---

## Checklist (ALL must pass)

**Required Sections**
- [ ] Title follows: `ADR-XXXX — <short-title>`
- [ ] `Status` declared: `Draft` / `Proposed` / `Accepted` / `Deprecated` / `Superseded`
- [ ] `Context` — why this decision is needed
- [ ] `Decision` — what was decided, stated clearly
- [ ] `Alternatives Considered` — at least one alternative documented
- [ ] `Consequences` — trade-offs, risks, and mitigations
- [ ] `Affected Standards` — which specs/standards this ADR modifies or deviates from

**Governance**
- [ ] Filed under `.specs/decisions/ADR-XXXX-<title>.md`
- [ ] Approved by authorized owner before status changes to `Accepted`
- [ ] If superseding another ADR → `Supersedes: ADR-XXXX` declared

---

## Verdict

**PASS** → ADR is complete and correctly structured.
**FAIL** → Missing required sections — load `SKILL.md` (Tier 2) for full format requirements.
