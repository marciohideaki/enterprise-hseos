# Dev Squad — Parallel Batch Execution

## Intent
Execute a heterogeneous batch of 3+ tasks using Opus 4.7 for planning and parallel Sonnet/Haiku subagents for execution, each isolated in its own worktree. Optimize token cost and wall-clock latency while preserving HSEOS governance.

This workflow institutionalizes the Parallel-Fan-Out + Map-Reduce pattern with model-tiering as a first-class HSEOS flow. Commander-mediated handoffs keep subagents zero-context; `worktree-manager.sh` enforces isolation; 1 task = 1 commit; 1 wave = 1 PR.

## Owner
SWARM

## Skill
Canonical protocol: `~/.claude/skills/dev-squad/SKILL.md` (global, loaded in SWARM bootstrap).
HSEOS overlay: this workflow + `.enterprise/governance/agent-skills/dev-squad/`.

## Phase Model

0. Vault Context Load (Pre-flight)
   SWARM reads strategic context from second-brain if enabled (`second_brain.enabled = true`).
   Reads: `_memory/current-state.md` for recent state.
   Fallback: vault unavailable → skip silently.

1. Intake
   SWARM reads the brief in prose. If material ambiguity remains (scope, base branch, Opus opt-in, PR strategy), fires ONE `AskUserQuestion` with up to 4 questions. Output: `INTAKE.md`.

2. Study (optional)
   When codebase areas are unknown or patterns need evidence, SWARM dispatches up to 3 `Explore` subagents in parallel. Output: `STUDY.md` (≤150 lines).

3. Plan
   SWARM decomposes into atomic tasks with ID, goal, input/output contracts, acceptance criteria, model+effort (via matrix), wave number, dependencies, risk flags. Builds wave graph. Output: `PLAN.md`. **Gate G2 (mandatory): human approval before any Execute wave.**

4. Execute (detached mode recommended)
   After G2, SWARM writes `RESUME-PROMPT.md` and instructs the user to `/clear` and resume with clean context. For each wave:
   - For each task: `check-branch.sh <base>` → `worktree-manager.sh create T{n} <base>`
   - Dispatch all tasks of the wave in ONE message with N parallel Agent calls (`isolation: "worktree"`, model per matrix)
   - Collect returns; write `logs/T{n}.md`
   - Extract handoffs into `handoffs/T{a}-to-T{c}.md` (≤40 lines each; Commander-written, never subagent-written)
   - For each OK task: `worktree-manager.sh validate` → `validate-commit-msg.sh` → `worktree-manager.sh commit` → `worktree-manager.sh merge` → `worktree-manager.sh remove`
   - Write `WAVE-{k}-REPORT.md`
   - Gate G3 (conditional): present wave report to human if any BLOCKED or risk flag triggered

5. Consolidate
   SWARM drafts PR body using `.github/pull_request_template.md` with tasks×commits×tests table. Human runs `gh pr create`. Human reviewer approves and merges — agents do not merge PRs.

6. Knowledge Consolidation (second-brain, if enabled)
   QUILL-equivalent note: surface gotchas discovered during execution to `_knowledge/projects/<project>/gotchas.md`. SWARM prompts: run `/end-session` in second-brain for full capture.

## Handoff Chain
```
Wave N subagents → SWARM (Commander extracts) → handoffs/T{a}-to-T{c}.md → Wave N+1 subagents
```

Subagents never see each other's output. Only the Commander-extracted handoff (≤40 lines, formatted per `~/.claude/skills/dev-squad/templates/HANDOFF.md`) flows downstream.

## Stateful Execution
- persist run state under `.hseos/runs/dev-squad/{run-id}/` (STATUS.md updated between waves)
- resume only from `PLAN.md` + `STATUS.md` + existing `handoffs/*.md` — never from chat memory
- re-run a failed task only after corrective action; never blindly retry

## Required Inputs
- brief describing the batch of heterogeneous tasks
- base branch (explicit in INTAKE or inferred by SWARM, validated by `check-branch.sh` — must match `feature/*`)
- approval decision on Opus-as-executor (default: denied)
- approval decision on PR strategy (default: 1 wave = 1 PR)

## Gates
- **G1 — Intake** (conditional): if residual ambiguity after prose → 1 AskUserQuestion round
- **G2 — Plan approval** (mandatory): human approves `PLAN.md` before any Execute wave
- **G3 — Wave review** (conditional): human reviews `WAVE-{k}-REPORT.md` if BLOCKED or risk flag triggered
- **G4 — PR open**: human runs `gh pr create`; agents draft, never open
- **G5 — Merge**: human reviewer approves and merges; agents never merge to protected branches

Bypass of any gate is a governance violation — halt and escalate.

## Governance Invariants
- **Worktree isolation:** every write task uses `isolation: "worktree"`; no exceptions
- **Commit hygiene:** conventional commit format, validated by `validate-commit-msg.sh`; no `Co-Authored-By`, no mentions of `Claude`, `AI`, `LLM`, `Anthropic`, `GPT`
- **Base branch:** validated by `check-branch.sh` — must follow `feature/*` pattern
- **Quality gates:** `worktree-manager.sh validate` runs `quality-gates.sh` (6 gates) before every commit
- **Model-tiering:** matrix in skill enforces minimum-capable model per task; Opus-as-executor requires explicit opt-in in PLAN.md
- **Governance cascade:** scope changes → VECTOR; arch changes → CIPHER; release/runtime → FORGE/KUBE/SABLE; epic-scale → ORBIT

## Escalation
- Missing artifact → stop; direct to responsible agent
- Subagent BLOCKED after 1 retry → Gate G3 to human
- Two tasks touching the same file → decomposition error → return to Gate G2
- `validate-commit-msg.sh` or `check-branch.sh` fails → stop, never bypass

## Observability — state-emit dual-write (Sprint 1)

While Sprint 1 of the agent-state-tracking subsystem is in effect, dev-squad emits structured events to a SQLite projection alongside the canonical markdown run-dir.

**Canonicity (Sprint 1):** markdown run-dir (`PLAN.md`, `STATUS.md`, `RESUME-PROMPT.md`, `WAVE-{n}-REPORT.md`, `handoffs/*.md`) remains source of truth. SQLite is **projection only** — derived data, safe to rebuild. Sprint 2 Wave 5 inverts canonicity (SQLite primary, markdown rendered on demand).

**Emission mechanism:**
- `.claude/hooks.json` invokes `scripts/governance/state-emit-hook.sh` on `SessionStart`, `PostToolUse`, and `Stop`. The shim is non-blocking (timeout 5s, exit 0 on any error).
- The shim calls `hseos state-emit <kind>` only when `HSEOS_CURRENT_RUN_ID` is set. Skips silently otherwise — no crashes outside tracked runs.

**Per-phase emission contract:**
| Phase | Event kind(s) | Payload hints |
|---|---|---|
| Intake | `start` | `{phase: 'intake'}` on first SWARM action |
| Plan | `gate` with `gate=G2` | when human approves |
| Execute (per task dispatch) | `start` then `heartbeat` periodically | `{task_id, model_tier}` |
| Execute (per subagent return) | `complete` or `abort` | `{exit_reason, tokens_in/out, cost_usd}` if known |
| Consolidate | `gate` with `gate=G4`, then `complete` for run | — |

**Heartbeat cadence:** opportunistic — emitted whenever the shim fires (i.e., on every Claude Code tool use). For long-running subagents that don't call tools often, emit at G2 plan-confirm and at start of each task. Stale threshold default: 10 minutes.

**Manual invocation (for skills not yet integrated):**
```bash
HSEOS_CURRENT_RUN_ID=20260425-2010-state-w3 \
HSEOS_CURRENT_TASK=T3.4 \
HSEOS_CURRENT_AGENT=SWARM \
hseos state-emit start --silent
```

**Inspection:**
- `hseos state-list` — all runs.
- `hseos state-list --orphans` — running agent-runs whose heartbeat is older than `--stale-minutes` (default 10).
- `hseos state-describe <run-id>` — counts + last 10 events.
- `hseos state-render <run-id> --output <dir>` — read-only markdown projection.

**Non-goals (Sprint 1):** state-emit failures NEVER block dev-squad execution; the canonical markdown path is unaffected by SQLite errors. If `better-sqlite3` is missing or DB is corrupt, the shim fails open and the workflow proceeds as if observability were disabled.

## Observability — state emission contract (Sprint 2 / Wave 5a)

Wave 5a refines the Sprint 1 dual-write into an explicit emission contract on the canonical skill (`~/.claude/skills/dev-squad/SKILL.md`). Markdown writes are **preserved** (zero regression); the skill simply **adds** structured emit calls at five phase boundaries.

### Required env vars (set by skill)

| Variable | Value | Lifetime |
|---|---|---|
| `HSEOS_CURRENT_RUN_ID` | `<YYYYMMDD-HHMM>-<slug>` | Whole run, exported on Intake |
| `HSEOS_CURRENT_TASK` | task id (e.g. `T2.3`) | Per-task in Execute |
| `HSEOS_CURRENT_AGENT` | `SWARM` or specific squad agent name | Always |

### Emission points

| Phase | `kind` | Trigger | Payload |
|---|---|---|---|
| Intake start | `start` | SWARM enters Intake; run-dir created | `{phase:'intake'}` |
| Plan approved | `gate` | Human approves PLAN.md (Gate G2) | `{gate:'G2'}` |
| Execute wave start | `start` | Squad subagents dispatched | `{wave:N, task_count}` |
| Execute wave complete | `complete` | Wave consolidation (last task OK or BLOCKED) | `{wave:N, status}` |
| Run consolidate / abort | `complete`/`abort` | Run finalize | `{exit_reason}` |

**Best-effort:** every emit call MUST be silent and non-blocking. `failure → continue`. The shim already enforces this; the skill just calls `hseos state-emit … --silent` at each boundary.

### Canonicity (Sprint 2)

Per ADR `2026-04-21-swarm-dev-squad` (updated in Wave 6), **SQLite is canonical for cross-run queries** (orphan detection, kanban, FTS5 search). **Markdown remains canonical for single-run resume and human review**. The skill writes both — there is no "single source of truth" mandate; there are two source-of-truth scopes:

- **Inside one run:** markdown run-dir.
- **Across runs / cross-project:** SQLite (`as_*` tables).

This is the policy outcome of Wave 5a — mechanical inversion was rejected as too risky for a global skill.

### Backups (Wave 5a)

`hseos state-snapshot [--keep N]` copies `.hseos/state/project.db` to `.hseos/state/snapshots/project-{ISO}.db`, pruning to last N (default 7). Run before risky operations (`state-purge`, schema migrations) or daily via cron.
