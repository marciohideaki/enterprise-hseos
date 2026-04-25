# RESUME-PROMPT — 20260425-1942-state-w7-kanban

If resuming after `/clear` or session kill, read PLAN.md + STATUS.md + handoffs/*.md only.

## Resume

For each PENDING task:
1. `cd /opt/hideakisolutions/enterprise-hseos`
2. `git branch task/T7-N feature/state-tracking-w7-kanban && git worktree add .worktrees/T7-N task/T7-N`
3. Implement file(s) per acceptance criteria in PLAN.md.
4. `validate-commit-msg.sh` then `git commit` in worktree.
5. `git merge --no-ff task/T7-N -m "chore(merge): integrate task/T7-N into feature/state-tracking-w7-kanban"`.
6. `git worktree remove --force .worktrees/T7-N && git branch -d task/T7-N`.
7. Update STATUS.md.

## Source of truth

- Master plan: `~/.claude/plans/monte-o-planejamento-dessa-encapsulated-aho.md` (Sprint 3 — Wave 7 revisado)
- ADR: `/opt/hideakisolutions/second-brain/_decisions/2026-04-25-agent-state-tracking-proposal.md`
- Snapshot lib contract in PLAN.md.
