---
name: verification-before-completion
tier: full
version: "1.0"
description: "Use when about to declare a task, feature, or fix complete — before reporting done to the orchestrator or user"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
  inspired-by: superpowers/skills/verification-before-completion
---

# Verification Before Completion — Full Protocol

> Tier 2: complete evidence-based completion gates with declaration format and partial completion protocol.

---

## Iron Law

```
Never declare a task complete without evidence.
"It should work" is not evidence.
"I believe it's fixed" is not evidence.
Evidence is observable output — test results, logs, or screenshots.
```

---

## Why This Matters

Premature completion declarations:
1. Cause downstream agents to build on incorrect foundations
2. Create false confidence in delivery readiness
3. Make it impossible to determine where a defect was introduced
4. Waste orchestrator time re-dispatching already-"completed" tasks

---

## Evidence Gates

### Gate 1 — Functional Correctness

**Required evidence:**
- Test output showing the primary success path passes
- OR screenshot/log demonstrating the behavior if no automated test exists
- Edge cases verified: null/empty inputs, boundary values, error paths

```bash
# Show test output — not just "tests pass"
npm test -- --verbose 2>&1 | tail -30
# OR
go test ./... -v 2>&1 | tail -30
# OR
pytest -v 2>&1 | tail -30
```

**Minimum bar:** The stated acceptance criteria are demonstrably met.

### Gate 2 — Spec Compliance

**Required evidence:**
- Quote the specific spec section or acceptance criteria that was implemented
- OR if no spec: document the assumed acceptance criteria explicitly

```markdown
Spec compliance: `.enterprise/.specs/...FeatureSpec.md §3.2`
> "The service MUST return 404 when the resource does not exist"
Verified: `GET /api/resource/nonexistent` returns HTTP 404 ✓
```

**If spec is absent or ambiguous:** This is an escalation trigger — do not assume.

### Gate 3 — Governance

**Required evidence:**
- Commit message shown (not just claimed) — must pass commit-hygiene checks
- No hardcoded secrets (grep scan result)
- If architectural change: ADR reference or confirmation no ADR was required

```bash
# Show the commit message
git log -1 --format="%s%n%b"

# Show secret scan
grep -rE "(password|secret|api_key|token)\s*=" --include="*.{ts,go,java,py}" .
```

### Gate 4 — No Regressions

**Required evidence:**
- Full test suite output (or relevant suite for the changed module)
- Confirmation that tests that were passing before still pass

```bash
# Before: record passing count
# After: confirm same or more passing, zero new failures
```

---

## Declaration Format

### Full Completion

```
DONE — [task name]
──────────────────────────────
Gate 1 (Functional): ✓
  Tests: [paste relevant test output lines]
  
Gate 2 (Spec):       ✓
  Reference: [spec section or acceptance criteria quoted]
  
Gate 3 (Governance): ✓
  Commit: [paste commit subject line]
  
Gate 4 (Regressions): ✓
  Suite: [X passing, 0 failing, 0 new failures]
──────────────────────────────
```

### Partial Completion (DONE_WITH_CONCERNS)

When a gate cannot be fully passed, use this format — do NOT silently mark complete:

```
DONE_WITH_CONCERNS — [task name]
──────────────────────────────
Gate 1 (Functional): ✓
Gate 2 (Spec):       ⚠ CONCERN
  Reason: No spec existed; assumed acceptance criteria: [state assumption]
  Risk: Assumption may not match stakeholder intent
  Recommendation: Validate assumption before merging
Gate 3 (Governance): ✓
Gate 4 (Regressions): ✓
──────────────────────────────
```

### Blocked (NEEDS_REVIEW)

```
NEEDS_REVIEW — [task name]
──────────────────────────────
Gate 1 (Functional): ✗ BLOCKED
  Reason: Cannot demonstrate functional correctness — [specific reason]
  Evidence available: [what you CAN show]
  Required action: [what human/agent must do]
──────────────────────────────
```

---

## Integration with Workflows

### GHOST (Code Executor)
- Apply verification before reporting task complete to ORBIT
- Use DONE / DONE_WITH_CONCERNS / NEEDS_REVIEW format in task response

### GLITCH (Chaos Engineer)
- GLITCH validates Gate 1 (functional) and Gate 4 (regressions)
- GLITCH's pass = external validation of Gate 1 and Gate 4
- GHOST still owns Gate 2 (spec) and Gate 3 (governance)

### ORBIT (Flow Conductor)
- ORBIT accepts tasks marked DONE or DONE_WITH_CONCERNS (with concern noted)
- ORBIT escalates tasks marked NEEDS_REVIEW
- ORBIT does NOT accept implicit "I think it's done" declarations

---

## Anti-Patterns

| Anti-Pattern | Consequence |
|---|---|
| "The tests should pass" | Builds on unverified foundation |
| "I fixed it, trust me" | Untraceable — no evidence chain |
| Skipping Gate 2 because no spec exists | Assumption drift goes undetected |
| Showing partial test output | Hides failures in untested paths |
| Marking done to avoid running a slow test suite | Regressions ship to production |

---

## Relationship to Other Skills

- `test-coverage` — ensures Gate 1 has adequate test surface
- `systematic-debugging` — use before completing a bug fix task
- `pr-review` — Gates 1-4 map directly to PR review criteria
- `delivery-readiness` workflow — phase-level equivalent of this per-task skill
