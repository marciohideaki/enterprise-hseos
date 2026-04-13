---
name: self-verification
tier: full
version: "1.0"
description: "Use when designing any task to embed a verify_step — the feedback loop that improves output quality 2-3x. Verification is part of task design, not just task completion."
license: Apache-2.0
metadata:
  owner: platform-governance
---

# Self-Verification — Full Protocol

> Tier 2: complete verify_step design patterns, types, and integration with the task contract.

---

## Core Principle

> "Give the agent a way to verify its own work. This feedback loop improves results 2-3x."
> — Boris Cherny, creator of Claude Code

The key insight: verification is most valuable **before** a human sees the output. An agent that can detect its own errors and correct them in-loop produces significantly better results than one that produces output and waits for external feedback.

This is distinct from `verification-before-completion` (which gates DONE declarations). Self-verification is **designed into the task at creation time** — it is part of what makes the task executable.

---

## 1. The verify_step Contract Extension

Every task contract `output_contract` requires a `verify_step`:

```yaml
output_contract:
  files:
    - "src/auth/TokenService.ts"
    - "src/auth/TokenService.test.ts"
  artifacts:
    - "unit tests passing"
  verify_step:
    type: automated
    command: "npm test -- --testPathPattern=TokenService"
    expected: "2 passed, 0 failed"
    fallback: "node -e \"require('./src/auth/TokenService'); console.log('module loads');\""
    on_failure: retry_once_then_escalate
```

### Fields

| Field | Required | Description |
|---|---|---|
| `type` | Yes | `automated` / `manual` / `visual` / `compound` |
| `command` | Yes (automated) | Exact command to run — zero-setup |
| `expected` | Yes | Observable output that confirms success |
| `fallback` | Recommended | Simpler check if primary fails |
| `on_failure` | Optional | `retry_once_then_escalate` (default) / `escalate_immediately` |

---

## 2. verify_step Types

### `automated`
Preferred. Run a test suite, CLI command, or script and compare output.

```yaml
verify_step:
  type: automated
  command: "go test ./internal/auth/... -v -run TestTokenService"
  expected: "PASS"
```

**Design rule:** The command must be idempotent and require no manual setup. If it needs a database, seed it in the command itself or use mocks.

---

### `manual`
For cases where no automated test exists yet (acceptable during early iterations).

```yaml
verify_step:
  type: manual
  steps:
    - "Run: curl -X POST http://localhost:8080/auth/token -d '{...}'"
    - "Assert: HTTP 200 with {token: '...'} in body"
    - "Run: curl -X GET http://localhost:8080/protected -H 'Authorization: Bearer <token>'"
    - "Assert: HTTP 200 (not 401)"
  expected: "Both requests return 2xx"
```

**Design rule:** Steps must be specific enough that a non-author can execute them. "Test the endpoint" is not a valid manual verify_step.

---

### `visual`
For UI changes where behavior is observable but not easily machine-tested.

```yaml
verify_step:
  type: visual
  url: "http://localhost:3000/dashboard"
  before_screenshot: "screenshots/dashboard-before.png"
  check:
    - "Chart renders with colored bars per model"
    - "Legend shows model names"
    - "No layout overflow at 1280px"
```

**Design rule:** State what to look for explicitly. "Looks correct" is not a valid visual check.

---

### `compound`
Multiple verification methods chained — primary must pass, secondary confirms.

```yaml
verify_step:
  type: compound
  primary:
    type: automated
    command: "npm test"
    expected: "all passing"
  secondary:
    type: manual
    steps:
      - "Open browser at http://localhost:3000"
      - "Confirm new feature is visible"
```

---

## 3. Self-Correction Loop

When verify_step fails, the agent enters a self-correction loop before escalating:

```
verify_step FAILS
      ↓
Diagnose: read error output (L4 context)
      ↓
Form one hypothesis (systematic-debugging §3.1)
      ↓
Apply minimal fix (simplicity-first §3)
      ↓
Re-run verify_step
      ↓
PASS → declare DONE with evidence
FAIL (2nd attempt) → escalate (NEEDS_REVIEW)
```

**Maximum self-correction attempts:** 2. If verify_step fails twice, escalate — do not iterate indefinitely.

---

## 4. Designing verify_steps at Task Creation

When writing tasks in `tasks.md`, for every task ask:

1. **What is the observable signal that this task is done?**
   Good: "Test X passes" / "Endpoint returns 200" / "Migration runs without error"
   Bad: "Implementation looks correct" / "Should work"

2. **Can the agent run this check without human involvement?**
   If no → design a manual verify_step with exact steps.

3. **What would a failing verify_step look like?**
   State the failure signal too — this prevents false positives.

4. **Is the verify_step testing the acceptance criteria, not just that code runs?**
   Running without errors ≠ meeting acceptance criteria.

---

## 5. verify_step vs verification-before-completion Gates

These are complementary, not redundant:

| | `self-verification` (this skill) | `verification-before-completion` |
|---|---|---|
| **When** | Designed at task creation | Applied before declaring DONE |
| **Who defines** | Task author (at spec time) | Agent (at completion time) |
| **Purpose** | Enable self-correction loop | Confirm all gates passed |
| **Format** | `verify_step` in output_contract | DONE / DONE_WITH_CONCERNS declaration |
| **Frequency** | Every task | Every task |

Use both. `self-verification` catches errors during implementation. `verification-before-completion` confirms the final state is correct.

---

## 6. CLAUDE.md Update Cadence (Meta-Verification)

Boris Cherny updates CLAUDE.md *"multiple times a week, always when the agent makes a mistake."*

This is a form of system-level self-verification: the governance document is a feedback artifact, not a static reference.

**Rule for HSEOS:** When an agent produces an incorrect output due to a missing or ambiguous rule in CLAUDE.md or any SKILL.md, update the relevant document before closing the session. The error is not fully resolved until the document is updated.

---

## Relationship to Other Skills

- `spec-driven` — `verify_step` extends the task contract defined in Phase 3
- `verification-before-completion` — self-verification runs during implementation; vbc gates the final declaration
- `systematic-debugging` — self-correction loop uses the 4-phase debug protocol
- `simplicity-first` — fixes during self-correction must be minimal (Surgical Changes rule)
