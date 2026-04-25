# INTAKE — State Tracking Wave 2: CLI surface + hook shims

**Run ID:** 20260425-1950-state-w2-cli-hooks
**Workflow:** dev-squad
**Commander:** SWARM (Opus 4.7)
**Base branch:** feature/state-tracking-w1-foundation (stacked PR)
**Feature branch:** feature/state-tracking-w2-cli-hooks

## Goal

Wave 2 of 7 — expose the SQLite DAL through CLI commands and a bash shim for Claude Code hooks. Sprint 1 dual-write pattern: SQLite is still **projection** (writes here are additive, RESUME-PROMPT.md remains canonical until Wave 5).

## Wave 2 scope

6 tasks creating CLI commands + bash shim + hook config. All NEW files except T2.6 (hooks.json edit). Disjoint paths → 100% parallel.

| Task | File | Tier |
|---|---|---|
| T2.1 | `tools/cli/commands/state-emit.js` (new) | sonnet-low |
| T2.2 | `tools/cli/commands/state-list.js` (new) | sonnet-low |
| T2.3 | `tools/cli/commands/state-describe.js` (new) | sonnet-low |
| T2.4 | `tools/cli/commands/state-render.js` (new) | sonnet-medium |
| T2.5 | `scripts/governance/state-emit-hook.sh` (new) | haiku |
| T2.6 | `.claude/hooks.json` (edit) | haiku |

## Naming note

Plan originally specified `hseos state emit` (subcommand). Adjusted to `hseos state-emit` (top-level command) to match existing dynamic-load pattern in `tools/cli/hseos-cli.js` without conflicting with existing `state.js` (`hseos state <action>` for start/stop/status). Documented in WAVE-2-REPORT.

## Definition of Done (Wave 2)

- 6 commits on `feature/state-tracking-w2-cli-hooks` (1 per task).
- WAVE-2-REPORT.md generated.
- `hseos state-emit start --run R1 --task T1 --agent SWARM` writes a row in `as_events`.
- `hseos state-list --orphans` returns running agent_runs without recent heartbeat.
- `hseos state-render <run-id>` produces markdown derived from SQLite.
- `state-emit-hook.sh` invoked by `.claude/hooks.json` for SessionStart/PostToolUse.
- ZERO regression in existing `hseos state start/stop/status`.
