# Agent Skills

> **For human contributors.** AI agents start from `SKILLS-REGISTRY.md` â€” not this README.

---

## What This Directory Is

This is the skill library for AI agents operating under the Enterprise Overlay. Skills are **focused, on-demand enforcement modules** â€” each one knows how to check a specific concern (commit hygiene, DDD boundaries, test coverage, etc.) without loading the full governance stack.

---

## Directory Structure

```
agent-skills/
â”œâ”€â”€ SKILLS-REGISTRY.md              Master registry â€” the ONLY agent entry point
â”œâ”€â”€ accessibility/
â”‚   â”œâ”€â”€ SKILL-QUICK.md              Tier 1: fast rules, pass/fail
â”‚   â””â”€â”€ SKILL.md                    Tier 2: deep analysis, edge cases
â”œâ”€â”€ adr-compliance/
â”‚   â”œâ”€â”€ SKILL-QUICK.md
â”‚   â””â”€â”€ SKILL.md
â”œâ”€â”€ architecture/
â”‚   â”œâ”€â”€ breaking-change-detection/
â”‚   â”‚   â”œâ”€â”€ SKILL-QUICK.md
â”‚   â”‚   â””â”€â”€ SKILL.md
â”‚   â””â”€â”€ ddd-boundary-check/
â”‚       â”œâ”€â”€ SKILL-QUICK.md
â”‚       â””â”€â”€ SKILL.md
â”œâ”€â”€ commit-hygiene/                 Prevents AI/tool attribution in commits
â”‚   â”œâ”€â”€ SKILL-QUICK.md
â”‚   â””â”€â”€ SKILL.md
â”œâ”€â”€ dependency-audit/
â”œâ”€â”€ documentation-completeness/
â”œâ”€â”€ naming-conventions/
â”œâ”€â”€ observability-compliance/
â”œâ”€â”€ performance-profiling/          Only active if PE Standard ADR approved
â”œâ”€â”€ pr-review/
â”œâ”€â”€ release-control/
â”œâ”€â”€ sanitize-comments/              Removes FR/NFR/story refs from code comments
â”œâ”€â”€ secure-coding/
â”œâ”€â”€ spec-driven/
â”œâ”€â”€ test-coverage/
â”œâ”€â”€ agent-permissions/          Least-privilege .codex/settings.json generation
â””â”€â”€ threat-modeling/            AppSec threat modeling (explicit request only)
```

---

## The Two-Tier Model

Every skill has exactly two files:

### Tier 1 â€” `SKILL-QUICK.md`
- Short: typically 1â€“2 pages
- Contains: trigger conditions, rules summary, pass/fail criteria, quick examples
- **Used by default** for every matching task
- Designed for minimal context consumption

### Tier 2 â€” `SKILL.md`
- Full: typically 3â€“8 pages
- Contains: complete algorithm, edge cases, anti-patterns, violation fixing guidance
- **Loaded only when** deep analysis is needed or a violation must be fixed
- Never loaded preemptively

---

## How to Add a New Skill

1. Create a new directory: `agent-skills/<skill-name>/`
2. Create `SKILL-QUICK.md` following this structure:
   ```
   # <Skill Name> â€” Quick Reference
   **Tier:** 1
   **Triggers:** [when agents load this]
   **Pass criteria:** [what makes a check pass]
   **Fail criteria:** [what causes a fail]
   **Rules:** [numbered list, concise]
   ```
3. Create `SKILL.md` following the Tier 2 structure (full algorithm, examples, edge cases)
4. Add an entry to `SKILLS-REGISTRY.md` (v1.x â†’ v1.(x+1)) with:
   - Skill name
   - Trigger conditions
   - Tier 1 path
   - Tier 2 path
5. No other files needed â€” skills are self-contained

---

## Key Design Principles

- **Isolation:** each skill is self-contained; no skill imports another
- **Trigger-based loading:** agents load skills only when triggers match
- **Idempotent:** running a skill twice on the same artifact produces the same result
- **No side effects:** skills read and evaluate; they never write or commit
- **Word-boundary matching:** commit-hygiene uses `\bAI\b` regex to avoid false positives (e.g., "domain" contains "ai" but is never flagged)

