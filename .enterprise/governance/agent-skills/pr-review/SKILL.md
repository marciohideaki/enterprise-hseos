---
name: pr-review
description: Enforce PR review standards — quality gates, boundary evidence, contract safety, and governance compliance. Includes blast radius analysis and adversarial analysis from Trail of Bits differential-review methodology.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "2.0.0"
  enriched-from: .enterprise/governance/references/trailofbits-differential-review.md
---

# PR Review

## When to use
Use this skill when:
- performing a pull request review
- acting as a reviewer agent on a PR diff
- generating a PR review report
- validating that a PR is ready to merge

---

## 0. Risk-Based Triage (Do This First)

Before reviewing the full diff, assess the risk profile to allocate review depth:

**Step 1 — Identify high-risk areas in the diff:**
- Authentication or authorization logic
- Cryptographic operations
- Value transfers or financial logic
- Privilege boundary crossings
- Input validation at trust boundaries
- Shared libraries or platform-wide interfaces

**Step 2 — Assess scope:**
- Total lines changed and files touched
- Number of components affected
- Whether the change is additive-only or modifies existing behavior

**Step 3 — Historical context:**
- Use `git blame` on key modified files to understand evolution
- Check if the modified area has a history of past bugs or regressions
- Look for patterns that have been fixed before but may be reintroduced

**Step 4 — Prioritize:**
Review high-risk areas first and with greater depth. Low-risk areas (documentation, formatting, additive helpers) may receive lighter review. Explicitly state the triage outcome in the review report.

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

## 8. Blast Radius Analysis

For changes with significant scope, quantify impact before approving:

**Caller analysis:**
- How many callers does the modified function/method have? (`grep -r "functionName" --include="*.{ext}"`)
- Are there callers in other services, packages, or bounded contexts?

**Deployment scope:**
- One service (isolated) → standard review
- Shared library (internal) → require evidence callers were checked
- Platform-wide API (external consumers) → require migration guide + consumer notification

**Test gap for consumers:**
- Are there downstream consumers of the changed interface with no tests covering this change?
- If yes → block until coverage is added or consumer sign-off is explicit

**High blast radius PRs require in the description:**
- Explicit scope statement: "This change affects N callers in M services"
- Evidence that callers were checked and remain compatible
- Test coverage for affected consumers or explicit justification for skipping

---

## 9. Adversarial Analysis

Apply attacker thinking to the diff — especially for auth, input validation, and state changes. This is NOT a duplicate of `secure-coding` — it focuses on **logic-level weaknesses** created by the diff in combination with existing code.

**Ask for each significant change:**

| Question | What to look for |
|---|---|
| What assumptions does this change make about inputs? | Preconditions that can be violated by a caller |
| Does this create a race condition or TOCTOU window? | Check-then-act patterns, non-atomic state transitions |
| Does this expand the attack surface? | New permissions, new entry points, new data exposed |
| Is there a bypass path around new guards? | Can the sensitive code be reached without the new check? |
| Does this change break an existing security invariant? | Previously safe code made unsafe by the modification |

**Flag as a finding if:**
- An assumption is clearly violable AND the consequence is a security or correctness impact
- A new bypass path exists in the changed code itself (not a theoretical future issue)

**Do NOT flag:**
- Theoretical future misuse that requires multiple additional changes
- Defense-in-depth improvements (these go to the suggestions section)

---

## 9b. Deep Analysis — Socratic Questioning Pattern

For complex or high-risk PRs, apply the Socratic Analysis pattern before rendering verdicts. Instead of jumping to conclusions, reason through progressively deeper questions.

**5-level question progression:**

| Level | Question type | Example |
|---|---|---|
| L1 — Surface | What does this code do? | "This adds a new endpoint `POST /users/{id}/promote`" |
| L2 — Intent | Why was it written this way? | "It delegates role assignment to the caller — why not validate role permissions server-side?" |
| L3 — Assumption | What must be true for this to be correct? | "This assumes callers are always authenticated — is there an auth gate before this route?" |
| L4 — Failure mode | What breaks if the assumption is violated? | "If an unauthenticated caller reaches this, any user can be promoted to admin" |
| L5 — Systemic | Is this a local bug or a pattern? | "Is auth-bypass-on-promotion a recurring issue in this codebase? Check git blame on similar endpoints" |

**When to apply:**
- Risk triage result is High
- Changes touch auth, trust boundaries, or financial logic
- The reviewer's initial reaction is "this looks fine" — Socratic questioning surfaces non-obvious issues

**Output:** Document the L1-L5 chain for each finding in the Adversarial Analysis section of the review report.

---

## 10. Review Output Format

When generating a formal review report, the output MUST include:

```
## PR Review Report

**PR:** [title]
**Reviewer:** [agent/human]
**Date:** [date]
**Risk triage:** [Low / Medium / High] — [one-line justification]

### Quality Gates
[PASS/FAIL per gate]

### Architecture Compliance
[Result of ddd-boundary-check if applicable]

### Contract Safety
[Result of breaking-change-detection if applicable]

### Security
[Result of secure-coding if applicable — HIGH confidence findings only]

### Blast Radius
[Caller count, deployment scope, consumer test coverage — or N/A if isolated change]

### Adversarial Analysis
[Logic-level weaknesses found in the diff — or CLEAR if none identified]

### Documentation
[Coverage status]

### Governance
[ADR status, if required]

### Verdict: APPROVED / CHANGES REQUESTED / BLOCKED

### Required Changes (if any)
[Explicit list of blocking items with file:line references]
```

---

## Examples

✅ Good PR: Green CI, ddd-boundary-check PASS, no breaking changes, public methods documented, ADR attached for new pattern.

❌ Bad PR: Test coverage dropped 15%, `AllowAnonymous` added to endpoint, no CHANGELOG entry for breaking API change, no ADR for new dependency on external service.
