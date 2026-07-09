# `mcp-hseos-swarm` — HSEOS dev-squad Orchestration MCP Server

> **Status: implemented (filesystem-backed by design).** All five tools live, covered by `test/test-mcp-hseos-swarm.js` in `npm test`. Declared in `.agents/mcp/bundles/extended.yaml`.
>
> **Canonicity decision (2026-07-08):** per the canonicity policy in `.hseos/AGENT-MANIFEST.md`, the markdown run-dir (`.hseos/runs/dev-squad/`) is canonical for single-run scope — exactly what these tools serve. Cross-run SQLite state is owned by the `hseos-state-tracking` MCP server (`run_create`/`event_emit` cover the dev-squad emission contract). The staged-but-never-used `lib/run-state-dal.js` wrapper was removed; this server intentionally does not touch SQLite.

## Purpose

Expose the dev-squad parallel-execution protocol via MCP so non-original-platform adapters (Codex, Cursor, Continue, Aider, Cline) can drive heterogeneous batch execution — currently a Bash-only flow that locks SWARM into one vendor environment.

## Tools

| Tool | Input | Output |
|---|---|---|
| `plan_squad` | `{ batch_description: string, tier_hints?: object }` | `PLAN.md` content + run-dir path |
| `dispatch_wave` | `{ run_id: string, wave_index: int }` | Worktree paths + per-task subagent prompts |
| `consolidate_handoff` | `{ run_id: string, source_task: string, target_task: string }` | Handoff bundle ≤40 lines |
| `get_run_state` | `{ run_id: string }` | STATUS.md + per-wave reports |
| `list_runs` | `{ status?: string }` | Active and recent runs |

## Why this is critical

The dev-squad SKILL.md state-emission contract (synced from upstream into `.agents/skills/dev-squad/` in Wave 1) requires `hseos state-emit` calls at five phase boundaries. Today the skill assumes shell access. Wrapping the orchestration in an MCP server lets non-shell adapters fire the same emissions through tool calls, which keeps the SQLite state DB consistent across vendor environments.

## Implementation

- `index.js` — MCP server entrypoint (hand-rolled JSON-RPC over the shared `tools/lib/mcp-transport.js`, stdio + HTTP)
- `tools/<tool-name>.js` — one file per exposed tool; all operate on the markdown run-dir (canonical for single-run scope)
- SQLite emissions (cross-run scope) go through the `hseos-state-tracking` server or the `hseos state-emit` CLI — not through this server
- Test: `test/test-mcp-hseos-swarm.js` — protocol round-trip + idempotent emission

## Acceptance

- [x] All five tools implemented and tested (filesystem-backed)
- [ ] `hseos mcp doctor` reports server reachable
- [ ] At least one non-original-vendor adapter demonstrably drives a dev-squad run end-to-end
- [ ] Published as `@hseos/mcp-server-swarm` on npm and Smithery
