# Governance Events

## Purpose

Reinterpret operational hooks and runtime signals as governed, auditable HSEOS events instead of free-standing scripts.

## When To Use

Use this capability when:

- reviewing runtime or install lifecycle signals
- acknowledging an event that required operator review
- explaining why an event appears as a blocker
- auditing local orchestration and install-state activity

## Use Cases

- inspect a `session_created` event after local orchestration bootstrap
- review a `worker_handoff_recorded` event before continuing execution
- acknowledge an install repair event after operator review
- explain why an event is still open in posture or blockers

## Commands

```bash
hseos governance events list
hseos governance events inspect event-id
hseos governance events ack event-id --actor "ops-lead" --reason "Reviewed"
hseos governance events explain event-id
```

## Event Shape

```yaml
id: evt-123
type: worker_handoff_recorded
source: run.worker.handoff
severity: info
status: open
sessionId: runtime-hardening
workerId: ops-surface
summary: Worker "ops-surface" handoff recorded
timestamp: 2026-03-22T00:00:00.000Z
```

## Limits

- governance events are file-backed under `.hseos/data/governance/events`
- they are a signal layer, not a separate workflow engine
- acknowledgements do not override mission policy by themselves

## Troubleshooting

- if the list is empty, verify the runtime or install flow actually emitted events
- if an event remains open, inspect whether the event requires explicit acknowledgement
- if a blocker points to an event, compare severity and status in `ops blockers` and `governance events inspect`
