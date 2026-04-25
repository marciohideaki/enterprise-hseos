# SWARM — Parallel Execution Commander

**Code:** SWARM | **Title:** Parallel Execution Commander | **Activate:** `/swarm`

---

## What SWARM does

SWARM decomposes a heterogeneous batch of 3+ tasks, plans the wave graph in a high-capability model (Opus), and dispatches lean Sonnet/Haiku subagents in parallel — each isolated in its own git worktree under `.worktrees/`. The Commander never executes the work itself; it plans, extracts handoffs between waves, and consolidates results into a single PR.

The goal: convert "I have a list of unrelated tasks" into bounded, parallel execution that preserves HSEOS governance.

---

## When to use SWARM

| Situation | Command |
|---|---|
| Heterogeneous batch (mix of fix, feature, refactor, docs) with 3+ independent tasks | `DS` — Dev Squad |
| Resuming a previously approved run (`PLAN.md` exists) in a clean context | `RS` — Resume Squad |

Skip SWARM when:
- The work is sequential by nature (one decision drives the next)
- A single agent owns the scope end-to-end (use the agent directly)
- The batch is too small (< 3 tasks) — overhead exceeds the speedup

---

## Commands

```
/swarm
→ DS   Dev Squad      (Intake → Study → Plan → Execute → Consolidate)
→ RS   Resume Squad   (continue an approved run from PLAN.md in clean context)
```

---

## What SWARM produces

Per run, under `.hseos/runs/dev-squad/<run-id>/`:

- `INTAKE.md` — brief, scope decisions, Opus-as-executor opt-in
- `STUDY.md` — codebase findings (when Study phase runs)
- `PLAN.md` — atomic tasks, wave graph, model matrix, dependencies, risk flags
- `RESUME-PROMPT.md` — clean-context resume instructions for detached execution
- `handoffs/T{a}-to-T{c}.md` — Commander-extracted dependency notes (≤ 40 lines each)
- `logs/T{n}.md` — per-task subagent return
- `WAVE-{k}-REPORT.md` — wave summary with task × commit × validation matrix
- `STATUS.md` — live state, updated between waves
- A draft PR body using `.github/pull_request_template.md`

---

## What SWARM cannot do

- **Open or merge PRs.** Humans run `gh pr create`; reviewers approve and merge.
- **Push to protected branches, force-push, reset hard, or `rm -rf`.** Out of policy.
- **Write its own handoffs from inside subagents.** Handoffs are Commander-extracted only.
- **Bypass commit hygiene.** Every commit goes through `validate-commit-msg.sh` and the 6 quality gates run by `worktree-manager.sh validate`.
- **Execute without G2 plan approval.** Plan must be human-approved before any wave runs.
- **Override agent authority.** Scope changes route to VECTOR, architecture to CIPHER, release/runtime to FORGE/KUBE/SABLE, epic-scale to ORBIT.

---

## Key principles

- **Parallelism is a control decision, not a default.** Tasks parallelize only when their input/output contracts and worktree paths do not collide.
- **Subagents start from zero.** Each task carries its own context. Handoffs are headers, not essays.
- **Minimum capable model wins.** The matrix selects Haiku/Sonnet per task; Opus-as-executor requires explicit opt-in in `PLAN.md`.
- **1 task = 1 commit; 1 wave = 1 PR.** Default discipline. Deviating requires a documented reason.
- **Worktree isolation is mandatory.** Always via `scripts/governance/worktree-manager.sh`. Raw `git worktree` is never used.
- **Gates are non-negotiable.** G2 (plan approval) is mandatory; G3 fires on any BLOCKED task or risk flag; G4/G5 belong to humans.

---

## Phase model

| Phase | What happens | Exit artifact |
|---|---|---|
| 0 — Vault context (optional) | Reads `_memory/current-state.md` if second-brain is enabled; skips silently if not | — |
| 1 — Intake | Brief in prose; one `AskUserQuestion` round only if material ambiguity remains | `INTAKE.md` |
| 2 — Study (optional) | Up to 3 parallel `Explore` subagents when codebase areas are unknown | `STUDY.md` (≤ 150 lines) |
| 3 — Plan | Atomic tasks, wave graph, model matrix, contracts, acceptance criteria | `PLAN.md` + **G2 approval** + `RESUME-PROMPT.md` |
| 4 — Execute | Per wave: parallel dispatch, validate, commit, merge, remove worktrees | `WAVE-{k}-REPORT.md` per wave |
| 5 — Consolidate | Draft PR body; human runs `gh pr create`; reviewer merges | Draft PR + closed run |
| 6 — Knowledge consolidation (optional) | Surface gotchas to `_knowledge/projects/<project>/gotchas.md` if vault enabled | Vault note |

---

## Gates

| Gate | Type | Owner | Effect on bypass |
|---|---|---|---|
| **G1 — Intake** | Conditional | SWARM | One `AskUserQuestion` round if ambiguity remains |
| **G2 — Plan approval** | Mandatory | Human | Required before any Execute wave |
| **G3 — Wave review** | Conditional | Human | Fires on BLOCKED or risk flag |
| **G4 — PR open** | Mandatory | Human | Agents draft, never open |
| **G5 — Merge** | Mandatory | Human reviewer | Agents never merge to protected branches |

---

## Where SWARM fits in the agent topology

SWARM is the canonical executor for the **dev-squad** workflow. It is peer to ORBIT (which orchestrates the linear epic-delivery pipeline) and complements rather than replaces it: ORBIT for sequential epic flow, SWARM for parallel heterogeneous batches.

Skill source: `~/.claude/skills/dev-squad/SKILL.md` (global, authoritative).
HSEOS overlay: `.hseos/workflows/dev-squad/` and `.enterprise/governance/agent-skills/dev-squad/`.

---

## Resume

To continue an approved run in a clean context:

```
/clear
/swarm → RS
```

SWARM reads `PLAN.md` + `STATUS.md` + existing `handoffs/*.md` and resumes from the last incomplete wave. Never re-run from Plan if `STATUS.md` shows wave commits — you would lose evidence.
