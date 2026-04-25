# RESUME-PROMPT — 20260425-2010-state-w3-validation

If resuming after `/clear`, read PLAN.md + STATUS.md + handoffs/*.md only.

## Resume protocol

For each PENDING task in STATUS.md:
1. `cd /opt/hideakisolutions/enterprise-hseos`
2. Workaround for worktree-manager.sh:93 bug: `git branch task/T3-N feature/state-tracking-w3-validation && git worktree add .worktrees/T3-N task/T3-N`
3. Implement file(s) per acceptance criteria.
4. `validate-commit-msg.sh "<msg>"` then `git commit` in worktree.
5. `git merge --no-ff task/T3-N -m "chore(merge): integrate task/T3-N into feature/state-tracking-w3-validation"` (workaround for bug #3).
6. `git worktree remove --force .worktrees/T3-N && git branch -d task/T3-N`.
7. Update STATUS.md.

## Hard halts

- Husky pre-commit failures → fix and retry; never `--no-verify`.
- Test failures → fix code; commit only when tests pass.
- T3.3 refactor: state-render.js was created in W2 — modify in-place is allowed within stacked PR scope.

## Source of truth

- Master plan: `~/.claude/plans/monte-o-planejamento-dessa-encapsulated-aho.md`
- W1 PR: https://github.com/marciohideaki/enterprise-hseos/pull/41
- W2 PR: https://github.com/marciohideaki/enterprise-hseos/pull/42
- ADR: `/opt/hideakisolutions/second-brain/_decisions/2026-04-25-agent-state-tracking-proposal.md`
