# INTAKE — State Tracking Subsystem (Wave 1: Foundation)

**Run ID:** 20260425-1900-state-w1-foundation
**Workflow:** dev-squad
**Commander:** SWARM (Opus 4.7)
**Base branch:** master
**Feature branch:** feature/state-tracking-w1-foundation

## Goal

Implement Foundation slice (Wave 1 of 7) for HSEOS Agent State Tracking subsystem (Proposta 5). Source-of-truth ADR: `/opt/hideakisolutions/second-brain/_decisions/2026-04-25-agent-state-tracking-proposal.md`. Approved master plan: `/home/annonymous/.claude/plans/monte-o-planejamento-dessa-encapsulated-aho.md`.

## Wave 1 scope

5 tasks creating SQLite schema (with `as_*` prefix to avoid collision with existing `tasks` table), migration runner with `PRAGMA user_version`, FTS5 virtual table over events, DAL with atomic claim + transactions, and WAL pragma in MCP server init. All NEW files in `tools/mcp-project-state/`. Disjoint paths → 100% parallel.

| Task | File | Tier |
|---|---|---|
| T1.1 | `tools/mcp-project-state/migrations/001-agent-state-tables.sql` (new) | haiku |
| T1.2 | `tools/mcp-project-state/lib/migrations.js` (new) | sonnet-low |
| T1.3 | `tools/mcp-project-state/migrations/002-events-fts.sql` (new) | haiku |
| T1.4 | `tools/mcp-project-state/lib/agent-state-dal.js` (new) | sonnet-high |
| T1.5 | `tools/mcp-project-state/index.js` (edit `initDb` only — add WAL + busy_timeout) | haiku |

## Source ADR / Plan

Plan approved in `/plan` mode (G2 cleared). Run-dir convention follows HSEOS overlay. Worktree isolation via `worktree-manager.sh`. Commit messages validated by `validate-commit-msg.sh` (no Co-Authored-By, no AI mentions).

## Definition of Done (Wave 1)

- 5 commits on `feature/state-tracking-w1-foundation` (1 per task).
- WAVE-1-REPORT.md generated.
- ZERO regression: existing `tasks/state/state_history` schema untouched.
- MCP server starts without errors after migrations applied.
- Sprint 1 dual-write architecture: SQLite is **projection** until Wave 5 inverts canonicity.
