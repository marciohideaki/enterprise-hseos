---
name: dev-squad
tier: full
version: "1.2"
description: "Full protocol for heterogeneous parallel batch execution under SWARM. Commander (Opus) plans + extracts handoffs; Squad (Sonnet/Haiku) executes in worktree-isolated parallel waves. 1 task = 1 commit; 1 wave = 1 PR."
license: Apache-2.0
portable: true
metadata:
  owner: platform-governance
  consumer: SWARM
trigger: "user lists 3+ independent tasks in any /plan or request; batch mixes fix+feature+refactor+docs across non-colliding areas; session context inflating before starting new unrelated batch; user explicitly asks to parallelize work"
skip: "single story end-to-end → use BLITZ; strict sequential delivery with release flow → use ORBIT; exploratory work without defined scope → use NYX first; architectural pivot requiring ADR → use CIPHER first"
---

# Dev Squad — Full Protocol

## Authority

**Tier 1 — Source of Truth (ADR-0015).** This file and `SKILL-QUICK.md` are the sole authoritative definitions of the dev-squad protocol — five-phase workflow, model matrix, tier assignments, Commander/Squad contract, commit rules, run directory convention, delegation map, and state-emission contract. All normative changes are made here first.

Derived tiers: `.agents/skills/dev-squad/` is the **Tier 2 compiled mirror** (hash-pinned in `.agents/manifest.yaml`; the agent-core compiler is the only permitted writer). The external mirror under the user-level skills directory is **Tier 3, non-canonical** inside HSEOS-enabled repositories. `.hseos/agents/swarm.agent.yaml` and `.hseos/workflows/dev-squad/` are the **Tier 4 execution surface**, consuming exclusively the Tier 2 mirror.

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

| Effort | Squad tier | Concrete criteria | Override |
|---|---|---|---|
| trivial | Haiku (low) | 1 file, ≤30 lines, mechanical/known pattern | never lower — Haiku always sufficient |
| small | Sonnet (low) | 1–2 files, ≤100 lines, test already exists | — |
| medium | Sonnet (medium) | 3–5 files, single layer, new tests required | — |
| large | Sonnet (high) | ≥5 files or ≥2 layers, no existing coverage | — |
| strategic | Opus (opt-in) | transversal architecture, schema/contract design, multi-domain integration, security audit | explicit opt-in in PLAN.md |

Commander always runs the Opus tier (planning + handoff extraction). Squad default = Sonnet tier; Haiku and Opus are opt-in declared per task in PLAN.md.

Escalate by exactly 1 tier for: auth / crypto / payments / fiscal; first greenfield task in a domain; a handoff consumed by ≥2 downstream tasks.

> **Model pins** (refreshed independently of this matrix): Haiku → Haiku 4.5; Sonnet → Sonnet 4.6; Opus → Opus 4.8. The matrix above is version-agnostic and does not depend on these pins.

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

## Stacked Feature Branch Chains

SWARM may plan a stacked `feature/*` branch chain only when a later wave depends on an earlier
unmerged wave. This is a dependency strategy, not a shortcut around the worktree lifecycle.

Rules:
- Declare the chain in `PLAN.md`: upstream base per wave, downstream dependents if known, and merge order.
- Every chain link must be a `feature/*` branch.
- Every write task still runs in a `task/*` worktree created from exactly one `feature/*` link.
- PRs target the immediate upstream branch until that upstream branch merges.
- Merge order is base-to-tip; after each upstream merge, downstream PRs must be retargeted or updated.
- `task/*` branches are never stacked directly.

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
- [ ] Stacked branch base map recorded when any wave targets an upstream `feature/*` branch
- [ ] Draft PR body ready, using `.github/pull_request_template.md`
- [ ] Human-initiated PR; human-approved merge or governed closeout
- [ ] Gotchas surfaced to `_knowledge/projects/<project>/gotchas.md` (second-brain)
- [ ] Run dir persisted in `.hseos/runs/dev-squad/{run-id}/` for audit
