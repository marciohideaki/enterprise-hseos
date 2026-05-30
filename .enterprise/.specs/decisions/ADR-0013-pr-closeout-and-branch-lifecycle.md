# ADR-0013 — PR Closeout and Branch Lifecycle

**Status:** Accepted
**Date:** 2026-05-30
**Authors:** Platform Governance
**Approved by:** Marcio Hideaki (explicit session approval, 2026-05-30)
**Affects Standards:** `AGENTS.md` execution governance, `.enterprise/governance/execution-governance.md`, `.github/branch-protection.yaml`, `scripts/governance/worktree-manager.sh`, `scripts/governance/check-branch.sh`
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006, ADR-0007

---

## Context

HSEOS protects repository integrity through protected base branches, feature/task branch isolation, quality gates, commit hygiene, hooks, PR review, and human-in-the-loop controls.

The previous wording used broad absolute prohibitions:

- Agents must never merge PRs.
- Agents must never delete branches without explicit authorization.
- All work must occur in `feature/*` branches with `task/*` branches for tasks.

Those rules reduced risk, but they also created avoidable friction after a human had already reviewed a PR, checks were green, and the branch was provably merged. In the same area, the implementation drifted:

- The repository default branch is `master`, but the desired branch protection file only described `main` and `develop`.
- `check-branch.sh` allowed more branch prefixes than `AGENTS.md` documented.
- `worktree-manager.sh validate` invoked the manager checkout's quality gate script instead of the task worktree copy.
- `worktree-manager.sh merge` generated a non-conventional `merge(...)` commit message.

The goal is to preserve safety while reducing the cognitive load of routine PR closeout and branch cleanup.

---

## Decision

HSEOS will treat PR merge and feature branch cleanup as governed closeout operations.

Agents still must not self-approve PRs or merge autonomously. A PR merge requires explicit human approval, passing checks, and a mergeable PR state. After those conditions are met, an agent may execute the merge as an operator and record the result.

HSEOS will add `hseos pr closeout <number> --approved` as the preferred closeout path. The command must:

- Refuse to merge unless `--approved` is provided.
- Refuse draft, non-open, non-mergeable, or protected-head PRs.
- Refuse PRs with missing, pending, or failing status checks.
- Merge using the requested method, defaulting to merge commits.
- Fast-forward the local base branch from `origin`.
- Delete the merged `feature/*` head branch only after it is contained in the base branch.
- Never delete `main`, `master`, `develop`, `release/*`, or `hotfix/*` branches automatically.

Branch lifecycle policy is:

- `task/*` branches are short-lived and may be removed automatically by `worktree-manager.sh remove` after merge into the phase branch.
- `feature/*` branches may be cleaned up automatically only after their PR is merged and the branch is contained in the base branch.
- Protected branches (`main`, `master`, `develop`) are never deleted.
- `release/*` and `hotfix/*` branches require explicit authorization for deletion even when merged.

The canonical governed branch prefixes are:

- `feature/*`
- `task/*`
- `fix/*`
- `hotfix/*`
- `release/*`
- `docs/*`
- `chore/*`
- `ci/*`

`feature/*` remains the default for product and platform feature work; other prefixes are reserved for documented workflow-specific use.

---

## Consequences

### Positive

- Keeps human approval as the decision gate while letting agents perform mechanical closeout.
- Makes branch cleanup safe, repeatable, and low-friction.
- Aligns `AGENTS.md`, branch guard, desired GitHub branch protection, docs, and scripts.
- Fixes worktree validation so task validation runs against the actual task checkout.
- Prevents the worktree manager from generating invalid commit messages.

### Negative / Trade-offs

- `hseos pr closeout` depends on the GitHub CLI for PR state and merge execution.
- Repositories without status checks must add checks before using governed closeout.
- The command intentionally does not auto-delete non-`feature/*` branches, so release and hotfix cleanup remains manual.

### Risks

- **Risk:** `--approved` could be passed without real review. **Mitigation:** The flag is an explicit audit marker, and branch protection should require review on the server side.
- **Risk:** Required checks drift from workflow job names. **Mitigation:** Desired branch protection is versioned and tests assert the `master` branch protection entry exists.
- **Risk:** Cleanup deletes an active branch. **Mitigation:** Cleanup is limited to `feature/*` and requires Git to report the branch merged into the base.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| `AGENTS.md` | Execution Governance / Git Rules | Clarifies that agents may execute PR merge only after explicit human approval; defines branch cleanup classes |
| `.enterprise/governance/execution-governance.md` | Pull Request Policy, Branch Protection Policy, Worktree Task Isolation Flow | Adds governed closeout and safe branch lifecycle |
| `.github/branch-protection.yaml` | Desired branch protection | Changes desired protected branch from nonexistent `main` to actual default `master` |
| `scripts/governance/worktree-manager.sh` | validate, merge | Validates task worktree script; emits conventional merge commit messages |
| `scripts/governance/check-branch.sh` | branch naming | Aligns allowed prefixes with desired branch protection |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Teams notified through PR summary and docs
- [x] Activation date: 2026-05-30
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep absolute prohibition on all agent PR merges | Preserves safety but creates unnecessary manual toil after explicit human approval and green checks |
| Allow agents to merge any green PR | Too broad; it removes the human decision gate and weakens governance |
| Always delete every merged head branch | Too broad; release/hotfix branches may carry operational meaning after merge |
| Require explicit deletion approval for every branch type | Safe but high-friction; `task/*` and merged `feature/*` cleanup can be mechanically verified |

---

## Validation

- `npm run test:governance` covers commit-message validation, worktree manager invariants, branch-protection desired state, and PR closeout policy checks.
- `VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh` must pass before merge.

## Rollback

- Remove `hseos pr closeout`.
- Restore the absolute PR merge and branch deletion wording in `AGENTS.md` and execution governance.
- Revert `worktree-manager.sh` and `check-branch.sh` to the prior behavior.
- Keep this ADR and mark it Superseded by the rollback ADR if the policy changes again.
