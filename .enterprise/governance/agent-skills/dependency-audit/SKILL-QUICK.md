---
name: dependency-audit
tier: quick
version: "1.0.0"
---

# Dependency Audit — Quick Check

> Tier 1: use when a PR adds or upgrades a third-party dependency.
> Load SKILL.md (Tier 2) for full audit criteria and governance rules.

---

## Checklist

**Security**
- [ ] New dependency checked against known CVE databases (NVD, OSV, Snyk, Dependabot)
- [ ] No Critical or High CVEs in the new dependency or its transitive dependencies
- [ ] Dependency is actively maintained (last commit < 12 months, issues being addressed)
- [ ] Dependency has a recognized open-source license compatible with the project

**Pinning**
- [ ] Version is pinned exactly (not a range like `^1.0` or `>=1.0` without upper bound)
- [ ] Lockfile committed and updated (`package-lock.json`, `pubspec.lock`, `go.sum`, `Gemfile.lock`, etc.)

**Scope & Justification**
- [ ] Dependency is necessary — the need cannot be met by existing dependencies or stdlib
- [ ] Dependency scope is correct (runtime vs dev/test dependency)
- [ ] Transitive dependency tree reviewed for unexpected additions

---

## Verdict

**PASS** → dependency is safe and justified.
**FAIL** → issue found — load `SKILL.md` (Tier 2) for full audit policy and remediation guidance.
