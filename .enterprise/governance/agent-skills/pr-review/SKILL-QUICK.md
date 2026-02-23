---
name: pr-review
tier: quick
version: "1.0.0"
---

# PR Review — Quick Check

> Tier 1: use for every pull request review pass.
> Load SKILL.md (Tier 2) for formal review gates, architectural PRs, or when a failing item needs detailed guidance.

---

## Checklist (ALL must pass)

**Baseline Quality**
- [ ] CI pipeline passes (build, lint, tests)
- [ ] Test coverage not decreased vs baseline
- [ ] No TODO/FIXME/HACK introduced without a linked ticket

**Architecture & Boundaries**
- [ ] If `domain/`, `application/`, `infrastructure/`, or `api/` touched → `ddd-boundary-check` applied
- [ ] No new cross-service direct imports (no internal package leakage between BCs)

**Contracts & Breaking Changes**
- [ ] No breaking changes to API, events, or DTOs without version bump + CHANGELOG entry
- [ ] If contracts changed → `breaking-change-detection` applied

**Security**
- [ ] If auth, tokens, secrets, PII, or new endpoints touched → `secure-coding` applied

**Documentation**
- [ ] Public APIs, exported functions, and components documented
- [ ] CHANGELOG updated if behavior changes

**Governance**
- [ ] If architectural change → ADR attached or referenced
- [ ] PR title follows Conventional Commits format: `<type>(<scope>): <summary>`

---

## Verdict

**PASS** → all items clear, PR may be approved.
**BLOCK** → one or more failing items — reviewer MUST request changes.
