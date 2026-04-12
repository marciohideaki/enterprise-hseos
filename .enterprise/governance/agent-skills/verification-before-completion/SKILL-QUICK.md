---
name: verification-before-completion
tier: quick
version: "1.0"
description: "Use when about to declare a task, feature, or fix complete — before reporting done to the orchestrator or user"
---

# Verification Before Completion — Quick Gates

> Tier 1: evidence gates before declaring any task complete.
>
> **Iron Law:** `Never say "done" without evidence. Claims without evidence are guesses.`

## Required Evidence Gates

Before marking a task as complete, the following evidence MUST be present:

### Gate 1 — Functional Correctness
- [ ] The primary success path works (manually tested or test output shown)
- [ ] No new test failures introduced (run test suite, show output)
- [ ] Edge cases addressed (null inputs, empty collections, boundary values)

### Gate 2 — Spec Compliance
- [ ] Implementation matches the spec or design document (quote the relevant spec section)
- [ ] If no spec existed: implementation matches the stated acceptance criteria

### Gate 3 — Governance
- [ ] Commit message passes hygiene check (no AI attribution, correct format)
- [ ] No hardcoded secrets, credentials, or PII
- [ ] If architectural change: ADR was created or referenced

### Gate 4 — No Regressions
- [ ] Existing tests still pass
- [ ] Related code paths not broken (manual smoke test if no automated tests)

## Declaration Format

When all gates pass, declare completion as:

```
DONE — [task name]
Evidence:
- Tests: <test command output or screenshot reference>
- Spec compliance: <quote or reference>
- Governance: <commit message shown>
- No regressions: <confirmed via test run>
```

## Partial Completion

If gates cannot all pass, declare as:

```
DONE_WITH_CONCERNS — [task name]
Passed: Gate 1, Gate 3
Not passed: Gate 2 (no spec existed — acceptance criteria assumed: ...)
Concern: <specific concern>
Recommendation: <action needed>
```

## Forbidden

- Saying "done" without showing test output
- Marking complete when tests are skipped or commented out
- Declaring complete when spec compliance is unknown
