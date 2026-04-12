---
name: systematic-debugging
tier: quick
version: "1.0"
description: "Use when diagnosing a bug, investigating an error, or troubleshooting unexpected behavior before applying any fix"
---

# Systematic Debugging — Quick Protocol

> Tier 1: root cause investigation before any fix attempt.
>
> **Iron Law:** `NEVER fix without identifying root cause first. Symptom fixes are failure.`

## Phase 1 — Root Cause Investigation

- [ ] Read the error message carefully — do not skim
- [ ] Reproduce the failure consistently before touching any code
- [ ] Check recent changes (git log/diff) — 80% of bugs live in the last change
- [ ] Gather evidence: logs, stack traces, state at failure point
- [ ] Trace the data or control flow from input to failure point
- [ ] Isolate: can you reproduce in a minimal test case?

## Phase 2 — Hypothesis

- [ ] Form **one** hypothesis about root cause
- [ ] Validate the hypothesis with a minimal targeted test
- [ ] Do NOT attempt a fix until the hypothesis is confirmed

## Phase 3 — Fix

- [ ] Apply the minimal fix that addresses the confirmed root cause
- [ ] Verify the original failure no longer reproduces
- [ ] Verify no regressions (run test suite)

## Attempt Limit

| Attempts | Action |
|----------|--------|
| 1–2 | Retry with refined hypothesis |
| 3 | **STOP** — escalate to CIPHER or human (see escalation-rules.md §5) |

> If ≥3 fixes have failed: the problem is likely architectural. Do NOT attempt Fix #4.

## Red Flags (Stop Immediately)

- You're modifying tests to make them pass
- You added a try/catch without understanding the exception
- The fix works locally but not in CI
- You're not sure why the fix works

## Forbidden

- Adding workarounds without understanding root cause
- Swallowing exceptions silently
- Hardcoding values to pass a test
