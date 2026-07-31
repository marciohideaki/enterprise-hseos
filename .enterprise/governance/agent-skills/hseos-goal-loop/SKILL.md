---
name: hseos-goal-loop
tier: full
version: "1.0"
description: "Use when a user gives an objective and wants the agent to analyze a codebase and execute the best Goal or Loop toward a production-ready outcome."
license: Apache-2.0
portable: true
metadata:
  owner: platform-governance
trigger: "objective, goal, loop, execute goal, production-ready objective, analyze and deliver, normalize system, continuous delivery loop"
skip: "single read-only question; a dedicated workflow already owns the execution; deployment, merge or real external write without explicit authority"
---

# HSEOS Goal Loop — Production-Oriented Execution

## Authority boundary

This is an execution protocol, not a permission grant. It composes the repository constitution, ADRs, policies, worktree lifecycle, verification rules and any more-specific activated skill. When standards conflict, stop and request a human decision.

The user objective authorizes discovery and the smallest reversible implementation within its stated scope. It does not authorize deploy, merge, secret operations, schema/data migration, RBAC/security posture changes, infrastructure changes, external integration changes or writes to real external/production systems. Require explicit authority for each such action; for real writes, authority is required per run.

## 1. Intake and flow selection

Capture:

- objective, desired users/outcome and scope boundary;
- compatibility, security, compliance and delivery constraints;
- expected production evidence and available authority.

Choose one mode and state why:

| Mode | Use when | Completion unit |
|---|---|---|
| **Goal** | scope, acceptance, dependencies and implementation path are substantially known | one bounded outcome |
| **Loop** | unknown state, multiple gaps, dependencies or risk require repeated discovery and reprioritization | one mini-goal per iteration |

If the objective is ambiguous in a way that changes behavior, data ownership, architecture or risk, stop and ask the minimum question. Do not invent a product or technical decision.

## 2. Discovery before change

Build an evidence map from the minimum relevant sources:

1. repository instructions, constitution, policies, ADRs and specifications;
2. architecture, domain model, API/event contracts and conventions;
3. code entrypoints, callers, flows, persistence, integration clients and delivery manifests;
4. tests, CI, logs/metrics/traces, runbooks and production evidence when safely available.

In a project containing `.axon/`, route code discovery (item 3) through Axon first: health-check the index (≤24h; reindex or alert if stale), then `mcp__axon__get_context_capsule(query)` — or the `axon capsule` CLI when the MCP server is unavailable — and read directly only the pivots it surfaces. Never degrade silently into sequential full-file exploration; record the discovery mode used.

For each claim, distinguish **observed**, **inferred** and **unverified**. Locate existing implementation before creating a parallel solution. Identify gaps, dependencies, regressions, ownership boundaries and blockers.

## 3. Define the contract

Write before execution:

```markdown
Mode: Goal | Loop
Objective:
Production outcome:
Scope / non-scope:
Evidence map:
Mini-goal:
Acceptance criteria:
Production dimensions affected:
verify_step: command or observable check; expected result; fallback
Authority: available | required
Risks, rollback and stop condition:
```

Production dimensions are selected proportionally: functional correctness; architecture and contracts; security/privacy; data and migrations; reliability; observability; delivery, rollback and supply chain; automated tests; operations/runbooks; documentation. A dimension not applicable must be justified, not silently skipped.

## 4. Execute incrementally

Execute only the current mini-goal:

1. Use the repository's worktree/task lifecycle for writes and preserve unrelated changes.
2. Prefer the simplest compatible change; avoid duplicate paths, speculative abstraction, stubs that mask behavior and broad refactors.
3. Maintain compatibility unless an accepted decision explicitly permits a break.
4. For a Loop, return to discovery after each documented mini-goal and select the next item only while it remains inside the original objective and authority.

## 5. Verify, fix and production readiness

Run the declared verify step and the repository quality gates. Add unit, contract, integration, E2E, live-read or operational evidence proportionally to risk.

On failure, establish the root cause, fix within the same mini-goal and rerun evidence. After two failed correction attempts, or when the cause needs external state/authority, stop as `blocked` with the evidence and required action.

For an external integration, contract tests do not prove the provider: use safe live endpoint-by-endpoint validation where credentials and authority allow. Use synthetic data or non-mutating probes by default.

Do not claim production readiness until required evidence exists for every applicable dimension. A successfully compiled feature with missing rollout, rollback, observability, security or live-integration proof is `pending-validation`, not complete.

## 6. Document, reassess and stop

Record objective, mode, changed scope, evidence, validation output, decisions, risks, blockers, rollback posture and next safe action in the repository's normal project-state mechanism.

For a Goal, stop when its acceptance is evidenced or no safe action remains. For a Loop, reassess the original objective after the mini-goal; continue only if another authorized, high-value mini-goal exists. Stop immediately when remaining progress depends exclusively on a human decision, external access/state, or forbidden authority.

## Completion declaration

```markdown
GOAL/LOOP RESULT — {objective}
Mode: {Goal|Loop}
Status: {complete|in-progress|blocked|pending-validation}
Production outcome: {evidenced outcome or gap}
Evidence: {commands, tests, logs, live checks}
Production dimensions: {passed / pending per applicable dimension}
Risks and rollback: {residuals}
Authority required: {none or exact action}
Next safe action: {one item; do not execute it in this closeout}
```

## Anti-patterns

- Selecting a Goal before inspecting the codebase and calling its assumptions facts.
- Running an endless loop that expands beyond the user objective.
- Treating mocks, compilation or a happy-path unit test as production proof.
- Using an old environment, mutable artifact or unverified integration as rollback evidence.
- Continuing after an authority gate by fabricating credentials, approval or external results.
