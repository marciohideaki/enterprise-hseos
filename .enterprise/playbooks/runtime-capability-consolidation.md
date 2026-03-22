# Runtime Capability Consolidation — Stable Baseline

## Purpose

This playbook explains how the stable runtime baseline fits together as one HSEOS system.

## Baseline Capability Map

| Capability | HSEOS Purpose | Primary Surface |
|---|---|---|
| Integration Governance Bootstrap | Establish controlled integration flow through `develop` | governance + branching |
| Structural Execution Governance | Enforce deterministic runtime boundaries before mutation | `hseos policy` + installer preflight |
| Mission Execution Runtime | Claim, isolate, reconcile, and inspect queued work items | `hseos run` |
| Execution Observability Surface | Aggregate runtime posture, evidence, and blockers | `hseos ops` |
| CORTEX Recall Intelligence | Encode, retrieve, trace, and impact context | `hseos cortex` |

## End-to-End Narrative

1. Governance establishes the integration branch and worktree discipline.
2. Structural execution governance constrains what runtime mutation is allowed.
3. Mission runtime claims and persists executable work item state.
4. CORTEX provides layered context and retrieval traceability for execution.
5. The observability surface gives operators a read-first view of posture and blockers.

## Current Baseline

The baseline now includes:

- mission runtime includes richer mission metadata and governed retry
- structural execution governance evaluates mission context as well as structural selections
- structural execution governance also evaluates mission labels, dependencies, and retry class
- the observability surface exposes approvals and a unified operational posture
- the observability surface exposes retry readiness and approval-gated runtime blockers
- CORTEX attaches mission-scoped recall and impact traces during mission claim
- governed retry automation can process approved retryable missions in batch through `hseos run retry-ready`

The baseline still does not introduce:

- a full graphical control plane
- autonomous retry scheduling
- a semantic/vector knowledge backend

## Internal Adoption Guidance

This baseline is suitable for controlled internal adoption on `develop` when teams need:

- deterministic runtime guardrails before mutation
- file-backed operational evidence and blocker visibility
- governed mission retry, including approved batch retry handling
- mission-context-aware recall and code impact assistance

Internal adopters should treat the current baseline as:

- stable for enterprise workflow experimentation and operational rehearsal
- local-first and governance-first by design
- intentionally conservative in automation scope

The next waves should prefer hardening and adoption support over broad new surface area.

For internal rollout readiness, use:

- `.enterprise/playbooks/internal-rollout-checklist.md`

## Naming Rule

All wave capabilities are described in HSEOS-native terms only.
