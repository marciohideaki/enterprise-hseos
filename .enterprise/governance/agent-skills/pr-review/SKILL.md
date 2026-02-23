---
name: pr-review
description: Enforce PR review standards — quality gates, boundary evidence, contract safety, and governance compliance.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# PR Review

## When to use
Use this skill when:
- performing a pull request review
- acting as a reviewer agent on a PR diff
- generating a PR review report
- validating that a PR is ready to merge

---

## 1. PR Title & Description Standards

- PR-01: PR title MUST follow Conventional Commits: `<type>(<scope>): <imperative summary>`.
- PR-02: PR description MUST include:
  - what changed and why
  - testing approach
  - any breaking changes (explicit declaration)
- PR-03: Breaking changes MUST be declared in the PR description with `⚠ BREAKING:` prefix.
- PR-04: Large PRs (> 400 lines changed) SHOULD be split. If not, justification MUST be provided.

---

## 2. Quality Gate Verification

- PR-05: CI pipeline MUST be fully green — no failing builds, no failing tests.
- PR-06: Test coverage MUST NOT decrease below the baseline established for the service/module.
- PR-07: Lint and static analysis MUST pass without suppressed warnings (unless documented exceptions exist).
- PR-08: No `TODO`, `FIXME`, or `HACK` comments WITHOUT a linked ticket in the PR.
- PR-09: No commented-out code without explanation.
- PR-10: No debug artifacts (console.log, print statements, temporary test data) in production code paths.

---

## 3. Architecture & Boundary Compliance

- PR-11: If the diff touches `domain/`, `application/`, `infrastructure/`, or `api/` folders → `ddd-boundary-check` MUST be applied and its verdict included in the review.
- PR-12: No new direct imports from another bounded context's internal packages.
- PR-13: New modules or packages MUST have documented ownership and BC assignment.
- PR-14: If a new external dependency is introduced → `dependency-audit` MUST be applied.
- PR-15: Architectural deviations MUST have an approved ADR referenced in the PR.

---

## 4. Contract & Breaking Change Safety

- PR-16: If the diff modifies any API endpoint, event schema, DTO, or message contract → `breaking-change-detection` MUST be applied.
- PR-17: Breaking changes require: version bump + CHANGELOG entry + migration guidance + consumer notification.
- PR-18: Additive-only changes (new optional fields) may ship within the same version.
- PR-19: Removed fields, renamed fields, or changed types are ALWAYS breaking — no exceptions.

---

## 5. Security Review

- PR-20: If the diff touches auth, tokens, secrets, PII, new endpoints, crypto, or new dependencies → `secure-coding` MUST be applied and its verdict included.
- PR-21: No secrets, credentials, or tokens in the diff.
- PR-22: New endpoints must have authorization declared.
- PR-23: New dependencies must be reviewed for known CVEs.

---

## 6. Documentation Requirements

- PR-24: All new public APIs, exported functions, exported components, and public classes MUST be documented.
- PR-25: CHANGELOG MUST be updated for any user-facing or consumer-facing behavior change.
- PR-26: Architecture documentation MUST be updated if the change affects service structure, boundaries, or contracts.
- PR-27: README MUST be updated if the change affects setup, configuration, or usage.

---

## 7. Governance & ADR Compliance

- PR-28: Architectural changes (new patterns, new dependencies, boundary modifications, technology additions) MUST reference an approved ADR.
- PR-29: If the PR should have an ADR but does not → the reviewer MUST block and request one before approval.
- PR-30: Standards violations detected during review MUST be listed explicitly — reviewers MUST NOT silently approve non-compliant code.

---

## 8. Review Output Format

When generating a formal review report, the output MUST include:

```
## PR Review Report

**PR:** [title]
**Reviewer:** [agent/human]
**Date:** [date]

### Quality Gates
[PASS/FAIL per gate]

### Architecture Compliance
[Result of ddd-boundary-check if applicable]

### Contract Safety
[Result of breaking-change-detection if applicable]

### Security
[Result of secure-coding if applicable]

### Documentation
[Coverage status]

### Governance
[ADR status, if required]

### Verdict: APPROVED / CHANGES REQUESTED / BLOCKED

### Required Changes (if any)
[Explicit list of blocking items]
```

---

## Examples

✅ Good PR: Green CI, ddd-boundary-check PASS, no breaking changes, public methods documented, ADR attached for new pattern.

❌ Bad PR: Test coverage dropped 15%, `AllowAnonymous` added to endpoint, no CHANGELOG entry for breaking API change, no ADR for new dependency on external service.
