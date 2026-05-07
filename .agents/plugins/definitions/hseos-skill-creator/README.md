# `hseos-skill-creator`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5. Declared in `.agents/plugins/registry.yaml`.

## Purpose

Generates `SKILL.md` and `QUICK.md` pairs that conform to the HSEOS Tier-policy frontmatter declared in `.agents/instructions/TIER-POLICY.md` (lands in Wave 4 implementation). Replaces the upstream `skill-creator` plugin with one that emits HSEOS-compliant skill files out of the box.

## Frontmatter the plugin emits

```yaml
---
name: <skill-name>
description: <one-line trigger description>
tier: 1 | 2
load_strategy: always | trigger | manual
triggers: [list of activation events]
portable: true
adapter_overrides:
  <vendor>:
    tier: 1 | 2
critical_invariants: [list]
---
```

## Implementation plan

- `commands/skill-new.md` — slash command surfacing the wizard
- `lib/scaffold.js` — generates the SKILL.md + QUICK.md skeletons
- `lib/validate.js` — validates frontmatter against `_schema.yaml`
- `tests/` — conformance tests

## Acceptance

- [ ] Generates a passing SKILL.md + QUICK.md pair
- [ ] Validates against the SKILLS-REGISTRY frontmatter contract
- [ ] Loaded by both compiled plugin marketplaces
