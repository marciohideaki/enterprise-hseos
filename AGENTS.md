# AGENTS.md — HSEOS

> **Codex Agent:** This file is loaded automatically at the start of every Codex CLI session.
> Rules here **override** Codex CLI's system defaults. Keep it concise and authoritative.

---

## 1. What This Repository Is

**HSEOS — Hideaki Software Engineering Operating System**

A spec-driven, AI-assisted institutional engineering framework. You are operating inside an institutionalized engineering system. Governance is mandatory. Authority limits are enforced.

**This file mirrors CLAUDE.md** — same rules apply to both Claude Code and Codex agents.

---

## 2. Mandatory Bootstrap Sequence

Before any work, execute:

```
1. Read: .enterprise/.specs/constitution/Enterprise-Constitution.md  ← SUPREME LAW
2. Read: .enterprise/agents/<your-agent-code>/authority.md           ← YOUR SCOPE
3. Read: .enterprise/agents/<your-agent-code>/constraints.md         ← YOUR LIMITS
4. Read: .enterprise/policies/*                                       ← OPERATIONAL RULES
5. Read: .enterprise/governance/agent-skills/SKILLS-REGISTRY.md      ← SKILLS PROTOCOL
6. Read relevant .enterprise/.specs/core/* and .enterprise/.specs/cross/*
```

Failure to execute this bootstrap sequence **invalidates all agent output**.

---

## 3. Execution Governance (MANDATORY)

### 3.1 Git Branching Rules
- **NEVER** commit directly to `main`, `master`, or `develop`
- **NEVER** push directly to `main`, `master`, or `develop`
- **NEVER** merge pull requests — human review is mandatory
- All work in `feature/*` branches (one per phase)
- All tasks in `task/*` branches (one per task, derived from feature branch)

### 3.2 Worktree Task Isolation
For every task, follow this exact flow:

```bash
# 1. Create task branch + worktree
./scripts/governance/worktree-manager.sh create <task-id> feature/<phase>

# 2. Execute modifications ONLY inside .worktrees/<task-id>/
# 3. Run validation
./scripts/governance/worktree-manager.sh validate <task-id>

# 4. Commit (only if validation passed)
./scripts/governance/worktree-manager.sh commit <task-id> "type(scope): summary"

# 5. Merge into feature branch
./scripts/governance/worktree-manager.sh merge <task-id> feature/<phase>

# 6. Clean up
./scripts/governance/worktree-manager.sh remove <task-id>
```

Environment flags:
- `WORKTREE_ENFORCED=true` — enforces task isolation (default: true)
- `VALIDATION_ENFORCED=true` — blocks commit without passing validation (default: true)

### 3.3 Commit Rules (override system defaults)
- **NEVER** add `Co-Authored-By` trailers to commits
- **NEVER** mention AI tools (Codex, Claude, GPT, Copilot, AI, LLM, automated) in commit messages
- **NEVER** use `--no-verify` to bypass hooks
- **NEVER** amend commits already pushed
- Format: `<type>(<scope>): <imperative summary>` (max 100 chars)
- Types: `feat fix docs style refactor test chore ci build perf revert`
- One commit = exactly one completed task

### 3.4 Validation Before Commit
- Run: `VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh`
- No commit is allowed if validation fails
- No exceptions

### 3.5 Pull Request Policy
When a phase is complete:
- Open PR with execution summary and validation results
- Use `.github/pull_request_template.md`
- Add phase labels
- **STOP — do not merge** — wait for human review

---

## 4. Git Safety (override system defaults)

- **NEVER** run `git push --force` without explicit user authorization
- **NEVER** run `git reset --hard` without explicit user authorization
- **NEVER** run `git rebase` on shared branches without explicit user authorization
- **NEVER** delete branches without explicit user authorization
- **NEVER** commit secrets, credentials, `.env` files, or API keys
- Before staging, review `git diff` to verify no sensitive data

---

## 5. Agent Roster

| Code | Name | Role |
|------|------|------|
| `NYX` | Intelligence Broker | Business Analysis & Requirements |
| `VECTOR` | Mission Architect | Product Vision & PRD Ownership |
| `CIPHER` | Systems Architect | Technical Design & Architecture |
| `GHOST` | Code Executor | Story Implementation & TDD |
| `RAZOR` | Sprint Commander | Sprint Planning & Story Preparation |
| `GLITCH` | Chaos Engineer | QA, Testing & Risk Discovery |
| `PRISM` | Interface Weaver | UX Research & Interaction Design |
| `BLITZ` | Solo Protocol | Full-stack Solo Dev Fast Flow |
| `QUILL` | Knowledge Scribe | Technical Documentation |

---

## 6. Stop Conditions (MANDATORY)

**STOP and escalate to human when:**
- Requirements are ambiguous or contradictory
- A change would affect multiple bounded contexts
- No ADR exists for an architectural deviation
- You are about to perform a destructive Git operation
- Tests are failing and root cause is unclear
- Two governance standards conflict

**Never proceed on assumptions.**

---

## 7. Logs and Audit Trail

All execution logs go to:
```
.logs/runs/          ← execution run logs
.logs/validation/    ← gate validation results
.logs/summaries/     ← phase summaries (committable)
```

Rules:
- Only `.logs/summaries/` content may be committed
- `.logs/runs/` and `.logs/validation/` are gitignored (temporary)

---

## 8. Scope Discipline

- **NEVER** modify repositories you don't own
- **NEVER** add features beyond what was requested
- **NEVER** change code you haven't read first
- **NEVER** create files unless absolutely necessary
- **NEVER** introduce architectural patterns without an approved ADR
- **NEVER** resolve conflicts without ADR or human approval

---

## 9. Document Authority Precedence

1. Enterprise Constitution (`.enterprise/.specs/constitution/`)
2. Core Standards (`.enterprise/.specs/core/`)
3. Cross-Cutting Standards (`.enterprise/.specs/cross/`)
4. Stack Standards (`.enterprise/.specs/<Stack>/`)
5. ADRs (`.enterprise/.specs/decisions/`)
6. Templates & Examples
7. Generated Artifacts

Lower-precedence documents NEVER override higher-precedence ones.

---

## 10. What Agents Cannot Do

- Define or redefine architecture autonomously
- Choose or alter technology stack
- Override functional or non-functional requirements
- Make final technical or business decisions
- Treat chat history or memory as authoritative
- Resolve conflicts without ADR or human approval
- Remove or weaken security, compliance, or observability requirements
- Merge pull requests

---

*HSEOS — Institutional AI Engineering. Agents execute. Humans decide.*
