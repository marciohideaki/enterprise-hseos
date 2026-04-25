# RESUME-PROMPT — 20260425-1900-state-w1-foundation

If you (Claude or another agent) are resuming this run after `/clear` or session kill, follow this protocol:

## Context loading (mandatory, in order)

1. Read `PLAN.md` (this run-dir) — Wave 1 task graph, acceptance criteria, model tiers.
2. Read `STATUS.md` — current task statuses, last commit per task.
3. Read `handoffs/*.md` (if any) — Commander-extracted summaries from prior subagent returns.
4. **Do NOT** re-read `INTAKE.md`, `logs/*`, `prompts/*` — re-inflates context.
5. **Do NOT** re-explore the codebase — exploration was completed in /plan mode and is captured in PLAN.md.

## Where you stopped

Check `STATUS.md` task table for `IN_PROGRESS` or `PENDING` rows. The first `PENDING` row is your next dispatch.

## Resuming dispatch

1. For each `PENDING` task in Wave 1:
   - `cd /opt/hideakisolutions/enterprise-hseos`
   - `./scripts/governance/worktree-manager.sh create T<n> feature/state-tracking-w1-foundation`
   - Dispatch subagent (or write directly per acceptance criteria in PLAN.md) to write file to `.worktrees/T<n>/<path>`
   - `./scripts/governance/worktree-manager.sh validate T<n>`
   - Generate commit message (conventional, no AI mentions, ≤100 chars subject)
   - `./scripts/governance/validate-commit-msg.sh "<msg>"`
   - `./scripts/governance/worktree-manager.sh commit T<n> "<msg>"`
   - `./scripts/governance/worktree-manager.sh merge T<n> feature/state-tracking-w1-foundation`
   - `./scripts/governance/worktree-manager.sh remove T<n>`
   - Update STATUS.md task row with commit SHA + status.
2. After all 5 tasks done: write `WAVE-1-REPORT.md`, update STATUS to `WAVE-1-COMPLETED → READY-FOR-G4`, halt for human PR open.

## Hard halts

- Validate-commit-msg.sh rejection → halt, escalate; never bypass.
- Worktree-manager.sh validate failure → halt, fix in worktree, re-validate.
- Branch protection refuses merge → halt, escalate to human.

## Source of truth

- Master plan (epic-level): `/home/annonymous/.claude/plans/monte-o-planejamento-dessa-encapsulated-aho.md`
- ADR: `/opt/hideakisolutions/second-brain/_decisions/2026-04-25-agent-state-tracking-proposal.md`
- Skill: `/home/annonymous/.claude/skills/dev-squad/SKILL.md` (canonical) + `.hseos/workflows/dev-squad/workflow.md` (HSEOS overlay)
