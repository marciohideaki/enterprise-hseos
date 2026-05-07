---
name: project-state
tier: quick
version: "1.0"
description: "Use when determining current project delivery state, restoring session context, or reading task backlog"
---

# Project State — Quick Reference

> Tier 1: use when reading, writing, or routing project state (STATE.md / TASKS.md).
> Load SKILL.md (Tier 2) for full detection algorithm, SQLite schema, MCP protocol, and fallback rules.

---

## What this skill manages

Two live files per project:

| File | Purpose | Owner |
|---|---|---|
| `STATE.md` | Current project snapshot — active branch, feature status, deployment state | ORBIT, SABLE, FORGE |
| `TASKS.md` | Backlog — pending, in-progress, blocked tasks with IDs and owners | ORBIT, RAZOR, GHOST |

**Rule:** Every agent that modifies project state MUST update these files before handing off to the next agent.

---

## Mode detection (run at session start)

```
1. Check hseos.config.yaml → state_management.mode
2. If mode = hybrid → probe availability (see SKILL.md §3)
3. Route to the active backend
```

| Mode | Backend | Fallback |
|---|---|---|
| `mcp-sqlite` | MCP server on localhost:3100 | → cli-sqlite |
| `cli-sqlite` | project-state.sh / project-state.ps1 | → skill-only |
| `skill-only` | Direct markdown writes | none |
| `hybrid` | Auto-detect at runtime | MCP → CLI → Markdown |

---

## Quick write — STATE.md

Always update these fields when state changes:

```markdown
## Current State
- **branch:** feature/my-feature
- **phase:** execution
- **active_agent:** GHOST
- **last_updated:** 2026-04-11T14:00:00Z
- **status:** in_progress | blocked | completed
```

---

## Quick write — TASKS.md

Task entry format:

```markdown
- [ ] T1 — [GHOST] Description of task (depends: none)
- [x] T2 — [RAZOR] Completed task description
- [~] T3 — [ORBIT] Blocked: waiting on T1
```

Status: `[ ]` pending | `[x]` done | `[~]` blocked

---

## Pruning rule

Remove tasks from TASKS.md when ALL are true:
- Status is `[x]`
- More than 5 tasks completed since last prune
- No open task depends on the completed one

---

## When to update STATE.md vs TASKS.md

| Event | Update STATE.md | Update TASKS.md |
|---|---|---|
| Phase transition | Yes | No |
| Task completed | No | Yes — mark `[x]` |
| Task blocked | Yes (status=blocked) | Yes — mark `[~]` |
| Agent hand-off | Yes (active_agent) | No |
| Deploy completed | Yes (phase, status) | Yes — mark `[x]` |
