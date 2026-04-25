# WAVE-4-REPORT — MCP tools expansion + stale-detector

**Run:** 20260425-2154-state-w4-mcp-cron | **Wave:** 4 (Sprint 2 abre)
**Branch:** feature/state-tracking-w4-mcp-cron (base=master)
**Status:** READY-FOR-G4 | **Date:** 2026-04-25

## Result Summary

9 tasks executadas e merged. MCP server `tools/mcp-project-state/index.js` (port 3100) ganha tool loader dinâmico + 9 novos tools agent-state + scheduler in-process para sweep de órfãos a cada 5min. CLI ganha `hseos state-stale-sweep` para uso manual.

## Task Results

| Task | Commit | Merge | Result |
|---|---|---|---|
| T4.1 — runs.js (3 tools) | `9ea7231` | `60dcb58` | ✅ |
| T4.2 — agent-runs.js (2 tools) | `5c498d5` | `44c8d41` | ✅ |
| T4.3 — events.js (2 tools, FTS5) | `6856d22` | `77a43a1` | ✅ |
| T4.4 — handoffs.js (2 tools) | `eb3efd3` | `04a64f7` | ✅ |
| T4.6 — stale-detector.js | `dd5a247` | `5147114` | ✅ |
| T4.8 — scheduler.js | `a2eb64c` | `bc1ec1c` | ✅ |
| T4.5 — index.js loader + scheduler hook | `f472e52` | `e2f84a8` | ✅ |
| T4.7 — state-stale-sweep CLI | `e41ec04` | `47dcae3` | ✅ |
| T4.9 — test-mcp-agent-state | `2a2a5c9` | `2eab749` | ✅ |

## New MCP tools (9 added)

```
runs_list(status?, project?, limit?)         → as_runs com filtros
run_describe(run_id)                          → run + counts + last events
run_create(id, workflow_id, project, phase?) → INSERT OR IGNORE
agent_runs_list(run_id?, status?, agent?)    → as_agent_runs com filtros
orphans_list(stale_minutes?)                 → running com heartbeat antigo
event_emit(agent_run_id, kind, payload?)     → DAL.emitEvent (heartbeat → recordHeartbeat)
events_search(query, limit?)                 → FTS5 MATCH
handoffs_list(src_task?, dst_task?)          → preview 200 chars
handoff_get(id)                              → full content
```

## Architecture changes

**Loader pattern (T4.5):**
```js
function loadDynamicTools() {
  // requires all `./tools/*.js`
  // each exports [{ name, description, inputSchema, handler(db, args, dal) }]
  // Map cumulative
}

function handleTool(db, name, args) {
  if (dynamicTools.has(name)) return dynamicTools.get(name).handler(db, args, getDal(db));
  // fall through to legacy switch (state_read/write, tasks_*, state_history)
}
```

Backward-compat preserved: legacy tools (`state_read`, `tasks_list`, etc.) continuam funcionando.

**Scheduler (T4.8):** `setInterval(sweep, 5*60*1000)` quando MCP server roda. `setInterval` em vez de `node-cron` para zero novas deps. Limpo em SIGTERM via stopper retornado.

**Stale-detector (T4.6):** SQL `UPDATE...RETURNING id` atomicamente marca running→orphaned quando heartbeat > N min. Retorna `{swept, ids, stale_minutes}`. Idempotente.

## Definition of Done — Verification

- [x] 9 commits + 9 merges + 1 scaffold em feature/state-tracking-w4-mcp-cron.
- [x] All commits pass `validate-commit-msg.sh`.
- [x] `npm test` passa (lint + schemas + install + state-tests + validate).
- [x] Tool loader não quebra legacy tools — `tools/list` agrega legacy + dynamic.
- [x] Scheduler ativa quando MCP server inicia; limpa em SIGTERM.
- [x] `hseos state-stale-sweep --json` retorna `{swept, ids, stale_minutes}`.
- [ ] **Pending G4:** human abre PR.
- [ ] **Pending G5:** human merge para master.

## Manual smoke (post-merge)

```bash
hseos state start --port 3100 &
sleep 1

# tools/list inclui novos
curl -s -X POST http://127.0.0.1:3100 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'

# Cria run via tool
curl -s -X POST http://127.0.0.1:3100 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_create","arguments":{"id":"R-mcp-test","workflow_id":"dev-squad","project":"/tmp/test"}}}'

# Lista órfãos
curl -s -X POST http://127.0.0.1:3100 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"orphans_list","arguments":{"stale_minutes":10}}}'

# Search eventos via FTS5
curl -s -X POST http://127.0.0.1:3100 -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"events_search","arguments":{"query":"checkpoint"}}}'

# CLI manual sweep
hseos state-stale-sweep --json
```

## Sprint 2 progresso

| Wave | Estado |
|---|---|
| **W4 — MCP expansion + scheduler** | ✅ entregue |
| W5a — dev-squad SKILL update + snapshotter | pendente |
| W5b — resume protocol + purge | pendente |
| W6 — governance closure (ADRs + manifest + registry) | pendente |

## Halt — Pending G4

```bash
git push -u origin feature/state-tracking-w4-mcp-cron
gh pr create --base master \
  --title "feat(state): wave 4 mcp tools expansion + stale-detector scheduler" \
  --body "$(cat .hseos/runs/dev-squad/20260425-2154-state-w4-mcp-cron/WAVE-4-REPORT.md)"
```
