# CLAUDE.md — HSEOS

> **Claude Code Agent:** Read this file completely before any action in this repository.

## Project
Repository: `enterprise-hseos`

## 5. Governance Rules (Non-Negotiable)

### 5.1 Stop Conditions
Agents MUST stop and escalate when:
- Ambiguity exists in requirements or architecture
- Two standards conflict
- A decision requires a trade-off
- A governance artifact is missing

Stop means: **do not proceed**. Produce a clarification request or ADR draft.

### 5.2 ADR Requirement
Any of the following triggers a mandatory ADR draft:
- Architectural change
- Breaking change (API, contract, event schema)
- Security posture change
- Performance-affecting change
- Governance/standards modification
- Exception to any standard

ADR location: `.enterprise/.specs/decisions/ADR-XXXX-<title>.md`
ADR template: `.enterprise/.specs/decisions/_TEMPLATE.md`

### 5.3 No Silent Deviations
Agents MUST NEVER:
- Silently deviate from a standard
- "Average" conflicting rules
- Pick the easiest implementation
- Invent requirements not in the repo

### 5.4 Skill Loading Protocol
```
1. Always read SKILLS-REGISTRY.md first
2. Match task context to triggers
3. Load SKILL-QUICK.md (Tier 1) — default for active tasks
4. Load SKILL.md (Tier 2) — only for deep analysis or violation fixing
5. Never load all skills simultaneously
```

---

## 6. Repository Navigation

### For Agents
```
.enterprise/
├── .specs/constitution/     ← START HERE (supreme authority)
├── .specs/core/             ← All agents read before work
├── .specs/cross/            ← Mandatory cross-cutting standards
├── .specs/<Stack>/          ← Load when working in that stack
├── .specs/decisions/        ← Approved ADRs (binding)
├── agents/<code>/           ← Load your own agent authority
├── governance/agent-skills/ ← Skills (via registry)
└── policies/                ← Operational policies

.hseos/
├── agents/                  ← Agent YAML definitions
├── workflows/               ← Engineering workflow files
└── skills/                  ← Agent skill definitions
```

## Execution Governance

See full rules: `scripts/governance/quality-gates.sh`

### Git Rules
- **NEVER** commit directly to `main`, `master`, or `develop`
- **NEVER** merge pull requests — human approval required
- **NEVER** add `Co-Authored-By` trailers
- **NEVER** mention AI tools in commit messages (Claude, Codex, GPT, LLM...)
- All work in `feature/*` branches cut from `develop`; each task in `task/*` branches

### Task Flow
```bash
./scripts/governance/worktree-manager.sh create <task-id> feature/<phase>
# work in .worktrees/<task-id>/
./scripts/governance/worktree-manager.sh validate <task-id>
./scripts/governance/worktree-manager.sh commit <task-id> "type(scope): summary"
./scripts/governance/worktree-manager.sh merge <task-id> feature/<phase>
./scripts/governance/worktree-manager.sh remove <task-id>
```

### Commit Format
`<type>(<scope>): <summary>` — types: feat fix docs style refactor test chore ci build

### Logs
- `.logs/runs/` — run logs (gitignored)
- `.logs/validation/` — gate results (gitignored)
- `.logs/summaries/` — phase summaries (committable)

## Wave 1 Runtime Surfaces

Wave 1 standardizes four runtime command groups:

- `hseos policy` — structural execution governance
- `hseos run` — mission execution runtime
- `hseos ops` — execution observability surface
- `hseos cortex` — recall intelligence

These are HSEOS-native capabilities and should be described only in HSEOS terms.

### Enforcement Flags
- `VALIDATION_ENFORCED=true` (default)
- `WORKTREE_ENFORCED=true` (default)
