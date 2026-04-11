---
name: context-policy
tier: quick
version: "1.0"
---

# Context Policy — Quick Reference

> Tier 1: use when a session is growing long, quality of output is degrading, or deciding how to size tasks.
> Load SKILL.md (Tier 2) for full policy, sizing guidelines per agent, and session resume protocol.
> Source: AI-SDLC v1.0 §4 (Stateless Execution) and §6 (Context Policy).

---

## Context Budget Limits

| Status | Threshold | Action |
|---|---|---|
| **Ideal** | ≤ 40% context used | Continue normally |
| **Warning** | 40%–60% context used | Finish current task; plan session boundary |
| **Critical** | > 60% context used | Stop current task; save state; start new session |
| **Blocked** | > 60% (with middleware) | Execution blocked automatically |

---

## Signals That Context Is Growing Too Large

- You have read > 15 files in the current session
- The session has spanned > 3 major topics or task groups
- Output quality is degrading (shorter, less specific answers)
- Agent is losing track of earlier decisions made in the session
- The task being attempted is "large" (scope > 200 lines of new code)

---

## Action by Signal

| Signal | Action |
|---|---|
| Warning threshold reached | Finish the current atomic task; commit; close session |
| Critical threshold reached | Stop immediately; save artifact/state; open new session from contract |
| Story too large for one session | Split into smaller tasks with explicit `input_contract` / `output_contract` |
| Output degrading mid-session | Do not continue; save progress; resume stateless from task contract |

---

## Per-Agent Guidelines

| Agent | Context rule |
|---|---|
| **GHOST** | 1 story = 1 session. If story scope > 200 lines, split the story before starting. |
| **ORBIT** | Resume always from `.hseos-output/<epic>/state.yaml` — never from conversation history |
| **BLITZ** | Scope must fit in one session. If scope grows beyond one context, escalate to ORBIT + GHOST. |
| **CIPHER** | ADR drafts and architecture docs: one document per session. Never mix feature + architecture in one session. |
| **All agents** | Never pass context from one task to another via chat. Use `input_contract` files instead. |

---

## Stateless Execution Principle

Every task execution MUST be resumable from its `input_contract` alone — without access to prior conversation history. If a task cannot be started cold from its contract, the contract is incomplete.
