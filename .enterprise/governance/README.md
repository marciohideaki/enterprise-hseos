# Governance

> **For human contributors.** AI agents navigate this directory via `SKILLS-REGISTRY.md` inside `agent-skills/` — not this README.

---

## What This Directory Contains

The `governance/` directory holds the **operational machinery** that agents use to enforce standards at task time. It is distinct from `.specs/` (which contains the standards themselves) — governance is the *enforcement layer*, specs are the *normative layer*.

```
governance/
├── agent-skills/       Tiered skill system — loaded by agents during task execution
├── policies/           Internal governance policies (architecture boundaries, etc.)
├── memory-evolution-roadmap.md
│                      Planned evolution for shared memory, run-state, and token-efficient context
└── references/         Source documents and external references integrated into governance
```

---

## `agent-skills/` — The Skill System

Skills are **on-demand, focused enforcement modules** loaded by agents at the right moment in a task. They are not read upfront — they are triggered by specific conditions.

### How skills are structured

Each skill has two tiers:

| File | Tier | When to Use |
|---|---|---|
| `SKILL-QUICK.md` | Tier 1 | Default — fast check, rules summary, pass/fail criteria |
| `SKILL.md` | Tier 2 | Deep analysis — full algorithm, edge cases, violation fixing |

The `SKILLS-REGISTRY.md` at the root of `agent-skills/` is the **only entry point agents use**. They load the registry first, then load individual skill files as needed.

### Available skills

The skill catalog lives in **`agent-skills/SKILLS-REGISTRY.md`** — the single canonical
index (49 skills as of 2026-07-08, spanning governance/compliance audits, execution
protocols, GitOps, ADO tracking, context engineering, and research). Each entry declares
description, load-when conditions, triggers, tiers, and cost. This README intentionally
does not duplicate the list: a static copy here went stale at 18 entries while the
registry grew past 40.

---

## `policies/` — Internal Governance Policies

Contains policies that govern the governance infrastructure itself (meta-governance). Currently:

| File | Purpose |
|---|---|
| `architecture-boundaries.md` | Defines boundaries for the governance overlay itself |

---

## `references/` — Source Documents

Original documents and external references whose content has been integrated into the governance overlay. Kept for traceability — not consumed by agents directly.

| File | Content | Integrated into |
|---|---|---|
| `boris-cherny-execution.md` | Agentic execution discipline — plan mode, subagents, self-improvement, verification, core principles | `~/.claude/CLAUDE.md` (Execution Discipline + Core Principles sections) |
| `sentry-security-review.md` | Confidence-based security review methodology (Sentry) | `secure-coding` skill Tier 2 (enrichment planned) |
| `trailofbits-differential-review.md` | 6-phase diff review with blast radius analysis (Trail of Bits) | `pr-review` skill Tier 2 (enrichment planned) |

---

## Planned Evolution

The following human-facing planning artifact is maintained here while not yet normative:

| File | Purpose |
|---|---|
| `memory-evolution-roadmap.md` | Planned memory architecture for HSEOS, covering SQLite, MCP/tool access, event log, run-state, and shared multi-agent memory |

---

## The Skill Loading Protocol

Agents MUST follow the tiered protocol from `../policies/skill-consumption.md`:

1. Load `SKILLS-REGISTRY.md` first — always
2. Match the current task against trigger conditions
3. Load `SKILL-QUICK.md` (Tier 1) for standard checks
4. Load `SKILL.md` (Tier 2) only for deep analysis or violation fixing
5. Never load all skills simultaneously — load only what the task requires

Loading all skills at once is a compliance violation (context pollution).
