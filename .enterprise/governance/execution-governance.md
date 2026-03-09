# Execution Governance

**Authority:** Enterprise Constitution (`.enterprise/.specs/constitution/Enterprise-Constitution.md`)
**Status:** Mandatory
**Scope:** All AI agent executions in any HSEOS-governed repository
**Version:** 1.0

---

## 1. Global Rules

- Never push directly to `main`, `master`, or `develop`.
- Never merge Pull Requests — human review is mandatory.
- Never add co-authors to commits.
- Never reference AI systems in commit messages (Claude, Codex, OpenAI, GPT, LLM, Copilot, automated).
- Never bypass hooks (`--no-verify` is forbidden).

---

## 2. Execution Model

Work is organized by **phase** (`feature/*`) and **task** (`task/*`).

### 2.1 Phase Branch
One `feature/*` branch per execution phase:
- `feature/phase-discovery`
- `feature/phase-architecture`
- `feature/phase-implementation`

### 2.2 Task Branches
One `task/*` branch per task, derived from the phase branch:
- `task/domain-model`
- `task/api-spec`
- `task/auth-service`

---

## 3. Worktree Task Isolation Flow

For every task, enforce this exact lifecycle:

```
1. CREATE:   task/* branch from feature/*
             git worktree at .worktrees/<task-id>
2. EXECUTE:  modifications ONLY inside .worktrees/<task-id>
3. VALIDATE: run quality gates — must PASS
4. COMMIT:   one commit = one completed task
5. MERGE:    task/* → feature/* (no-ff merge)
6. REMOVE:   worktree + task branch deleted
```

**Tooling:** `scripts/governance/worktree-manager.sh`
**Flags:**
- `WORKTREE_ENFORCED=true` — enforces isolation (default)
- `VALIDATION_ENFORCED=true` — blocks commit without passing gates (default)

---

## 4. Validation Rule

No commit is allowed if validation fails. No exceptions.

**Tooling:** `scripts/governance/quality-gates.sh`

### 4.1 Documentation Phases
- Required files exist
- Markdown syntax is valid
- No unresolved template variables or placeholders remain
- Governance references present

### 4.2 Code Phases
- Lint passes
- Tests pass
- Build succeeds
- No secrets in staged files

---

## 5. Commit Policy

- One commit = exactly one completed task
- Mixed-task commits are disallowed
- Format: `<type>(<scope>): <imperative summary>` (max 100 chars)
- Allowed types: `feat fix docs style refactor test chore ci build perf revert`
- **Validator:** `scripts/governance/validate-commit-msg.sh`

---

## 6. Branch Protection Policy

Protected branches: `main`, `master`, `develop`
- Require PR with at least 1 human approval
- Dismiss stale reviews on new push
- Require quality gate status checks to pass
- No direct push (force or otherwise)
- **Guard:** `scripts/governance/check-branch.sh` (enforced via `.husky/pre-commit`)
- **Config:** `.github/branch-protection.yml`

---

## 7. Pull Request Policy

When a phase is complete:
1. Open PR automatically
2. Use template: `.github/pull_request_template.md`
3. Add phase labels
4. Include execution summary and validation results

Rules:
- **AI agents must never merge pull requests**
- Human review is mandatory
- Stop execution after opening the PR — wait for next instruction

---

## 8. Logging Policy

All execution logs under `.logs/`:
```
.logs/runs/          — execution run logs (gitignored)
.logs/validation/    — gate results (gitignored)
.logs/summaries/     — phase summaries (committable)
```

Rules:
- Only `.logs/summaries/` may be committed
- `.logs/runs/` and `.logs/validation/` are temporary — must remain gitignored

---

## 9. Operational Control Actions

Valid manual actions (human-initiated only):
- `approve` — approve a pending plan or PR
- `retry`   — retry a failed step (transient failures only)
- `abort`   — terminate a run
- `deploy`  — trigger deployment after merged PR

Guards:
- Terminal state runs cannot be retried or restarted
- Deployment requires merged PR + human approval
- Serial execution per project to prevent branch/worktree collision

---

## 10. Live Integration Gating

Activation of `scm_live` or `publication_live` is blocked unless:
- All checklist items confirmed
- Valid credentials and endpoints configured
- Diagnostic audit passed per project

---

## 11. Idempotency and Deduplication

- Webhook events must be deduplicated (by event ID + delivery ID)
- Runs are idempotent per canonical trigger
- Re-triggering an already-completed run must be a no-op

---

## 12. Enforcement Hooks

| Hook | File | Gate Enforced |
|------|------|--------------|
| pre-commit | `.husky/pre-commit` | Branch protection + quality gates |
| commit-msg | `.husky/commit-msg` | Commit message validation |
| quality-gates | `scripts/governance/quality-gates.sh` | Full validation suite |
| worktree | `scripts/governance/worktree-manager.sh` | Task isolation lifecycle |
| branch-guard | `scripts/governance/check-branch.sh` | Protected branch enforcement |

---

## 13. Workflow Trigger Governance

For repositories that publish documentation images (`.github/workflows/docs-image.yml`):

- `on.push.branches` MUST include:
  - `main`
  - `develop`
  - `feature/**`
  - `hotfix/**`
  - `release/**`
- `workflow_dispatch` MUST be enabled.
- Docs Pages publication (`docs-pages.yml`) SHOULD remain restricted to stable branches (`main`, `develop`) unless explicitly approved.
- Enforcement is automatic via `scripts/governance/quality-gates.sh` (Gate 6).

---

## 14. Agent Entry Points

| Runtime | File | Status |
|---------|------|--------|
| Claude Code | `CLAUDE.md` | ✅ Active |
| Codex CLI | `AGENTS.md` | ✅ Active |

Both files enforce identical governance rules.

---

*Governance is not optional. Execution without governance is unauthorized.*
