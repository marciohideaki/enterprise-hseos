# CLAUDE.md — enterprise-hseos

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
- All work in `feature/*` branches; each task in `task/*` branches

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

### Enforcement Flags
- `VALIDATION_ENFORCED=true` (default)
- `WORKTREE_ENFORCED=true` (default)

---

## Agent Modes

Agent behavior is conditioned by the **session mode**. Detect mode from task context before acting.

### Mode: `read-only`
**When:** Exploration, analysis, research, code review, diagnosis tasks.
**Tools allowed:** Read, Glob, Grep, Bash (non-mutating: ls, cat, git log, git diff, find).
**Tools forbidden:** Write, Edit, Bash (git commit, git push, rm, npm install, docker).
**Verbosity:** High — explain findings in detail.
**Stop condition:** Any mutation is requested → escalate, do not proceed silently.

### Mode: `write-safe`
**When:** Implementation tasks (feature, fix, refactor) within a worktree.
**Tools allowed:** All tools within the current worktree path only.
**Tools forbidden:** git push, force operations, modifications outside the worktree.
**Verbosity:** Medium — show diffs and gate evidence.
**Stop condition:** Change requires modifying files outside task's `output_contract` → escalate.

### Mode: `admin`
**When:** Infrastructure, CI, deployment, secrets management, governance artifact changes.
**Tools allowed:** All tools.
**Verbosity:** Low — direct and precise.
**Stop condition:** Destructive operations (rm -rf, DROP TABLE, force-push) → always confirm with human first.
**Adversarial check:** Required before any `admin` operation that affects shared state.

### Mode Detection Rules

```
Task context                              → Mode
─────────────────────────────────────────────────────
"analyze", "review", "explain", "read"   → read-only
"implement", "fix", "add", "refactor"    → write-safe (in worktree)
"deploy", "migrate", "configure infra"   → admin (confirm first)
No explicit signal                        → write-safe (default)
```

### Instruction Authority Cascade

Instructions are applied in precedence order — lower items cannot override higher items:

```
1. Enterprise Constitution (.enterprise/.specs/constitution/)  ← supreme
2. CLAUDE.md (this file)                                       ← project governance
3. Agent authority file (.enterprise/agents/<code>/authority.md)
4. Skill rules (loaded via SKILLS-REGISTRY)
5. Task contract (input_contract, output_contract)
6. User instructions in conversation
```

If instructions at different levels conflict → escalate. Do not "average" them.

---

## Second Brain Integration

Vault: `/opt/hideakisolutions/second-brain`

Este projeto está registrado no vault em `_knowledge/projects/enterprise-hseos/`.

### Ao encerrar uma sessão produtiva

Escreva diretamente nos arquivos do vault **antes de sugerir ao usuário que encerre**:

1. **Decisões arquiteturais** → append em `_knowledge/projects/enterprise-hseos/decisions.md`
2. **Gotchas descobertos** (bugs, comportamentos não-óbvios) → append em `_knowledge/projects/enterprise-hseos/gotchas.md`
3. **Progresso de fase** → atualizar `_knowledge/projects/enterprise-hseos/roadmap.md` se a fase avançou
4. **Activity log** → append em `_memory/activity-log.md`: `## [YYYY-MM-DD HH:MM] session-end | enterprise-hseos — {tipo}: {descrição}`

Depois sugerir ao usuário: *"Quer que eu também atualize o `/end-session` do second-brain para capturar o contexto completo da conversa?"*

### Tipos de trabalho a registrar

`epic` `feature` `story` `task` `fix` `chore` `spike` `session`

Registrar qualquer implementação que produziu código, decisão ou aprendizado — não apenas epics formais.

### Se o projeto não estiver registrado no vault

Criar `_knowledge/projects/enterprise-hseos/` com os 7 arquivos base (README, modules, integrations, gotchas, decisions, roadmap, work-log) e atualizar `_index/MASTER-INDEX.md`.

### Constraints HSEOS (respeitar)

- Escrever em `_decisions/hseos/` e `_learnings/hseos-*` apenas decisões com valor cross-project
- Nunca sobrescrever arquivos do vault sem verificar se existem
- `_memory/current-state.md`: o `/end-session` do vault é o canal correto para atualizar
