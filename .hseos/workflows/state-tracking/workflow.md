# Agent State Tracking

## Intent
Provide the operational workflow for HSEOS run observability: SQLite-backed run state, markdown projections, MCP tools, and local dashboards.

## Owner
SWARM

## When To Use
- Inspect active or stale dev-squad/orbit runs.
- Emit structured events during an orchestrated run.
- Rebuild markdown evidence from the SQLite projection.
- Start the per-project or central kanban dashboard.

## Phases
1. Detect `.hseos/state/project.db` and run migrations if needed.
2. Emit or query run events through `hseos state-*` commands.
3. Render markdown projections for human review when required.
4. Use MCP tools for adapter-neutral state access.
5. Start `hseos state-ui` or `hseos kanban-central` for live status.

## Gates
- Hard-fail if the state database cannot be opened and no markdown fallback exists.
- Warn when stale running agents exceed the configured threshold.
- Never block delivery solely because observability side-cars are unavailable.
