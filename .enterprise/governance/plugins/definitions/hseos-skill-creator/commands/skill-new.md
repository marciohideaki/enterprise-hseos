---
id: skill-new
description: Scaffold a new SKILL.md + SKILL-QUICK.md pair with HSEOS-compliant frontmatter
usage: /skill-new <skill-name> [--tier=1|2]
platform_support:
  - claude-code
---

Scaffolds `.enterprise/governance/agent-skills/<skill-name>/SKILL.md` and
`SKILL-QUICK.md` with HSEOS Tier-policy frontmatter. The agent-core compiler owns the
generated `.agents/skills/` mirror.

Usage: `/skill-new my-skill --tier=1`
