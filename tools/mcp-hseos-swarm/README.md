# `mcp-hseos-swarm` — HSEOS dev-squad Orchestration MCP Server

> **Status: scaffolded.** Implementation lands as a follow-up PR within Wave 3. Declared in `.agents/mcp/bundles/extended.yaml`.

## Purpose

Expose the dev-squad parallel-execution protocol via MCP so non-original-platform adapters (Codex, Cursor, Continue, Aider, Cline) can drive heterogeneous batch execution — currently a Bash-only flow that locks SWARM into one vendor environment.

## Tools (planned)

| Tool | Input | Output |
|---|---|---|
| `plan_squad` | `{ batch_description: string, tier_hints?: object }` | `PLAN.md` content + run-dir path |
| `dispatch_wave` | `{ run_id: string, wave_index: int }` | Worktree paths + per-task subagent prompts |
| `consolidate_handoff` | `{ run_id: string, source_task: string, target_task: string }` | Handoff bundle ≤40 lines |
| `get_run_state` | `{ run_id: string }` | STATUS.md + per-wave reports |
| `list_runs` | `{ status?: string }` | Active and recent runs |

## Why this is critical

The dev-squad SKILL.md state-emission contract (synced from upstream into `.agents/skills/dev-squad/` in Wave 1) requires `hseos state-emit` calls at five phase boundaries. Today the skill assumes shell access. Wrapping the orchestration in an MCP server lets non-shell adapters fire the same emissions through tool calls, which keeps the SQLite state DB consistent across vendor environments.

## Implementation plan

- `index.js` — MCP server entrypoint
- `tools/<tool-name>.js` — one file per exposed tool
- `lib/run-state-dal.js` — wraps `tools/mcp-project-state/lib/agent-state-dal.js`
- Test: `test/test-mcp-hseos-swarm.js` — protocol round-trip + idempotent emission

## Acceptance

- [ ] All five tools implemented and tested
- [ ] `hseos mcp doctor` reports server reachable
- [ ] At least one non-original-vendor adapter demonstrably drives a dev-squad run end-to-end
- [ ] Published as `@hseos/mcp-server-swarm` on npm and Smithery
