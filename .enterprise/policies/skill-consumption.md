# Skill Consumption Policy
Enterprise Overlay

---

## Status
Active — Governance Policy

## Scope
All AI agents and human contributors operating under the Enterprise Overlay.

## Audience
- AI Agents operating under this Overlay
- Human Architects and Engineers

---

## Purpose

This policy defines **how agent skills MUST be consumed** — which tier to load, when, and under what conditions.

It mirrors the **Specification Consumption Policy** (Views → Canonical) applied to the skill system.

It does NOT define:
- the content of individual skills
- when a skill's rules apply to code
- how violations must be fixed

It governs **skill loading behavior only**.

---

## Core Principle

> **The Registry defines WHAT exists and WHEN to trigger**
> **Tier 1 (Quick) defines HOW to self-check fast**
> **Tier 2 (Full) defines WHY and HOW to fix deeply**

---

## Skill Tiers

| Tier | File | Purpose | Context cost | Load by default? |
|---|---|---|---|---|
| **0 — Registry** | `SKILLS-REGISTRY.md` | Discovery + trigger matching | Minimal | Yes — always |
| **1 — Quick** | `SKILL-QUICK.md` | Checklist-only validation | Low | Yes — when triggered |
| **2 — Full** | `SKILL.md` | Complete policy + fix guidance | Medium/High | No — only when needed |

---

## Mandatory Loading Protocol

### Step 1 — Always load the Registry
Every agent MUST load `SKILLS-REGISTRY.md` before any task.
The registry is always loaded regardless of task type.

### Step 2 — Match triggers
The agent MUST compare the current task context against the trigger keywords in the registry.
If one or more skills match → proceed to Step 3.
If no skill matches → no skill loaded. Proceed with task.

### Step 3 — Load Tier 1 (default)
For every matched skill, load `SKILL-QUICK.md`.
Tier 1 is sufficient for:
- Writing or validating commit messages
- Pre-commit self-checks
- Inline code review during development
- Standard PR review pass

### Step 4 — Upgrade to Tier 2 (only when needed)
Load `SKILL.md` (Tier 2) only when:
- A Tier 1 checklist item **fails** and the fix requires deeper guidance
- A **formal architectural review** is being performed (not just a commit check)
- A **security audit** is explicitly requested
- A **release governance review** requires full policy context
- Generating a full violation report with remediation plan

---

## Rules

### Loading Rules
- RP-SK-01: Registry MUST be loaded before any skill tier.
- RP-SK-02: Tier 2 MUST NOT be loaded without first loading Tier 1.
- RP-SK-03: All skills MUST NOT be loaded simultaneously unless all are triggered and deep analysis is required.
- RP-SK-04: When multiple skills are triggered, load each at Tier 1 first; upgrade to Tier 2 individually as needed.

### Decision Rules
- RP-SK-05: If no trigger matches the task context, no skill is loaded. This is a valid outcome.
- RP-SK-06: Tier 1 is the default for active development. Tier 2 is the default for formal review gates.
- RP-SK-07: Agents MUST NOT preemptively load Tier 2 to "be safe" — this wastes context budget.

### Conflict Rules
- RP-SK-08: If a skill rule conflicts with a canonical specification, the canonical specification wins (BEC precedence order applies).
- RP-SK-09: If a skill rule conflicts with another skill rule, execution MUST stop and an ADR must be requested.

---

## Prohibited Behaviors

The following behaviors are strictly forbidden:

- Loading all skills at the start of every task
- Skipping the Registry and loading skills by name directly
- Loading Tier 2 for tasks where Tier 1 is sufficient
- Ignoring a triggered skill (if a trigger matches, the skill must be evaluated)
- Treating Tier 1 (SKILL-QUICK.md) as authoritative over Tier 2 (SKILL.md) when both are loaded

---

## Analogy with Specification Consumption

This policy intentionally mirrors the Specification Consumption Policy:

| Specs | Skills |
|---|---|
| Views (non-normative, fast) | Tier 1 — SKILL-QUICK.md |
| Canonical Specifications (authoritative, full) | Tier 2 — SKILL.md |
| "Load canonical only when strictly necessary" | "Load Tier 2 only when needed" |
| RAW_SPECS.md as stack anchor | SKILLS-REGISTRY.md as discovery anchor |

---

## Adding New Skills

When a new skill is introduced, the following MUST be provided before the skill is usable:

1. **SKILL-QUICK.md** (Tier 1) — checklist form, ≤ 30 lines
2. **SKILL.md** (Tier 2) — full policy
3. **Registry entry** — triggers, paths, cost estimate added to `SKILLS-REGISTRY.md`

A skill without a registry entry MUST NOT be used by agents.
A skill without a Tier 1 file MUST NOT be used by agents.

---

## Final Statement

This policy exists to ensure that:
- agents use skills efficiently without exhausting context budget
- skill loading is trigger-based and deterministic
- Tier 2 depth is available when truly needed
- the skill system scales as new skills are added

If ambiguity arises about which skill or tier to load → default to Tier 1 of the matched skill.

---

**End of Policy**
