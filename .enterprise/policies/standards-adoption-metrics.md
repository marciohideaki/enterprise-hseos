# Standards Adoption Metrics Policy

**Version:** 1.0
**Status:** Active
**Owner:** Engineering Leadership / Platform Architecture
**Review Cycle:** Quarterly

---

## 1. Purpose

This policy defines how adoption and compliance of engineering standards are measured, reported, and enforced. Without metrics, standards become aspirational rather than operational.

---

## 2. Compliance Scorecard — Per Service

Each service is scored quarterly across 8 dimensions. Scores are 0–100.

| Dimension | Weight | How Measured |
|---|---|---|
| Architecture Compliance | 20% | DDD boundary check pass rate in PRs |
| Test Coverage | 15% | Domain ≥ 90%, Application ≥ 80% in last CI run |
| Security Compliance | 20% | No open CRITICAL/HIGH CVEs or SAST findings > 7 days |
| Observability Compliance | 10% | Structured logs + metrics + traces present |
| Documentation Completeness | 10% | Public API has doc comments; ADRs for arch decisions |
| Commit Hygiene | 10% | 0 commits with AI attribution in last quarter |
| Dependency Health | 10% | No pinning violations; lock file present |
| Performance Baseline | 5% | Benchmarks present if PE Standard activated |

**Scoring:**
- 90–100: Compliant ✅
- 75–89: Partially Compliant ⚠️ — remediation plan required within 30 days
- < 75: Non-Compliant ❌ — Engineering Lead review required; feature freeze until ≥ 75

---

## 3. Metrics Collection Points

### 3.1 CI/CD Pipeline (Automatic)

Collected on every PR merge to `main`/`develop`:

| Metric | Source | Threshold |
|---|---|---|
| `coverage.domain_pct` | Coverage report | ≥ 90% |
| `coverage.application_pct` | Coverage report | ≥ 80% |
| `sast.critical_findings` | SAST gate output | = 0 |
| `sast.high_findings` | SAST gate output | = 0 |
| `deps.critical_cves` | Dependency scan | = 0 |
| `deps.pinned_violations` | Lock file check | = 0 |
| `commit.hygiene_violations` | commit-hygiene skill | = 0 |
| `build.duration_seconds` | Pipeline timing | < 1200 (20 min) |

### 3.2 Weekly Automated Audit

Run every Monday at 00:00 UTC against all services in the repository:

| Metric | How |
|---|---|
| Open CRITICAL/HIGH CVEs age | Dependency scanner + created_at |
| Open SAST HIGH findings age | SAST report + created_at |
| Missing `data-lineage.md` | File existence check |
| Missing PR Checklist in stack | File existence check |
| ADR-required changes without ADR | Heuristic: arch file changed + no ADR in PR |
| Benchmark presence (PE-activated services) | File existence check |

### 3.3 Quarterly Manual Review

Engineering Leadership reviews:
- Scorecard trend per service (Q-over-Q)
- Standards with lowest compliance rates (candidates for tooling investment)
- Exception/ADR ratio per team (high ADR volume may indicate standard needs revision)
- Mutation score trend (if Mutation Testing adopted)

---

## 4. Reporting

### 4.1 Dashboard

All metrics exported to the observability platform with labels:
```
service="<name>"
stack="<stack>"
team="<team>"
quarter="<YYYY-Q[1-4]>"
```

### 4.2 Quarterly Report Structure

```markdown
# Standards Compliance Report — Q[N] YYYY

## Executive Summary
- Services fully compliant: X / Y (Z%)
- Services partially compliant: X
- Services non-compliant: X

## Dimension Breakdown
[Table: each dimension, org-wide average, trend vs last quarter]

## Non-Compliant Services
[Table: service, score, blocker dimensions, responsible team, remediation deadline]

## Standard Health
[Which standards have lowest compliance — candidates for revision or tooling]
```

---

## 5. Remediation Process

| Score | Action | Deadline |
|---|---|---|
| 75–89 | Team produces remediation plan | 30 days |
| 60–74 | Engineering Lead engaged; remediation plan | 14 days |
| < 60 | Feature freeze; remediation prioritized above features | 7 days |

Remediation plans must be documented in `.enterprise/exceptions/` as a formal exception with timeline.

---

## 6. Standards Health Metrics

Track whether the standards themselves are effective:

| Signal | Meaning | Action |
|---|---|---|
| High ADR volume for one standard | Standard may be too strict or unclear | Review standard |
| Repeated same violation across teams | Missing tooling or unclear guidance | Add skill or example |
| Standard never violated | Standard may be too vague or not checked | Add concrete gate |
| Standard blocks many PRs spuriously | False positive rate too high | Refine threshold |

---

## 7. Ownership

| Role | Responsibility |
|---|---|
| Engineering Leadership | Quarterly review, remediation escalation |
| Platform Architecture | Metrics tooling, scorecard definition |
| Tech Leads | Service-level compliance, remediation plans |
| Agents | Enforce skill-based checks at PR time (self-governance) |
