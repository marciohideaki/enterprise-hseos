---
name: dev-squad
description: Full protocol for heterogeneous parallel batch execution under SWARM. Commander (Opus) plans + extracts handoffs; Squad (Sonnet/Haiku) executes in worktree-isolated parallel waves. 1 task = 1 commit; 1 wave = 1 PR.
version: "1.1"
owner: platform-governance
tier: full
source: .enterprise/governance/agent-skills/dev-squad/SKILL.md
quick: .enterprise/governance/agent-skills/dev-squad/SKILL-QUICK.md
portable: true
license: Apache-2.0
---

# Dev Squad — Full Protocol

> Tier 2. Canonical SKILL.md per ADR-0006 (Standalone Architecture).
>
> This file is the **single source of truth** for the dev-squad protocol — five-phase workflow, model matrix, governance scripts, commit rules, run directory convention, delegation map, and state-emission contract. The `.agents/skills/dev-squad/` compiled output mirrors this file via the agent-core compiler.

---

## Five-Phase Protocol

| # | Phase | Purpose | Owner |
|---|---|---|---|
| 1 | **Intake** | Gather batch description; create run-dir; verify scope is heterogeneous and parallelizable | Commander |
| 2 | **Study** | (Optional) Investigate code, dependencies, gotchas before planning | Commander or delegated subagent |
| 3 | **Plan** | Decompose into atomic tasks; declare DAG, tier matrix, handoffs; sign PLAN.md (G2) | Commander (Opus) |
| 4 | **Execute** | Dispatch parallel waves of subagents in worktrees; consolidate after each wave | Commander + Squad |
| 5 | **Consolidate** | Aggregate WAVE-REPORTs; draft PR body; surface gotchas | Commander |

## Model Matrix

| Effort | Default model | When to override |
|---|---|---|
| Trivial CRUD / mechanical refactor | Haiku 4.5 | Never — Haiku always sufficient |
| Standard implementation, single domain | Sonnet 4.6 | Bump to Opus only if explicit signal |
| Schema design / multi-domain integration / audit | Opus 4.7 | Default |
| Cross-cutting architectural refactor | Opus 4.7 | Default |

Commander runs Opus; Squad workers default Sonnet 4.6 with Haiku/Opus opt-in declared in PLAN.md.

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
| G5 — PR merge | After CI + explicit human approval | Human reviewer or governed closeout operator |

Bypass = constitution violation.

---

## State emission contract (Wave 5a, Sprint 2)

When the HSEOS state-tracking subsystem is installed (`hseos state-emit` available on `$PATH`), the skill MUST emit structured events at five phase boundaries. Failure to emit is **best-effort** — it never blocks execution. If `HSEOS_CURRENT_RUN_ID` is not set, the skill skips emission silently.

### Required env vars (set by skill on entry)

| Variable | Value | When set |
|---|---|---|
| `HSEOS_CURRENT_RUN_ID` | `<YYYYMMDD-HHMM>-<slug>` (run-dir basename) | Intake phase, after run-dir created |
| `HSEOS_CURRENT_TASK` | task id (e.g. `T2.3`) | Execute phase, per task dispatch |
| `HSEOS_CURRENT_AGENT` | `SWARM` (Commander) or specific squad agent name | always |

### Emission points (idempotent, best-effort)

| Phase boundary | Command | Payload |
|---|---|---|
| Intake start (run-dir created) | `hseos state-emit start --run "$HSEOS_CURRENT_RUN_ID" --agent SWARM --silent --payload '{"phase":"intake"}'` | first action when SWARM enters Intake |
| Gate G2 approved (PLAN.md signed) | `hseos state-emit gate --run "$HSEOS_CURRENT_RUN_ID" --agent SWARM --silent --payload '{"gate":"G2"}'` | after human approves PLAN.md |
| Execute wave start | `hseos state-emit start --run "$HSEOS_CURRENT_RUN_ID" --task "$HSEOS_CURRENT_TASK" --agent SWARM --silent --payload '{"wave":N}'` | before dispatching squad subagents |
| Execute wave complete | `hseos state-emit complete --run "$HSEOS_CURRENT_RUN_ID" --task "$HSEOS_CURRENT_TASK" --agent SWARM --silent --payload '{"wave":N,"status":"OK"}'` | after wave consolidation |
| Run consolidate / abort | `hseos state-emit complete --run "$HSEOS_CURRENT_RUN_ID" --agent SWARM --silent` (or `abort` with `--payload '{"exit_reason":"..."}')` | run finalize |

### Conservative dual-write semantics

This contract **adds** SQLite emission to existing markdown writes. The skill **MUST continue** to write `INTAKE.md`, `PLAN.md`, `STATUS.md`, `RESUME-PROMPT.md`, and `WAVE-{n}-REPORT.md` to the run-dir. Markdown remains the operational backstop; SQLite is the queryable index.

ADR `2026-04-21-swarm-dev-squad` policy declares SQLite **canonical** for cross-run queries (orphan detection, `state-list`, `kanban-central`). Markdown remains canonical for **single-run** resume and human review.

### Rollback

To disable state emission per-run, unset `HSEOS_CURRENT_RUN_ID`. To disable globally, prepend `false ||` to all `hseos state-emit` invocations in the skill (silent skip). Both are reversible without regenerating the run-dir.

### Verification (post-W5a merge)

```bash
# In a real /dev-squad session, after Intake:
hseos state-list --run "$HSEOS_CURRENT_RUN_ID"     # → run row visible
sqlite3 .hseos/state/project.db "SELECT kind, ts FROM as_events WHERE agent_run_id IN (SELECT id FROM as_agent_runs WHERE run_id='$HSEOS_CURRENT_RUN_ID') ORDER BY ts"
# → start, gate, start, complete, complete sequence
```

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
- [ ] Human-initiated PR; human-approved merge or governed closeout
- [ ] Gotchas surfaced to `_knowledge/projects/<project>/gotchas.md` (second-brain)
- [ ] Run dir persisted in `.hseos/runs/dev-squad/{run-id}/` for audit


## Quick Mode

For low-context activation, load `.enterprise/governance/agent-skills/dev-squad/SKILL-QUICK.md` or `QUICK.md` first. Load this full skill for deep analysis, violation fixing, or formal review gates.
