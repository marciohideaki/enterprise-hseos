---
name: release-control
tier: quick
version: "1.0"
description: "Use when preparing a release, reviewing changelog completeness, or classifying release risk"
---

# Release Control — Quick Check

> Tier 1: use when preparing any release, CHANGELOG update, or production promotion.
> Load SKILL.md (Tier 2) for detailed release governance policy.

---

## Checklist (ALL must pass)

**Versioning**
- [ ] Version bump follows semantic versioning: `MAJOR.MINOR.PATCH`
  - MAJOR → breaking change
  - MINOR → backward-compatible new feature
  - PATCH → backward-compatible fix
- [ ] Version bump type matches the nature of the changes

**Changelog**
- [ ] CHANGELOG updated with all changes since the last release
- [ ] Breaking changes explicitly flagged (e.g., `⚠ BREAKING:`)
- [ ] Each entry references a ticket or PR where applicable

**Risk Classification**
- [ ] Risk level assigned: `Low` / `Medium` / `High`
  - Low → patch fix, no contract changes, no schema changes
  - Medium → new features, non-breaking contract changes
  - High → breaking changes, data migrations, security patches
- [ ] Rollback plan documented for Medium and High risk releases

**Dependencies & Communication**
- [ ] Breaking contract changes communicated to all dependent service owners
- [ ] Deprecation notices issued for removed or changed APIs (if applicable)
- [ ] Release candidate tested in staging before production promotion

---

## Verdict

**PASS** → all items clear, release may proceed.
**FAIL** → blocking — load `SKILL.md` (Tier 2) for full release governance policy.
