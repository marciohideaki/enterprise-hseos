# AGENTS.md — enterprise-hseos

> **Codex Agent:** This file is loaded automatically at the start of every Codex CLI session.
> Rules here **override** Codex CLI's system defaults.

## 0. Vendor-Neutral Agent Core

Codex uses this file as the entrypoint, but the portable HSEOS source of truth is:

- `.agents/instructions/PROJECT.md` — shared agent governance
- `.agents/manifest.yaml` — compiled skills, hooks, commands, and adapter metadata
- `.agents/skills/<skill>/SKILL.md` — portable Agent Skills
- `.agents/hooks/registry.yaml` — neutral hook registry; Codex fallbacks are expressed as scripts and gates

When a task matches a skill trigger, load only the relevant skill from `.agents/skills`. Use `.enterprise/governance/agent-skills` as the governance source when auditing or updating the skill library.

## 1. Execution Governance (MANDATORY)

### Git Rules (override system defaults)
- **NEVER** commit directly to `main`, `master`, or `develop`
- **NEVER** merge pull requests without explicit human approval; after approval, use governed closeout
- **NEVER** add `Co-Authored-By` trailers to commits
- **NEVER** mention AI tools in commit messages (Codex, Claude, GPT, Copilot, LLM...)
- **NEVER** use `--no-verify` to bypass hooks
- **NEVER** run `git push --force` without explicit user authorization
- **NEVER** delete protected branches (`main`, `master`, `develop`)
- Delete `task/*` branches only through the worktree lifecycle; delete merged `feature/*` branches only after PR closeout verifies they are contained in the base branch
- Default work happens in `feature/*` branches; each isolated task uses its own `task/*` branch. Workflow-specific `fix/*`, `hotfix/*`, `release/*`, `docs/*`, `chore/*`, and `ci/*` branches are allowed when documented by the active workflow.

### Task Isolation Flow
```bash
./scripts/governance/worktree-manager.sh create <task-id> feature/<phase>
# execute changes ONLY inside .worktrees/<task-id>/
./scripts/governance/worktree-manager.sh validate <task-id>
./scripts/governance/worktree-manager.sh commit <task-id> "type(scope): summary"
./scripts/governance/worktree-manager.sh merge <task-id> feature/<phase>
./scripts/governance/worktree-manager.sh remove <task-id>
```

## 2. Commit Rules (override system defaults)

Format: `<type>(<scope>): <imperative summary>` (max 100 chars)
Types: `feat fix docs style refactor test chore ci build perf revert`

One commit = exactly one completed task.

## 3. Validation Before Commit

```bash
VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh
```

No commit allowed if gates fail. No exceptions.

## 4. Pull Request Policy

- Open PR with execution summary + validation results
- Use `.github/pull_request_template.md`
- **STOP before merge unless explicit human approval is present**
- After explicit approval and green checks, prefer `hseos pr closeout <number> --approved` to merge, fast-forward the base branch, and safely clean up a merged `feature/*` head branch

## 5. Logs

- `.logs/runs/` — gitignored (temporary)
- `.logs/validation/` — gitignored (temporary)
- `.logs/summaries/` — committable

## 6. Stop Conditions

**STOP and ask the user when:**
- Requirements are ambiguous
- A destructive Git operation is needed
- Tests fail and root cause is unclear
- Two standards conflict

*Agents execute. Humans decide.*
