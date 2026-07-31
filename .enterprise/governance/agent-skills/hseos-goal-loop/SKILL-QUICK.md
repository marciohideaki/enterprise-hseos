---
name: hseos-goal-loop
tier: quick
version: "1.0"
description: "Use when a user gives an objective and wants the agent to choose and execute the right Goal or Loop toward production readiness."
license: Apache-2.0
metadata:
  owner: platform-governance
---

# HSEOS Goal Loop — Quick Reference

## Purpose

Turn an explicit objective into the smallest safe delivery flow that can reach production readiness. Select a **Goal** for bounded, evidenced work; select a **Loop** for multi-gap or uncertain work. Production-ready is an evidence target, never an assumption.

## Select the flow

| Choose | When |
|---|---|
| **Goal** | scope, acceptance and dependencies are sufficiently known; one bounded outcome can be completed and verified |
| **Loop** | codebase state, flows, integrations or gaps are uncertain; multiple safe mini-goals are required; each result must reprioritize the next |

## Mandatory sequence

1. **Intake:** restate objective, scope, constraints and production outcome. Ask only for missing material authority or requirements.
2. **Discover:** inspect specifications, ADRs, architecture, code, flows, integrations, conventions, tests, delivery manifests and observability. Verify assumptions against sources.
3. **Define:** write a Goal or Loop contract with acceptance, production dimensions, verify steps, risks and stop conditions.
4. **Execute:** make only the smallest authorized change. Use the repository worktree, test and governance flow.
5. **Verify:** run declared evidence; investigate root cause and retry a failed unit at most twice.
6. **Document and reassess:** record evidence, residual risk and next safe mini-goal. A loop continues only inside the approved objective.

## Production evidence

Check only what applies, but do not omit a relevant dimension: functional behavior, architecture/contracts, security/privacy, data/migrations, reliability, observability, delivery/rollback, automated tests, operational runbook and documentation.

## Hard gates

- Never deploy, merge, rotate/create secrets, mutate real external/production systems, change security posture, contracts, schemas or infrastructure without the required explicit authority.
- Real external/production writes require explicit authorization **per run**; default to read-only, synthetic or non-mutating probes.
- Do not call a result production-ready while a required evidence dimension is absent. Report `blocked` or `pending-validation` instead.
- Do not silently expand the objective or start a new mini-goal after closing the current one.

## Required output

```markdown
Mode: Goal | Loop
Objective / production outcome:
Evidence consulted:
Current mini-goal and acceptance:
Changes and validations:
Status: complete | in-progress | blocked | pending-validation
Residual risks / authority needed:
Next safe action:
```

Load the full skill for execution, production-risk analysis or an objective spanning more than one component.
