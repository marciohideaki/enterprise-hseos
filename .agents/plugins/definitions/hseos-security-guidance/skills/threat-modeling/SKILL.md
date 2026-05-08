---
name: threat-modeling
description: Guide systematic threat modeling for new features, APIs, and architectural changes
tier: 2
load_strategy: trigger
triggers:
  - "threat model"
  - "security review"
  - "attack surface"
  - "new API"
  - "authentication"
  - "authorization"
adapter_overrides: {}
portable: true
plugin: hseos-security-guidance
---

# Threat Modeling Skill

Guides STRIDE-based threat modeling for any new surface area. Produces a structured threat register with mitigations.

## Process

1. **Scope** — identify assets, entry points, trust boundaries
2. **STRIDE** — Spoofing, Tampering, Repudiation, Information Disclosure, DoS, Elevation
3. **Mitigations** — map each threat to a control
4. **Residual risk** — document accepted risks with rationale

## Output

A `THREAT-MODEL.md` in the feature directory with: scope table, STRIDE matrix, mitigation map, residual risk register.
