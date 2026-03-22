# Local Orchestration Session Store

## Purpose

Coordinate local multi-worker execution through HSEOS-native session state, worktrees, handoffs, and snapshots.

## When To Use

Use this capability when:

- breaking local execution into multiple workers
- isolating worker changes in separate worktrees
- recording handoffs between workers or operator checkpoints
- generating structured session snapshots for inspection

## Use Cases

- create a local orchestration session with two implementation workers
- spawn a worker only when the operator is ready to start execution
- record a structured handoff after a worker finishes a slice
- inspect the current worker mix before merging outputs back upstream

## Commands

```bash
hseos run orchestration create path/to/session-spec.yaml
hseos run orchestration status session-id
hseos run orchestration snapshot session-id
hseos run worker spawn session-id worker-id
hseos run worker complete session-id worker-id
hseos run worker list session-id
hseos run handoff session-id worker-id path/to/handoff.yaml
```

## Example Session Spec

```yaml
sessionName: runtime-hardening
baseRef: develop
launcherAdapter: local-shell
workers:
  - name: policy-audit
    task: Tighten mission policy edge cases
    seedPaths:
      - tools/cli/lib/policy
  - name: ops-surface
    task: Expand session posture read model
    seedPaths:
      - tools/cli/lib/ops
```

## Limits

- `tmux` is optional and not part of the canonical session contract
- session truth lives in `.hseos/data/sessions`; markdown artifacts are operator-facing only
- orchestration does not bypass runtime governance or mission policy

## Troubleshooting

- if session creation fails, verify the repo is a valid git worktree root and the worker branch names are free
- if seeded paths fail, ensure every path stays inside repo root and exists before create
- if status looks stale, create a fresh snapshot with `run orchestration snapshot`
