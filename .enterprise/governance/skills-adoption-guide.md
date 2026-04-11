# HSEOS Skills Adoption Guide

> How the HSEOS framework evaluates and adopts external skills, patterns, and tooling.
> Use this guide for any future autonomous analysis of reference repositories.

---

## When to Run an Adoption Analysis

Trigger an adoption analysis when:
- A new reference repository is added to `/opt/references`
- HSEOS skill gaps are identified during a delivery workflow
- A new tool or framework becomes available in the enterprise ecosystem
- A quarterly governance review is scheduled

---

## Phase 1 — Inventory HSEOS Current State

Before evaluating external sources, map what HSEOS already has:

```bash
# Registered skills
cat .enterprise/governance/agent-skills/SKILLS-REGISTRY.md

# Agent capabilities
ls .hseos/agents/
# For each: review capabilities, bootstrap reads, menu

# Installed MCP servers
cat ~/.claude/claude.json | jq '.mcpServers | keys'
```

Build a table: `Domain | Existing skill/agent | Gap (yes/no)`

---

## Phase 2 — Inventory External Sources

For each repository or reference:
1. List all skills/patterns/tools with name + description
2. Note format (YAML frontmatter, plain markdown, JSON config, etc.)
3. Identify which HSEOS domain each item belongs to

---

## Phase 3 — Decision Matrix

For each external item, classify using three possible decisions:

| Decision | Meaning | Action |
|---|---|---|
| **IGNORAR** | Redundant with existing HSEOS capability, or out of scope | No action |
| **COMPLEMENTA** | Enriches an existing capability without creating a new entry point | Merge into existing skill file or agent |
| **ADOTAR** | Fills a clear gap; requires new skill files or agent capabilities | Create new skill + register + update agents |

Criteria for **ADOTAR**:
- HSEOS has no skill covering this domain
- Multiple agents would benefit from the guidance
- The pattern is enterprise-relevant (not project-specific)

Criteria for **COMPLEMENTA**:
- HSEOS already has a related skill but lacks specific technique or pattern
- The addition is a section/technique, not a standalone skill

Criteria for **IGNORAR**:
- Direct equivalent already exists in HSEOS
- Pattern is framework-specific (not portable to HSEOS)
- Out of enterprise scope (startup tooling, consumer apps)

---

## Phase 4 — Implementation Order

Prioritize by:
1. **Highest gap × lowest effort** — quick wins first
2. Dependencies — implement prerequisites before dependents
3. Agent coverage — prefer changes that benefit multiple agents

Implement **one item at a time**:
1. Write the skill file(s)
2. Update SKILLS-REGISTRY.md
3. Update agent YAML (bootstrap reads, capabilities) if needed
4. Run `npm test` — quality gates must pass
5. Commit with descriptive message
6. Only then proceed to next item

---

## Phase 5 — Verification

For each adopted item:
- [ ] `npm test` passes (schema validator, agent lint, installation test)
- [ ] SKILLS-REGISTRY.md updated with correct triggers and tier paths
- [ ] Agent YAML updated if skill is agent-specific
- [ ] Decision matrix documented (preserved in plan or commit message)

---

## Quality Bar for Adopted Skills

Every new skill file MUST:
- Have YAML frontmatter with `name`, `tier`, `version`
- Use the HSEOS tiered format (SKILL-QUICK.md for Tier 1, SKILL.md for Tier 2)
- Include a "When to use" or trigger section
- Be concise — SKILL-QUICK.md ≤ 80 lines; SKILL.md ≤ 200 lines
- Not duplicate content from existing skills (reference instead)

---

## Reference

This guide was created as part of the `feature/references-skills-adoption` initiative (2026-04).  
Source material: `/opt/references/AGENT_SKILLS_ADOPTION.md`, `/opt/references/AgenticDesignPatterns/`.
