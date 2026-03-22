# Mission Execution Runtime

## Purpose

This playbook defines how HSEOS claims, stores, reconciles, and inspects queued work items as mission runtime state.

## Runtime Roots

Mission runtime state lives under:

- `.hseos/data/runtime/work-items`
- `.hseos/data/runtime/workspaces`
- `.hseos/data/runtime/evidence`

## Commands

```bash
hseos run work-item path/to/work-item.yaml
hseos run reconcile
hseos run retry mission-id
hseos run status mission-id
```

## Required Work Item Shape

Work items must provide:

- `id`
- `title`
- `status`

Optional fields may include:

- `tracker`
- `directive`
- `syndicate`
- `circuit`
- `owner`
- `priority`
- `deadline_at`
- `mission_type`
- `labels`
- `dependencies`
- `impact_terms`
- `retry_class`
- `max_attempts`
- `context_query`
- `context_layer`
- `payload`

## Runtime Rules

- only claimable statuses may enter mission runtime
- claim creates a persisted state file and isolated workspace directory
- claim enforces structural execution governance before state is persisted
- claim attaches CORTEX recall and impact artifacts into the workspace and runtime state
- reconcile compares runtime state with source work-item status and invalidates missions that are no longer executable
- retry is an explicit governed transition for invalidated missions
- retry requires:
  - a retry-enabled mission policy
  - remaining attempts under `max_attempts`
  - a claimable source work-item status
  - runtime blocker approval when a runtime blocker is open
- status reads the persisted runtime record without mutating state

## Claimable Statuses

- `open`
- `ready`
- `queued`
- `todo`

## Terminal / Invalidating Statuses

- `blocked`
- `cancelled`
- `closed`
- `done`

## Governance Note

Mission runtime state is an execution adapter. It does not override ADR, authority, or approval requirements elsewhere in HSEOS.

## Operational Note

Mission runtime state now carries:

- mission metadata for priority, ownership, deadline, and mission type
- policy evaluation summary
- CORTEX recall trace and impact summary
- retry posture and attempt count
