# State Tracking

> HSEOS ships a SQLite-backed, cross-session state layer that gives you persistent visibility into agent runs — no server, no cloud dependency.

<!-- diagram: docs/assets/state-tracking.png (pending creation — see docs/assets/README.md) -->

---

## Overview

All state is stored in `.hseos/state/project.db` — a single SQLite file per project. The schema has four core tables:

| Table | Description |
|-------|-------------|
| `as_runs` | Top-level agent runs (one per `dev-squad` or manual session) |
| `as_agent_runs` | Individual agent executions within a run |
| `as_tasks` | Tasks tracked inside an agent run |
| `as_events` | Append-only event log (state transitions, hook events) |

---

## CLI Commands

### Emit run state

```bash
# Open a run (assigns a unique run ID)
hseos state-emit start --run <run-id>

# Advance phase
hseos state-emit phase --run <run-id> --phase review

# Close a run
hseos state-emit stop --run <run-id>
```

### Query runs

```bash
# List recent runs (last 20 by default)
hseos state list

# Filter by status
hseos state list --status active
hseos state list --status completed

# Describe a specific run
hseos state describe <run-id>

# Full event log for a run
hseos state events <run-id>
```

### Kanban surfaces

```bash
# ASCII kanban in terminal
hseos kanban

# Filter by project or branch
hseos kanban --project my-project --branch feature/my-branch

# Start the web side-car (SSE + HTTP)
hseos state-ui                         # http://localhost:3200
hseos state-ui --port 3201             # custom port
hseos state-ui --host 0.0.0.0          # LAN / Tailscale accessible

# Central multi-project kanban
hseos state-ui --central               # aggregates all registered projects
```

---

## Web Kanban

The `state-ui` server serves a real-time kanban at `http://localhost:3200`:

- **Columns:** `intake → planning → review → done`
- **Cards:** each card shows run ID, project, branch, phase, gate status, start time
- **Badges:** project · branch · session context
- **Activity feed:** right sidebar with live event stream
- **Filters:** by project, branch, run status, agent
- **SSE push:** board updates automatically without page refresh

The server is a sidecar — it reads SQLite directly (read-only) and never writes. Safe to run alongside active agent sessions.

---

## SessionStart Auto-Detection

The `state-emit-hook.sh` shim is wired as a Claude Code `SessionStart` hook. On session start:

1. Checks for `HSEOS_CURRENT_RUN_ID` env var — uses it directly if set
2. If not set, queries `.hseos/state/project.db` for the most recent `active` run in `as_runs`
3. If found, emits `kind=start` with the discovered run ID — session context is wired automatically
4. If no active run found — silent no-op (exit 0, no output)

```bash
# To manually set the active run for a session
export HSEOS_CURRENT_RUN_ID=20260509-my-run
export HSEOS_STATE_DB=/path/to/custom/project.db  # optional, defaults to .hseos/state/project.db
```

---

## MCP Tools (hseos-swarm server, port 3102)

The `hseos-swarm` MCP server exposes state tools to agents:

| Tool | Description |
|------|-------------|
| `state_emit` | Emit a state event for a run |
| `state_list` | List recent runs with filters |
| `state_describe` | Get full detail for a run ID |
| `state_advance` | Advance a run to the next phase |
| `state_close` | Close an active run |
| `run_claim` | Atomically claim an orphaned run |
| `run_create` | Create a new run with metadata |

Add the server to your MCP config:

```json
{
  "mcpServers": {
    "hseos-swarm": {
      "command": "node",
      "args": ["tools/mcp/hseos-swarm/server.js"],
      "env": {
        "HSEOS_STATE_DB": ".hseos/state/project.db"
      }
    }
  }
}
```

---

## Schema Reference

### `as_runs`

| Column | Type | Description |
|--------|------|-------------|
| `id` | TEXT PK | Run identifier (e.g., `20260509-dev-squad-cleanup`) |
| `workflow_id` | TEXT | Workflow that created the run |
| `project` | TEXT | Project name |
| `phase` | TEXT | Current phase (`intake`, `planning`, `review`, `done`) |
| `gate_status` | TEXT | Last gate result (`PASS`, `FAIL`, `WARN`) |
| `status` | TEXT | Run status (`active`, `completed`, `aborted`) |
| `started_at` | TEXT | ISO timestamp |
| `ended_at` | TEXT | ISO timestamp (null if active) |
| `session_id` | TEXT | Claude session that owns this run |

### `as_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `run_id` | TEXT FK | Parent run |
| `kind` | TEXT | Event type (`start`, `phase`, `gate`, `stop`, `hook`) |
| `payload` | TEXT | JSON blob with event details |
| `created_at` | TEXT | ISO timestamp |

---

## Orphan Detection and Resume

If a Claude session crashes mid-run, the run stays `active` in SQLite. On the next `SessionStart`:

1. The hook auto-detects the active run
2. Emits `kind=start` to re-wire context
3. The run continues from where it left off — no state lost

To manually resume or force-close a stale run:

```bash
hseos state describe <run-id>          # inspect current state
hseos state-emit stop --run <run-id>   # close cleanly
# or
hseos state-emit phase --run <run-id> --phase aborted
```

---

## Database Location

| Scenario | Default path |
|----------|-------------|
| Project install | `.hseos/state/project.db` (relative to project root) |
| Override via env | `$HSEOS_STATE_DB` |
| Central multi-project | `~/.hseos/state/central.db` (read by `--central` mode) |
