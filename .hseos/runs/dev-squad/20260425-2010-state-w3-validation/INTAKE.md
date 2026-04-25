# INTAKE — State Tracking Wave 3: Validation

**Run ID:** 20260425-2010-state-w3-validation
**Workflow:** dev-squad
**Commander:** SWARM (Opus 4.7)
**Base branch:** feature/state-tracking-w2-cli-hooks (stacked on PR #42, which is stacked on PR #41)
**Feature branch:** feature/state-tracking-w3-validation

## Goal

Wave 3 of 7 — close Sprint 1 with tests, dual-write workflow doc, and the human E2E gate. After W3 merge, Sprint 1 is feature-complete: SQLite is projection alongside markdown canonicity; Sprint 2 (Wave 4 MCP expansion + Wave 5 inversion) opens.

## Wave 3 scope

5 tasks (T3.1 from original plan was already absorbed in W1 closeout as `test/test-agent-state-dal.js` with 7 cases + skip-clean).

| Task | File | Tier |
|---|---|---|
| ~~T3.1~~ | ~~DAL unit tests~~ — already added in W1 closeout commit `d0adf9f` | dropped |
| T3.2 | `test/test-state-cli.js` (new) — CLI smoke tests (spawn each command) | sonnet-low |
| T3.3 | `tools/cli/lib/state-render-lib.js` (new) + `tools/cli/commands/state-render.js` (refactor) + `test/test-state-render-lib.js` (new) — extract render funcs + golden snapshot test | sonnet-medium |
| T3.4 | `.hseos/workflows/dev-squad/workflow.md` (edit) — add "Observability side-effects" section documenting state-emit dual-write | sonnet-low |
| T3.5 | `package.json` (edit) — include new tests in `scripts.test` | haiku |
| T3.6 | `.hseos/runs/dev-squad/20260425-2010-state-w3-validation/E2E_GATE.md` (new) — human Gate G3 smoke test guide | haiku |

## Definition of Done

- 5 commits + merges on `feature/state-tracking-w3-validation`.
- `npm test` passes (lint + schemas + install + new test stubs skip-clean if better-sqlite3 missing).
- Workflow doc reflects observability dual-write semantics for Sprint 1.
- Gate G3 doc gives human a runnable smoke checklist.
- ZERO global skill edit (`~/.claude/skills/dev-squad/SKILL.md`) — deferred to Wave 5 (inversion) where it's the right scope. Documented in WAVE-3-REPORT.

## Sprint 1 closure criteria (after W3 merge)

- ✅ SQLite schema canonical (W1)
- ✅ DAL with 25 methods including session/atomic-claim (W1)
- ✅ CLI commands functional (W2)
- ✅ Hook shim wired (W2)
- ✅ Tests + dual-write doc (W3)

Sprint 2 opens with Wave 4 (MCP tools expansion) and Wave 5a/b (inversion to SQLite-canonical).
