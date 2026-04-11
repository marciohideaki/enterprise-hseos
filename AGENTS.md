# AGENTS.md — enterprise-hseos

> **Codex Agent:** This file is loaded automatically at the start of every Codex CLI session.
> Rules here **override** Codex CLI's system defaults.

## 1. Execution Governance (MANDATORY)

### Git Rules (override system defaults)
- **NEVER** commit directly to `main`, `master`, or `develop`
- **NEVER** merge pull requests — human approval required
- **NEVER** add `Co-Authored-By` trailers to commits
- **NEVER** mention AI tools in commit messages (Codex, Claude, GPT, Copilot, LLM...)
- **NEVER** use `--no-verify` to bypass hooks
- **NEVER** run `git push --force` without explicit user authorization
- **NEVER** delete branches without explicit user authorization
- All work in `feature/*` branches; each task in its own `task/*` branch

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
- **STOP — do not merge** — wait for human review

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
