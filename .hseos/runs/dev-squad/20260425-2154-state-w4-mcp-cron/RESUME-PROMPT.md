# RESUME-PROMPT — 20260425-2154-state-w4-mcp-cron

Read PLAN.md + STATUS.md + handoffs/*.md only.
Source of truth: `~/.claude/plans/monte-o-planejamento-dessa-encapsulated-aho.md` Sprint 2 / Wave 4.

For each PENDING task:
1. cd /opt/hideakisolutions/enterprise-hseos
2. `git branch task/T4-N feature/state-tracking-w4-mcp-cron && git worktree add .worktrees/T4-N task/T4-N`
3. Implement file(s) per acceptance criteria.
4. validate-commit-msg + git commit in worktree.
5. `git merge --no-ff task/T4-N -m "chore(merge): integrate task/T4-N into feature/state-tracking-w4-mcp-cron"`.
6. Cleanup worktree + branch.
7. Update STATUS.md.
