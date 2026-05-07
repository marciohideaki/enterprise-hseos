---
name: session-handoff
tier: quick
version: "1.0"
description: "Use when ending a work session and a future agent or session must resume the same task without losing context"
---

# Session Handoff — Quick Checklist

> Tier 1: quick protocol to write a HANDOFF.md before ending a session.

## Steps

- [ ] Read current HANDOFF.md if it exists (do not overwrite blindly)
- [ ] Write/update `HANDOFF.md` in project root with the 5 required sections:
  - **Goal** — what this session was trying to accomplish
  - **Current Progress** — what was done, what files were changed
  - **What Worked** — approaches that succeeded (prevents re-trying)
  - **What Didn't Work** — failed attempts with reason (prevents repetition)
  - **Next Steps** — concrete, actionable next actions with file paths
- [ ] If an ADR or exception was drafted but not approved, record its path under Next Steps
- [ ] Tell the user the HANDOFF.md location for the next session

## Template

```markdown
# HANDOFF — <feature or task name>
**Date:** YYYY-MM-DD HH:MM
**Branch:** feature/<name>
**Agent:** <agent code>

## Goal
<one sentence — what this session was working towards>

## Current Progress
- [x] <completed item>
- [ ] <in-progress item — include file paths>

## What Worked
- <approach + why it worked>

## What Didn't Work
- <approach + why it failed — NEVER retry these>

## Next Steps
1. <concrete action with file path>
2. <concrete action with file path>

## Open Questions / Blockers
- <anything that needs human decision or ADR approval>

## Known Gaps
- KG-1: <item discovered but out-of-scope> — impact: <what degrades>
- KG-2: <item> — impact: <...>
```

## Rules

- HANDOFF.md is NOT committed to the repo (add to .gitignore if needed)
- HANDOFF.md is a scratchpad for session continuity, not permanent documentation
- Permanent decisions go to `.enterprise/.specs/decisions/` (ADRs) and the vault
