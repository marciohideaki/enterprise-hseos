# `hseos-skill-creator`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5. Declared in `.agents/plugins/registry.yaml`.

## Purpose

Plans to generate `SKILL.md` and `SKILL-QUICK.md` pairs in the canonical
`.enterprise/governance/agent-skills/` source. The compiler, rather than the plugin,
owns the `.agents/skills/` mirror.

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
