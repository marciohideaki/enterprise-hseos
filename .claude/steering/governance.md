---
inclusion: auto
description: Core HSEOS governance rules — always active in every session
---

# HSEOS Governance — Always Active

## Authority Order
1. Enterprise Constitution (`.enterprise/.specs/constitution/Enterprise-Constitution.md`)
2. Core Standards (`.enterprise/.specs/core/`)
3. Cross-Cutting Standards (`.enterprise/.specs/cross/`)
4. Stack Standards (`.enterprise/.specs/<Stack>/`)
5. ADRs (`.enterprise/.specs/decisions/`)

## Non-Negotiable Rules

**Stop Immediately If:**
- Requirements are ambiguous
- Two standards conflict
- An ADR is required but missing
- Scope exceeds agent authority

**Never:**
- Commit to `main`, `master`, or `develop`
- Merge pull requests (human approval required)
- Add `Co-Authored-By` trailers
- Mention AI tools in commit messages (Claude, Codex, GPT, LLM, etc.)
- Silently deviate from a standard

**Always:**
- Read `SKILLS-REGISTRY.md` before any task
- Work in `feature/*` branches, tasks in `task/*` branches
- Create an ADR for architectural, breaking, security, or performance changes
- Use `./scripts/governance/worktree-manager.sh` for task isolation

## Commit Format
`<type>(<scope>): <summary>` — types: feat fix docs style refactor test chore ci build

## Skills Loading
```
1. Read SKILLS-REGISTRY.md → match triggers
2. Load SKILL-QUICK.md (Tier 1) — default
3. Load SKILL.md (Tier 2) — only for deep analysis
4. Never load all skills simultaneously
```

## ADR Required For
Architectural change · Breaking change · Security posture change · Performance-affecting change · Governance modification · Exception to any standard

## Token Discipline (Active Every Session)

Before any tool call, apply these rules:

| Check | Rule |
|-------|------|
| Already in a skill or memory? | Trust it. Skip the file read. |
| Is this call speculative? | Kill it. |
| Can calls run in parallel? | Parallelize. |
| Output > 20 lines you won't use? | Route to subagent. |
| About to restate what the user said? | Delete it. |

**Read discipline:** Grep before Read. Never read a whole file to find one function or string.  
**Session cost:** Pay the context load cost ONCE at session start. Don't re-read the same file across tool calls.
