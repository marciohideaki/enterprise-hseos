# Execution Observability Surface

## Purpose

Expose runtime posture, blockers, approvals, and evidence through a local-first operational read model.

## When To Use

Use this capability when:

- checking overall runtime posture
- inspecting blockers or invalidated missions
- reviewing runtime evidence and denial events
- recording and reviewing approvals for governed continuation

## Use Cases

- inspect retryable invalidations before running `retry-ready`
- find missions blocked by missing approval
- review policy denial evidence after a failed claim
- audit the current approval state for runtime blockers
- inspect local orchestration sessions, worker states, and install drift from one surface

## Commands

```bash
hseos ops summary
hseos ops posture
hseos ops runs
hseos ops evidence
hseos ops blockers
hseos ops approvals
hseos ops session list
hseos ops session inspect session-id
hseos ops install inspect
hseos ops install summary
hseos ops approve runtime:mission-123 --reason "Approved retry" --actor "ops-lead"
hseos ops revoke runtime:mission-123 --reason "Approval withdrawn" --actor "ops-lead"
```

## Example Operator Questions

- how many missions are retryable right now?
- which runtime blockers still await approval?
- which missions already have CORTEX context attached?
- what policy denials were recorded today?

## Limits

- this surface is local-first and file-backed
- it is read-dominant, with approval recording as the main mutation path
- it is not a graphical control plane
- session, install, runtime, and governance data converge here, but canonical truth still stays in their own stores

## Troubleshooting

- if posture looks empty, confirm runtime state exists under `.hseos/data/runtime/work-items`
- if approvals do not appear, inspect `.hseos/data/runtime/evidence` and approval event storage
- if blockers remain open after action, verify the blocker key and current approval decision
