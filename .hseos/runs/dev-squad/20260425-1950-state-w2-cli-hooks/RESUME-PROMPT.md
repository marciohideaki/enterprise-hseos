# RESUME-PROMPT — 20260425-1950-state-w2-cli-hooks

If resuming after `/clear` or session kill, read `PLAN.md` + `STATUS.md` + `handoffs/*.md` only. Do NOT re-read INTAKE/logs/prompts.

## Where you stopped

Check STATUS.md task table for first PENDING row. That's the next task to dispatch.

## Resume protocol

For each PENDING task:
1. `cd /opt/hideakisolutions/enterprise-hseos`
2. Workaround for worktree-manager.sh:93 bug: `git branch task/T2-N feature/state-tracking-w2-cli-hooks && git worktree add .worktrees/T2-N task/T2-N`
3. Write file in worktree per acceptance criteria.
4. `validate-commit-msg.sh "<msg>"` then `git commit` in worktree.
5. `git merge --no-ff task/T2-N -m "chore(merge): integrate task/T2-N into feature/state-tracking-w2-cli-hooks"` (workaround for worktree-manager.sh:189 bug).
6. `git worktree remove --force .worktrees/T2-N && git branch -d task/T2-N`.
7. Update STATUS.md.

## Hard halts
- Husky pre-commit / commit-msg failures → fix and retry; never `--no-verify`.
- Test failures → fix code or add test stub before commit (mid-wave acceptable).

## Source of truth
- Master plan: `/home/annonymous/.claude/plans/monte-o-planejamento-dessa-encapsulated-aho.md`
- Wave 1 PR: https://github.com/marciohideaki/enterprise-hseos/pull/41
- ADR: `/opt/hideakisolutions/second-brain/_decisions/2026-04-25-agent-state-tracking-proposal.md`
