# PLAN — Wave 7: Kanban Web + CLI

**G2 Status:** APPROVED (cleared in /plan mode 2026-04-25)

## Snapshot shape (T7.1 contract)

```js
takeSnapshot(db, { staleMinutes = 10, run = null, project = null }) → {
  ts: ISO8601,
  runs: [{ id, workflow_id, project, phase, gate_status, status, started_at, ended_at }],
  tasks: [{ id, run_id, wave, effort, model_tier, status, goal, last_heartbeat_at }],
  agentRuns: [{ id, agent_name, task_id, run_id, started_at, last_heartbeat_at, ended_at, status, exit_reason }],
  events: [{ id, agent_run_id, ts, kind }],          // last 100
  orphans: [agent_run_id, ...],                       // computed: status='running' AND heartbeat < now-N min
  counts: { pending, running, completed, aborted, orphaned } // for column headers
}
```

Pure function over `better-sqlite3` Database instance. No DB writes. No filesystem I/O.

## Server (T7.2)

- Port: `state_management.web_port` (default 3200) — bind `127.0.0.1` only.
- Endpoints:
  - `GET /` → `web/index.html`
  - `GET /assets/*` → `web/{app.js,styles.css}` via `fs.createReadStream`
  - `GET /api/state` → JSON snapshot
  - `GET /events` → SSE; first event = current snapshot, then push on change
- Polling loop: `setInterval(takeSnapshot → SHA1 → diff → push, 1000)`.
- Cleanup: SIGTERM/SIGINT → drain SSE clients (write `event: bye\n\n`) + `db.close()` + `server.close()`.

## Frontend (T7.3)

- `index.html` — semantic skeleton, ARIA labels, link CSS+JS.
- `app.js` — vanilla JS:
  - `new EventSource('/events')` → onmessage updates `state` + re-renders.
  - Render: 5 columns (pending/running/completed/aborted/orphaned) flex-row. Cards: task id, agent, run, heartbeat age (formatted `♥ 3s` / `⚠ 30m`).
  - Reconnect handled automatically by EventSource.
  - Debounce render (rAF).
- `styles.css` — dark theme, mono font for IDs, accent colors per status (green/yellow/red).

## CLI lifecycle (T7.4) — `hseos state-ui`

Mirror exact of `tools/cli/commands/state.js`:
- `start --port 3200 --directory .` → spawn detached, unref.
- `status` → curl `/health` → 200 = running.
- `stop` → `lsof -ti tcp:${port} | xargs kill -9`.
- `health` endpoint added in T7.2: `GET /health` → `{ status: "ok", server: "hseos-state-ui" }`.

## CLI ASCII (T7.5) — `hseos kanban`

- Default: one-shot render of current snapshot, exit.
- `--watch`: clear screen + re-render every 1s loop until SIGINT.
- `--stale-minutes N` (default 10).
- `--run R` filter by run id.
- `--directory D` (default cwd).
- Uses `picocolors` (already in deps) for ANSI colors.
- 5 columns side-by-side using box-drawing chars (╭ ─ ╮ │ ╰).
- Footer: counts + side-car health probe.

## Config (T7.6)

```yaml
state_management:
  ...existing...
  web_port: 3200
  web_poll_ms: 1000
```

## Tests (T7.7)

- `test/test-state-ui.js`: spawn server on dynamic port, fetch `/api/state`, assert JSON shape (`runs`, `tasks`, `agentRuns`, `events`, `orphans`, `counts`, `ts`), kill via SIGTERM. Skip-clean if no better-sqlite3.
- `test/test-kanban-cli.js`: spawn `node tools/cli/hseos-cli.js kanban --directory <tmp>`, assert exit 0 + stdout contains "Pending" + "Running". Skip-clean.

## Risk Flags

- T7.2 SSE drain in SIGTERM: ensure `res.end()` before `process.exit` else clients hang.
- T7.5 `console.clear()` may not work in all terminals — use ANSI `\x1b[2J\x1b[H` fallback.
- T7.3 frontend MUST handle EventSource reconnect gracefully (default behavior, but verify).

## Halt conditions

Same as W1-W3. Husky pre-commit failures → fix; never `--no-verify`. Tests fail → fix code, then commit.
