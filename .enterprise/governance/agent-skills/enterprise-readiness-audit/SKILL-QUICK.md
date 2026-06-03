---
name: enterprise-readiness-audit
tier: quick
version: "1.0.0"
description: "Use when running a quick enterprise-readiness, production-readiness, or POC-to-enterprise maturity audit for a codebase"
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Enterprise Readiness Audit — Quick Reference

> Tier 1: use for quick triage. Load `SKILL.md` for full repository audit, web research, scoring, artifacts, or formal modernization planning.

## Use When

- User asks for enterprise readiness, production readiness, or maturity audit.
- User asks whether a POC/MVP can evolve into an enterprise solution.
- User asks for architecture modernization, codebase normalization, or corporate-grade roadmap.

## Mandatory Guardrails

- [ ] Start read-only: do not modify code, configs, infrastructure, or dependencies during the audit.
- [ ] Inventory the repository before judging: stack, entrypoints, APIs, jobs, persistence, tests, CI/CD, deploy.
- [ ] Distinguish confirmed facts, technical inferences, and hypotheses.
- [ ] Cite evidence as `file:line`, command output, or explicitly "no evidence found".
- [ ] Do not recommend a rewrite unless incremental evolution is demonstrably unsafe or more expensive.

## Quick Rubric

| Score | Meaning |
|---:|---|
| 0 | Missing or broken |
| 1 | Experimental/manual/fragile |
| 2 | MVP works, but material risks remain |
| 3 | Initial product with partial standards |
| 4 | Corporate initial, operable with controlled gaps |
| 5 | Enterprise-ready: tested, observable, secure, governed |

## Severity

| Severity | Use When |
|---|---|
| Critical | Blocks production, exposes secrets/data, bypasses auth, risks data loss, money loss, or systemic outage |
| High | Likely production risk, material security issue, data inconsistency, missing rollback, severe coupling |
| Medium | Maintenance, scale, testability, or evolution risk with reasonable mitigation |
| Low | Local cleanup, standardization, or clarity issue without immediate operational impact |

## Required Output

- Executive maturity verdict.
- 0-5 score table by dimension.
- Findings by severity with evidence and confidence.
- Enterprise-readiness gaps.
- Normalization recommendations.
- Target architecture and phased roadmap.
- Prioritized backlog.
- Suggested ADRs.
- Recommendation to create Markdown + HTML report artifacts.

## Escalate to Tier 2

Load `SKILL.md` when:
- The user asked for a full audit or formal report.
- Internet research is required.
- Findings must be prioritized into a modernization roadmap.
- Markdown/HTML artifacts are requested.
