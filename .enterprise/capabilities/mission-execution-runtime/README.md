# Mission Execution Runtime

## Purpose

Claim, isolate, reconcile, retry, and inspect queued work items as governed HSEOS mission state.

## When To Use

Use this capability when:

- moving a work item into executable HSEOS runtime state
- reconciling runtime state against source status
- retrying invalidated missions under approval
- processing approved retryable missions in batch

## Use Cases

- claim a queued mission into an isolated workspace
- invalidate a claimed mission when its source becomes blocked or cancelled
- retry a single invalidated mission after blocker approval
- process a queue of approved retryable missions with `retry-ready`

## Commands

```bash
hseos run work-item path/to/work-item.yaml
hseos run reconcile
hseos run retry mission-id
hseos run retry-ready
hseos run retry-ready 5
hseos run status mission-id
```

## Example Work Item

```yaml
id: mission-123
title: Runtime claim smoke test
status: ready
tracker: local
owner: platform-ops
priority: critical
deadline_at: 2026-03-31T12:00:00Z
mission_type: remediation
labels:
  - runtime
dependencies:
  - policy-baseline
retry_class: transient
max_attempts: 3
context_query: policy enforcement traceability
```

## Limits

- runtime is an execution adapter, not a replacement for governance or ADR authority
- batch retry remains approval-gated and non-autonomous
- runtime state is file-backed under `.hseos/data/runtime`

## Troubleshooting

- if claim fails, inspect policy denial evidence in `.hseos/data/runtime/evidence`
- if retry fails, check source status, `max_attempts`, and blocker approval state
- if `retry-ready` skips missions, inspect `hseos ops posture` and `hseos ops blockers`
