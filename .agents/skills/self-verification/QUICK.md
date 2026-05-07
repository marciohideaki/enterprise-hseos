---
name: self-verification
tier: quick
version: "1.0"
description: "Use when designing any task to embed a verify_step — the feedback loop that improves output quality 2-3x. Verification is part of task design, not just task completion."
license: Apache-2.0
metadata:
  owner: platform-governance
---

# Self-Verification — Quick Reference

## Core Insight

> "Give the agent a way to verify its own work. This feedback loop improves results 2-3x."
> — Boris Cherny, creator of Claude Code

Verification is not a checklist at the end. It is a **mechanism designed into the task** before implementation begins.

---

## verify_step (Required in Every Task Contract)

Every task's `output_contract` MUST include a `verify_step`:

```yaml
output_contract:
  files:
    - "src/service/handler.ts"
  verify_step:
    type: automated          # automated | manual | visual
    command: "npm test -- handler"   # exact command to run
    expected: "1 passing, 0 failing"
    fallback: "open http://localhost:3000/health — expect 200"
```

### verify_step Types

| Type | When | Example |
|---|---|---|
| `automated` | Unit/integration tests exist | `pytest tests/test_handler.py -v` |
| `manual` | No automated test — functional check | Run `curl` + assert response |
| `visual` | UI change | Screenshot before/after, confirm layout |

---

## Verification Before vs After

| Without verify_step | With verify_step |
|---|---|
| Agent declares done by inspection | Agent runs check, shows output |
| Errors found at PR review | Errors found by agent, fixed before PR |
| Multiple back-and-forth iterations | Self-correcting in one pass |
| Human confirms correctness | Evidence confirms correctness |

---

## Quick Checklist

- [ ] Every task has a `verify_step` in `output_contract`
- [ ] `verify_step.command` is runnable with zero setup
- [ ] Expected output is stated (not "it should work")
- [ ] Fallback exists if primary verify_step fails
- [ ] Agent ran verify_step and shows output before declaring DONE
