---
name: dependency-audit
description: Audit project dependencies for known vulnerabilities and license compliance
tier: 2
load_strategy: trigger
triggers:
  - "dependency audit"
  - "npm audit"
  - "CVE"
  - "vulnerability"
  - "license check"
adapter_overrides: {}
portable: true
plugin: hseos-security-guidance
---

# Dependency Audit Skill

Runs a structured dependency security and license audit.

## Process

1. `npm audit` — identify CVEs by severity (critical/high/medium/low)
2. License scan — flag GPL/AGPL/proprietary in a commercial context
3. Outdated packages — flag packages > 2 major versions behind
4. Transitive check — verify no known-bad transitive dependencies

## Output

A `DEPENDENCY-AUDIT.md` with: vulnerability table (CVE, severity, package, fix version), license flags, update recommendations.
