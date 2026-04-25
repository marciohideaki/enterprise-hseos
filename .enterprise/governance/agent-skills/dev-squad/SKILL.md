---
name: dev-squad
tier: full
version: "1.0"
description: "Full protocol for heterogeneous parallel batch execution under SWARM. Commander (Opus) plans + extracts handoffs; Squad (Sonnet/Haiku) executes in worktree-isolated parallel waves. 1 task = 1 commit; 1 wave = 1 PR."
license: Apache-2.0
canonical_source: "~/.claude/skills/dev-squad/SKILL.md"
metadata:
  owner: platform-governance
  consumer: SWARM
---

# Dev Squad — Full Protocol (HSEOS Overlay)

> Tier 2. For the canonical protocol definition, see `~/.claude/skills/dev-squad/SKILL.md` (global skill loaded in SWARM bootstrap).
>
> This file adds the **HSEOS-specific overlay** on top of the canonical skill: governance scripts, commit rules, run directory convention, agent delegation rules.

---

## Relationship to the canonical skill

The canonical `dev-squad` skill lives globally at `~/.claude/skills/dev-squad/SKILL.md` so it is usable in any project. SWARM's `mandatory_reads` loads both this overlay and the canonical source.

**What the canonical skill provides:**
- 5-phase protocol (Intake, Study, Plan, Execute, Consolidate)
- Model matrix (haiku/sonnet/opus × effort)
- Commander-extract handoff protocol
- Detached mode (RESUME-PROMPT.md for clean-context resume)
- Template files: `PLAN.md`, `TASK-PROMPT.md`, `HANDOFF.md`, `WAVE-REPORT.md`, `RESUME-PROMPT.md`

**What this HSEOS overlay adds:**
- Mandatory governance scripts
- Commit message rules
- Run directory convention (`.hseos/runs/dev-squad/`)
- Delegation map to other HSEOS agents

---

## HSEOS Governance Scripts (mandatory)

All located in `scripts/governance/`:

| Script | Phase | Purpose |
|---|---|---|
| `check-branch.sh` | before wave dispatch | Validates base branch matches `feature/*` |
| `worktree-manager.sh create <task-id> <base>` | per task, before dispatch | Creates `task/<task-id>` branch + `.worktrees/<task-id>/` |
| `worktree-manager.sh validate <task-id>` | after subagent returns OK | Runs `quality-gates.sh` (6 gates) |
| `validate-commit-msg.sh "<msg>"` | before commit | Validates conventional commit + enforces forbidden-trailer rules |
| `worktree-manager.sh commit <task-id> "<msg>"` | after validate | Creates 1 commit on `task/<task-id>` |
| `worktree-manager.sh merge <task-id> <base>` | after commit | Merges `task/<task-id>` → `feature/*` with `--no-ff` |
| `worktree-manager.sh remove <task-id>` | after merge | Removes worktree + cleans `.worktree-meta` |

SWARM **never** invokes `git worktree add`, `git commit`, `git merge`, or `git push` directly in a worktree flow. Always through the scripts.

---

## Commit Message Rules (HSEOS-enforced)

Format: `<type>(<scope>): <summary>`
Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `build`, `perf`, `revert`
Subject ≤100 chars.

**Forbidden (validator will reject):**
- `Co-Authored-By:` trailer
- Mentions of `Claude`, `AI`, `LLM`, `Anthropic`, `GPT`, `Copilot`

SWARM generates commit messages for each task based on the task's Goal and FILES CHANGED from the subagent return. If `validate-commit-msg.sh` rejects, SWARM halts and escalates — never bypasses.

---

## Run Directory Convention

Under HSEOS:
```
.hseos/runs/dev-squad/{run-id}/
├── INTAKE.md
├── STUDY.md              # optional
├── PLAN.md               # G2 approval marker
├── STATUS.md             # updated between waves
├── RESUME-PROMPT.md      # for detached mode
├── handoffs/
│   └── T{a}-to-T{c}.md   # Commander-extracted, ≤40 lines
├── prompts/
│   └── T{n}.md           # audit of prompt sent to subagent
├── logs/
│   └── T{n}.md           # full subagent return
└── WAVE-{k}-REPORT.md
```

`run-id` = `{YYYYMMDD-HHMM}-{slug}` (e.g. `20260421-1830-ui-bugs-sweep`).

---

## Delegation Map

SWARM delegates (stops and returns control) when:

| Situation | Delegate to |
|---|---|
| Missing requirements / unclear scope | NYX (discovery) |
| Scope change during execution | VECTOR (planning) |
| Architecture decision or ADR required | CIPHER (solutioning) |
| Full epic delivery flow with release/runtime phases | ORBIT (epic delivery) |
| Single-track solo work | BLITZ (solo protocol) |
| Story preparation / sprint planning | RAZOR |
| Quality gate adversarial review | GLITCH |
| Documentation output | QUILL |
| Release artifact publication | FORGE |
| K8s deployment | KUBE |
| Runtime verification | SABLE |

SWARM is a control-plane fan-out commander. It does not absorb any of the above authorities.

---

## Gates (HSEOS contract)

| Gate | When | Who |
|---|---|---|
| G1 — Intake disambiguation | Conditional, after prose intake | Human (via AskUserQuestion) |
| **G2 — Plan approval** | **Mandatory, after Plan phase** | **Human** |
| G3 — Wave review | Conditional (BLOCKED or risk flag) | Human |
| G4 — PR open | After Consolidate | Human (runs `gh pr create`) |
| G5 — PR merge | After CI + human review | Human reviewer |

Bypass = constitution violation.

---

## Anti-patterns (HSEOS-specific)

| Anti-pattern | Consequence |
|---|---|
| Raw `git worktree add` instead of `worktree-manager.sh create` | Quality gates skipped; `.worktree-meta` not updated |
| Commit without `validate-commit-msg.sh` | Forbidden trailers leak (Co-Authored-By, AI mentions) |
| Opening PR as agent (not human) | Violates branch-protection; review process bypassed |
| Merging PR as agent | Constitutional violation; human reviewer is mandatory |
| Bypassing G2 because "the batch is small" | Governance precedent damaged; next batch becomes looser |
| Loading `INTAKE.md` + `STUDY.md` + all `logs/` on resume | Re-inflates context; use only PLAN + STATUS + existing handoffs |

---

## Exit Criteria

- [ ] All waves executed or correctly halted
- [ ] 1 commit per OK task (all messages pass `validate-commit-msg.sh`)
- [ ] 1 WAVE-REPORT per wave
- [ ] Draft PR body ready, using `.github/pull_request_template.md`
- [ ] Human-initiated PR; human-approved merge
- [ ] Gotchas surfaced to `_knowledge/projects/<project>/gotchas.md` (second-brain)
- [ ] Run dir persisted in `.hseos/runs/dev-squad/{run-id}/` for audit
