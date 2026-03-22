# Integration Governance Bootstrap

## Purpose

Establish the controlled integration model for HSEOS through `develop`, governed worktrees, and merge discipline.

## When To Use

Use this capability when:

- starting a new implementation wave
- creating isolated worktrees for governed changes
- preparing feature integration into `develop`
- validating that the runtime baseline remains centrally integrated

## Use Cases

- open a new implementation branch from `develop`
- run task work in isolated worktrees without touching the user worktree
- integrate validated task work back into a feature branch and then into `develop`
- keep runtime consolidation changes auditable and mergeable

## Primary Surfaces

- `git checkout develop`
- `./scripts/governance/worktree-manager.sh create`
- `./scripts/governance/worktree-manager.sh commit`
- `./scripts/governance/worktree-manager.sh remove`
- `.enterprise/.specs/decisions/ADR-0007-integration-governance-branching-model.md`

## Example Flow

```bash
./scripts/governance/worktree-manager.sh create mission-runtime feature/mission-runtime develop
VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh --phase code
./scripts/governance/worktree-manager.sh commit mission-runtime "feat(runtime): improve mission runtime"
```

## Limits

- this capability does not replace release governance
- it does not authorize direct mutation of the user dirty worktree
- it assumes `develop` is the integration baseline

## Troubleshooting

- if branch creation fails, inspect `.git/refs/heads` and disk space before retrying
- if worktree cleanup leaves a task branch behind, delete the merged local task branch explicitly
- if validation fails, do not integrate the task branch until the failure is resolved
