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
- `payload`

## Runtime Rules

- only claimable statuses may enter mission runtime
- claim creates a persisted state file and isolated workspace directory
- reconcile compares runtime state with source work-item status and invalidates missions that are no longer executable
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
