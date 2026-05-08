---
id: skill-new
description: Scaffold a new SKILL.md + SKILL-QUICK.md pair with HSEOS-compliant frontmatter
usage: /skill-new <skill-name> [--tier=1|2]
platform_support:
  - claude-code
---

Scaffolds `.agents/skills/<skill-name>/SKILL.md` and `SKILL-QUICK.md` with HSEOS Tier-policy frontmatter including `name`, `description`, `tier`, `load_strategy`, `triggers`, `adapter_overrides`, and `portable: true`.

Usage: `/skill-new my-skill --tier=1`
