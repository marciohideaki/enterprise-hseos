# Agent Skills

> **For human contributors.** AI agents start from `SKILLS-REGISTRY.md` — not this README.

---

## What This Directory Is

This is the skill library for AI agents operating under the Enterprise Overlay. Skills are **focused, on-demand enforcement modules** — each one knows how to check a specific concern (commit hygiene, DDD boundaries, test coverage, etc.) without loading the full governance stack.

---

## Directory Structure

```
agent-skills/
├── SKILLS-REGISTRY.md              Master registry — the ONLY agent entry point
├── accessibility/
│   ├── SKILL-QUICK.md              Tier 1: fast rules, pass/fail
│   └── SKILL.md                    Tier 2: deep analysis, edge cases
├── adr-compliance/
│   ├── SKILL-QUICK.md
│   └── SKILL.md
├── architecture/
│   ├── breaking-change-detection/
│   │   ├── SKILL-QUICK.md
│   │   └── SKILL.md
│   └── ddd-boundary-check/
│       ├── SKILL-QUICK.md
│       └── SKILL.md
├── commit-hygiene/                 Prevents AI/tool attribution in commits
│   ├── SKILL-QUICK.md
│   └── SKILL.md
├── dependency-audit/
├── documentation-completeness/
├── naming-conventions/
├── observability-compliance/
├── performance-profiling/          Only active if PE Standard ADR approved
├── pr-review/
├── release-control/
├── sanitize-comments/              Removes FR/NFR/story refs from code comments
├── secure-coding/
├── spec-driven/
├── test-coverage/
├── agent-permissions/          Least-privilege .claude/settings.json generation
└── threat-modeling/            AppSec threat modeling (explicit request only)
```

---

## The Two-Tier Model

Every skill has exactly two files:

### Tier 1 — `SKILL-QUICK.md`
- Short: typically 1–2 pages
- Contains: trigger conditions, rules summary, pass/fail criteria, quick examples
- **Used by default** for every matching task
- Designed for minimal context consumption

### Tier 2 — `SKILL.md`
- Full: typically 3–8 pages
- Contains: complete algorithm, edge cases, anti-patterns, violation fixing guidance
- **Loaded only when** deep analysis is needed or a violation must be fixed
- Never loaded preemptively

---

## How to Add a New Skill

1. Create a new directory: `agent-skills/<skill-name>/`
2. Create `SKILL-QUICK.md` following this structure:
   ```
   # <Skill Name> — Quick Reference
   **Tier:** 1
   **Triggers:** [when agents load this]
   **Pass criteria:** [what makes a check pass]
   **Fail criteria:** [what causes a fail]
   **Rules:** [numbered list, concise]
   ```
3. Create `SKILL.md` following the Tier 2 structure (full algorithm, examples, edge cases)
4. Add an entry to `SKILLS-REGISTRY.md` (v1.x → v1.(x+1)) with:
   - Skill name
   - Trigger conditions
   - Tier 1 path
   - Tier 2 path
5. No other files needed — skills are self-contained

---

## Key Design Principles

- **Isolation:** each skill is self-contained; no skill imports another
- **Trigger-based loading:** agents load skills only when triggers match
- **Idempotent:** running a skill twice on the same artifact produces the same result
- **No side effects:** skills read and evaluate; they never write or commit
- **Word-boundary matching:** commit-hygiene uses `\bAI\b` regex to avoid false positives (e.g., "domain" contains "ai" but is never flagged)
