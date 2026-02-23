# Policies

> **For human contributors.** AI agents load policies referenced directly by name from the Constitution or SKILLS-REGISTRY — not this README.

---

## What This Directory Is

`policies/` contains **operational governance policies** — enforceable rules that govern how the overlay itself operates. These are distinct from `.specs/` standards (which govern engineering work) — policies govern the governance machinery.

Policies are **enforceable rules**, not recommendations or best-practice guides.

---

## Documents in This Directory

| Policy | Purpose | Who It Governs |
|---|---|---|
| `adr-policy.md` | How ADRs are created, approved, and maintained | All contributors |
| `automated-validation.md` | What checks run automatically in CI/CD | CI/CD pipelines |
| `documentation-policy.md` | What must be documented and how | All contributors |
| `exceptions.md` | How deviations are approved, scoped, and expired | All contributors |
| `minimal-wiring.md` | Minimum required connections between governance artifacts | Agents |
| `pre-flight-checks.md` | Checks that must pass before any agent begins a task | Agents |
| `sharding-policy.md` | When and how to split large documents | Agents + humans |
| `skill-consumption.md` | How agents load and use tiered skills | Agents |
| `specification-consumption.md` | How agents navigate and consume spec documents | Agents |
| `standards-adoption-metrics.md` | How compliance is measured, reported, and enforced | Engineering Leadership |

---

## Key Policies at a Glance

### `skill-consumption.md`
Referenced directly by the Enterprise Constitution §11. Defines the tiered protocol:
1. Always load `SKILLS-REGISTRY.md` first
2. Match triggers → load `SKILL-QUICK.md` (Tier 1) by default
3. Load `SKILL.md` (Tier 2) only for deep analysis
4. Never load all skills simultaneously

### `exceptions.md`
Governs the `../exceptions/` directory. Any deviation from a standard requires:
- An approved exception document (`EXC-XXXX-<title>.md`) in `../exceptions/`
- Named affected standards, risk assessment, and expiration date
- Agents refuse execution if a required exception is absent

### `standards-adoption-metrics.md`
Defines the 8-dimension scorecard for quarterly compliance measurement:
- Architecture Compliance (20%) — DDD boundary check pass rate
- Test Coverage (15%) — Domain ≥ 90%, Application ≥ 80%
- Security Compliance (20%) — No open CRITICAL/HIGH CVEs > 7 days
- Observability Compliance (10%) — Structured logs + metrics + traces
- Documentation Completeness (10%) — Public API has doc comments
- Commit Hygiene (10%) — No AI-attribution commits
- Dependency Health (10%) — No pinning violations
- Performance Baseline (5%) — Benchmarks if PE Standard active

Score < 75 triggers a feature freeze until remediation.

---

## Relationship to Constitution

Policies MUST comply with the Enterprise Constitution.

If a policy conflicts with the Constitution, the policy is **invalid** — the Constitution wins.

---

## Modifying a Policy

Changes require:
1. A PR with clear rationale
2. Review by Engineering Leadership or Platform Architecture
3. Changelog note recommended
