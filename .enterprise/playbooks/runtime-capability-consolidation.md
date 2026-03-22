# Runtime Capability Consolidation — Wave 1

## Purpose

This playbook explains how the Wave 1 runtime capabilities fit together as one HSEOS system.

## Wave 1 Capability Map

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

## Wave Boundary

Wave 1 establishes primitives and read models. It does not yet introduce:

- a full graphical control plane
- broad mutation APIs for operators
- a semantic/vector knowledge backend

## Naming Rule

All wave capabilities are described in HSEOS-native terms only.
