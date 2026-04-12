---
name: ai-observability
tier: quick
version: "1.0"
description: "Use when reviewing AI agent observability, tracking mission-control KPIs, or adding AI-specific metrics to a service"
---

# AI Observability — Quick Reference

> Tier 1: use when auditing AI usage metrics, reviewing KPIs, or connecting mission-control.
> Load SKILL.md (Tier 2) for full metric schema, mission-control integration, and dashboard setup.
> Source: AI-SDLC v1.0 §9 (Observabilidade) and §10 (KPIs).

---

## Metrics Available Today (no extra infra)

Collected from HSEOS native artifacts — no mission-control required:

| Metric | Source | How to extract |
|---|---|---|
| Workflow phases completed | `.hseos-output/<epic>/state.yaml` | Count `completed_phases` |
| Gate failures per build | `.logs/validation/gate-*.log` | Count `FAILURES` lines |
| Gate warnings per build | `.logs/validation/gate-*.log` | Count `WARNINGS` lines |
| Delivery cycle time | `.hseos-output/` timestamps | `phase_10.completed_at - phase_0.started_at` |
| Commits per epic | `git log --oneline <branch>` | Count commits on feature branch |
| Stories executed | `tasks.md` files | Count `[x]` tasks across epic |

---

## Metrics Requiring mission-control

| Metric | AI-SDLC ref |
|---|---|
| `tokens_input` per session | §9 |
| `tokens_output` per session | §9 |
| `context_usage` % per session | §9 |
| `tasks_executed` per agent | §9 |
| `execution_time` per task | §9 |
| `error_rate` per agent role | §9 |

---

## KPIs Calculable Today

| KPI | Formula | Source |
|---|---|---|
| Gate failure rate | `failures / (failures + passes)` | `.logs/validation/` |
| Delivery cycle (epic) | `phase_10_ts - phase_0_ts` | workflow state |
| Story completion rate | `completed tasks / total tasks` | `tasks.md` |

---

## KPIs Requiring mission-control

| KPI | Formula | AI-SDLC ref |
|---|---|---|
| Cost per feature | `total_tokens × model_price_per_token` | §10 |
| % stateless execution | `sessions_without_history_reuse / total_sessions` | §10 |
| Context budget adherence | `sessions_within_60pct / total_sessions` | §10 |
| Rework rate | `tasks_reopened / tasks_completed` | §10 |

---

## SABLE — FinOps Audit Checklist

At end of each epic delivery (Phase 9/10):
- [ ] Workflow state file has timestamps for all phases
- [ ] Gate failure log reviewed — failures documented with root cause
- [ ] Delivery cycle time recorded
- [ ] If mission-control available: agent metrics fetched and logged
- [ ] Context budget violations during epic reported (if any)
