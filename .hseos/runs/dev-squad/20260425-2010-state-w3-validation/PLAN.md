# PLAN — Wave 3: Validation

**Run ID:** 20260425-2010-state-w3-validation
**G2 Status:** APPROVED (cleared per /plan + Wave 1+2 PRs)
**Wave:** 3 of 7

## Tasks

### T3.2 — test/test-state-cli.js
**File:** `test/test-state-cli.js` (new)
**Acceptance:** Spawns each `hseos state-emit/list/describe/render` via `child_process.spawnSync` against a temporary directory `/tmp/hseos-test-<rand>`. Verifies exit codes and that DB file is created. Skips cleanly if `better-sqlite3` not installed.

### T3.3 — Extract render lib + golden snapshot test
**Files:**
- `tools/cli/lib/state-render-lib.js` (new) — exports `renderPlan`, `renderStatus`, `renderResumePrompt`.
- `tools/cli/commands/state-render.js` (refactor) — require from lib.
- `test/test-state-render-lib.js` (new) — table-driven snapshot test on render functions with fixed sample inputs.

**Acceptance:** Lib functions are pure (deterministic given input). Tests assert exact string match on sample inputs. No DB dependency in tests.

### T3.4 — workflow.md observability section
**File:** `.hseos/workflows/dev-squad/workflow.md` (edit)
**Acceptance:** New section "Observability — state-emit dual-write" inserted after the existing phase model. Documents:
- That CLI commands and `.claude/hooks.json` emit events to SQLite as projection during Sprint 1.
- Markdown run-dir remains canonical until Sprint 2 Wave 5 inversion.
- How to manually emit (set `HSEOS_CURRENT_RUN_ID`/`HSEOS_CURRENT_TASK`/`HSEOS_CURRENT_AGENT` env or pass flags).

### T3.5 — package.json scripts.test
**File:** `package.json` (edit)
**Acceptance:** `scripts.test` runs new tests (`test-state-cli.js`, `test-state-render-lib.js`) along with existing tests. New script `test:state` for state-only tests as convenience.

### T3.6 — E2E_GATE.md
**File:** `.hseos/runs/dev-squad/20260425-2010-state-w3-validation/E2E_GATE.md` (new)
**Acceptance:** Step-by-step manual smoke checklist: install better-sqlite3, run /dev-squad on a tiny prompt, verify SQLite populated via `hseos state-list`, kill session and verify orphan detection.

## Tier Matrix

| Task | Effort | Model | Rationale |
|---|---|---|---|
| T3.2 | Small | sonnet-low | spawn smoke; minimal logic |
| T3.3 | Medium | sonnet-medium | refactor + snapshot test |
| T3.4 | Small | sonnet-low | docs section |
| T3.5 | Trivial | haiku | one-line script update |
| T3.6 | Trivial | haiku | manual checklist |

## Risk Flags

- T3.3 refactor changes a file already merged from W2 (`state-render.js`). Modifying it is OK because we're refactoring within the same wave's stacked PR.
- T3.6 requires human action (manual smoke); skill flag `gate=G3-human`.
