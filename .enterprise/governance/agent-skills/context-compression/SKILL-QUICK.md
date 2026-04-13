---
name: context-compression
tier: quick
version: "1.0"
description: "Use when context window is approaching its limit, when resuming a long session, or when a session handoff needs to preserve maximum information in minimum tokens."
license: Apache-2.0
metadata:
  owner: platform-governance
---

# Context Compression — Quick Reference

## When to Compress

| Signal | Action |
|---|---|
| Context feels "heavy" — responses becoming generic | Apply `summarize-recent` |
| Switching tasks after long implementation streak | Apply `compress-by-task` |
| About to hand off session to next agent | Apply `tree-structured` |
| Context window approaching limit (>70% used) | Apply `emergency-strip` |
| Session resuming from HANDOFF.md | Load compressed L5 only |

---

## Compression Strategies (Choose One Per Situation)

### 1. `summarize-recent` — Default for long sessions
Summarize the last N turns into a single paragraph preserving:
decisions made, files changed, current state, what's next.
Discard: exploratory dialogue, failed attempts detail, verbose outputs.

### 2. `compress-by-task` — For task switches
Group context by task boundary. For each completed task keep:
`task name | outcome (DONE/BLOCKED) | key decision | files changed`.
Discard: implementation detail of completed tasks.

### 3. `tree-structured` — For handoffs
Keep only the decision tree: what was decided and why.
Format: `Problem → Options considered → Decision → Consequence`.
Discard: all implementation detail, exploratory reasoning.

### 4. `error-only` — For active debugging sessions
Keep only: current error, current hypothesis, last 2 attempts.
Discard: all context unrelated to the active bug.

### 5. `emergency-strip` — When context is critical (>90% used)
Keep only: L1 (Rules), current task contract, current error (if any).
Discard: everything else. Load L2/L3 fresh from files.

---

## What to ALWAYS Preserve (Never Compress Away)

- L1 context (CLAUDE.md, Constitution, SKILLS-REGISTRY) — reload from file if needed
- Current task's `acceptance_criteria`
- Any unresolved BLOCKED state
- Open questions requiring human resolution
- Last confirmed DONE gate state

---

## Output Format for Compressed Context

```
[COMPRESSED — {strategy} — {timestamp}]
Completed: {list of done tasks}
Current: {active task name} — {status}
Key decisions: {decision 1}; {decision 2}
Files changed: {file list}
Next: {immediate next action}
Open: {unresolved questions}
```
