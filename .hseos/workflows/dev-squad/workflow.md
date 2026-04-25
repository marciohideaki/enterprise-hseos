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
