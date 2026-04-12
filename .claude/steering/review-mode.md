---
inclusion: manual
description: Code review context — invoke with #review-mode when performing PR or code review
---

# Review Mode — Code Review Context

> Invoke with `#review-mode` when reviewing a pull request or performing code review.

## Two-Stage Review Protocol

**Stage 1 — Spec Compliance (First)**
Before evaluating code quality, verify the implementation matches its specification:
- Does it fulfill the stated acceptance criteria?
- Does it match the ADR or design doc if one exists?
- Are contract changes handled with versioning?

**Stage 2 — Code Quality (Second, only after Stage 1 passes)**
- Functions ≤ 50 lines, nesting ≤ 4 levels
- No mutation patterns where immutability is feasible
- Error handling at I/O boundaries
- No hardcoded values that belong in config
- Test coverage adequate for the change

## Load These Skills

```
pr-review       → Tier 1 (always)
secure-coding   → Tier 1 (if auth/crypto/PII touched)
breaking-change-detection → Tier 1 (if APIs/events changed)
ddd-boundary-check → Tier 1 (if domain/ layers touched)
```

## Severity Classification

| Severity | Action |
|----------|--------|
| CRITICAL | Block merge — must fix before merge |
| HIGH | Warn — merge with explicit acknowledgment |
| MEDIUM | Recommend — fix in follow-up |
| LOW | Suggest — optional improvement |

## Blast Radius Check
For every change, state:
- What code paths are affected?
- What consumers could break?
- What rollback strategy exists?
