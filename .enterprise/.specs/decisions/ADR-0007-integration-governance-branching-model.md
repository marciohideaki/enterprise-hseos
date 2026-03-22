# ADR-0007 — Integration Governance Branching Model

**Status:** Accepted
**Date:** 2026-03-22
**Authors:** HSEOS Governance
**Affects Standards:** Git Workflow Playbook §3, AGENTS.md §1, CLAUDE.md Execution Governance
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS governance already required a GitFlow-style branching model with a dedicated integration branch,
but the repository was still operating effectively from `master` plus ad hoc feature branches.

That mismatch created three governance problems:

1. The written policy and the real repository state diverged.
2. Multi-PR feature waves had no official integration trunk for staged consolidation.
3. AI and human contributors had no single authoritative branch for assembling non-production-ready,
   but governance-compliant, changes.

Wave 1 capability consolidation requires several independent feature branches and PRs that must remain
 isolated from production-ready history while still integrating cleanly before promotion.

## Decision

We will establish `develop` as the authoritative integration branch for HSEOS.

Effective immediately:

- `master` remains the stable branch.
- `develop` becomes the required target for feature integration.
- all new `feature/*` branches for multi-step capability delivery are cut from `develop`.
- `master` promotion happens only through a later controlled integration/release decision.

This ADR does not change protected-branch rules. Direct commits to `master`, `main`, or `develop`
remain forbidden.

## Consequences

### Positive
- Governance policy now matches repository reality.
- Multi-branch feature delivery can proceed without contaminating the stable branch.
- PR sequencing becomes auditable and operationally clearer.

### Negative / Trade-offs
- Branch management becomes slightly more complex.
- Existing contributors must understand the new `develop` target for future work.

### Risks
- Contributors may continue targeting `master` by habit.
  Mitigation: update playbooks and human-facing governance docs to reference `develop` explicitly.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Git Workflow Playbook | §3 Branching Strategy | Clarifies that `develop` is now active and mandatory as integration branch |
| AGENTS.md | §1 Execution Governance | Clarifies that task isolation and feature work must target branches derived from `develop` |
| CLAUDE.md | Execution Governance | Clarifies that staged integration flows through `develop` |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Teams notified
- [x] Activation date: 2026-03-22
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Continue using `master` as both stable and integration branch | Violates the stated GitFlow policy and weakens branch hygiene |
| Use a temporary feature branch as wave integration trunk | Hides integration semantics and makes the repository harder to audit |
| Delay `develop` activation until after Wave 1 | Would force the consolidation to begin in a governance-inconsistent state |
