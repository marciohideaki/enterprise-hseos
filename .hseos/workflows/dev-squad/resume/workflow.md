# Dev Squad — Resume (Detached Mode)

## Intent
Resume a previously approved `dev-squad` run from persisted state in a clean session. This workflow addresses the "context inflation" pain of planning in the same session as execution: after Gate G2 approval, the user runs `/clear` and invokes this resume to continue with only `PLAN.md` + `STATUS.md` + `handoffs/*.md` loaded.

## Owner
SWARM

## Required Inputs
- `run-id` (provided by user via `RS <run-id>` or inferred from most recent run dir)

## Phase Model

1. Locate run directory (with SQLite-first projection)
   - **SQLite-first** (Wave 5b): if `.hseos/state/project.db` exists and contains `as_runs` row for `<run-id>`,
     run `hseos state-render <run-id> --output /tmp/resume-<run-id>` to regenerate `PLAN.md/STATUS.md/RESUME-PROMPT.md`
     from canonical SQLite. Use this regenerated dir as primary.
   - **Markdown fallback**: if SQLite missing or run absent there, read `.hseos/runs/dev-squad/{run-id}/` (HSEOS repo).
   - **Non-HSEOS fallback**: `.dev-squad/runs/{run-id}/`.
   - If all three absent → stop and report.

   Rationale: SQLite as queryable canonical for cross-run aggregations; markdown remains valid backstop for single-run resume. Either source works in isolation — graceful degrade.

2. Load minimal state
   Read ONLY:
   - `PLAN.md` — source of truth for tasks, waves, model assignments
   - `STATUS.md` — which waves/tasks are complete, in progress, blocked
   - `handoffs/*.md` — contracts between tasks (existing ones only)
   - `RESUME-PROMPT.md` — directive for this session

   **Do NOT load:**
   - `INTAKE.md` (already distilled into PLAN)
   - `STUDY.md` (already distilled into PLAN)
   - `logs/*.md` (past wave outputs — only the extracted handoffs matter going forward)
   - any prior conversation history

3. Identify next pending wave
   Parse `STATUS.md`. Find the lowest wave number with pending or blocked tasks.

4. Dispatch next wave (delegates to main workflow Phase 4)
   Execute the same Phase 4 protocol as `dev-squad/workflow.md`: per-task `check-branch.sh` → `worktree-manager.sh create` → parallel Agent dispatch → handoff extraction → validate → commit → merge → remove → `WAVE-{k}-REPORT.md`.

5. Gate G3 (conditional)
   Present wave report if BLOCKED or risk flag.

6. Loop or consolidate
   If more waves pending → continue. If last wave → Phase 5 (Consolidate) of main workflow.

## Constraints
- Resume is allowed only from persisted state + repo evidence
- If `PLAN.md` lacks G2 approval marker → halt; send back to main workflow Phase 3
- If repository state conflicts with `STATUS.md` (e.g., worktrees missing, branches diverged) → halt and escalate

## Escalation
- `run-id` not found → ask user for correct ID or new run
- PLAN.md not approved → return to Phase 3 of main workflow
- STATUS.md inconsistent with `git worktree list` → stop, report conflict
