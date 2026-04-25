# INTAKE — Wave 4: MCP tools expansion + stale-detector

**Run ID:** 20260425-2154-state-w4-mcp-cron
**Workflow:** dev-squad | **Commander:** SWARM (Opus 4.7)
**Base:** master (Sprint 1 mergeado; W7+W8 em PR aguardando merge)
**Feature branch:** feature/state-tracking-w4-mcp-cron

## Goal

Expandir o MCP server (`tools/mcp-project-state/index.js`, port 3100) com tools para `as_*` schema (runs, agent_runs, events com FTS5, handoffs) — disponibiliza state-tracking via JSON-RPC para uso fora do HSEOS sem precisar do CLI.

Adicionar stale-detector daemon in-process: quando MCP server roda, agenda sweep a cada 5min que marca agent_runs com heartbeat antigo como `orphaned`.

## Tasks (9 paralelas)

| Task | File(s) | Tier |
|---|---|---|
| T4.1 | `tools/mcp-project-state/tools/runs.js` (novo) — `runs_list/run_describe/run_create` | sonnet-low |
| T4.2 | `tools/mcp-project-state/tools/agent-runs.js` (novo) — `agent_runs_list/orphans_list` | sonnet-low |
| T4.3 | `tools/mcp-project-state/tools/events.js` (novo) — `event_emit/events_search` (FTS5) | sonnet-medium |
| T4.4 | `tools/mcp-project-state/tools/handoffs.js` (novo) — `handoffs_list/handoff_get` | sonnet-low |
| T4.5 | `tools/mcp-project-state/index.js` (edit) — loader dinâmico para `tools/*.js` | sonnet-medium |
| T4.6 | `tools/mcp-project-state/lib/stale-detector.js` (novo) — função `sweepOrphans(db, staleMinutes)` | sonnet-medium |
| T4.7 | `tools/cli/commands/state-stale-sweep.js` (novo) — CLI wrapper one-shot | sonnet-low |
| T4.8 | `tools/mcp-project-state/lib/scheduler.js` (novo) — `setInterval(sweepFn, 5min)` quando MCP roda | sonnet-medium |
| T4.9 | `test/test-mcp-agent-state.js` (novo) — JSON-RPC smoke dos novos tools | sonnet-low |

## Decisões técnicas (firmadas)

- **Loader pattern (T4.5):** require todos `./tools/*.js` no startup. Cada arquivo exporta `[{ name, schema, handler(db, args, dal) }]` array. Map cumulativo. Backward-compat: switch existente em `handleTool` é tentado primeiro; novos tools no Map são fallback.
- **Tools usam DAL:** novos tools recebem `dal` (instância de `AgentStateDAL`) além de `db`. Reusa lógica.
- **Scheduler (T4.8):** `setInterval(sweep, 5*60*1000)` em vez de `node-cron` — zero novas deps. Cleanup em SIGTERM.
- **Stale-detector (T4.6):** UPDATE `as_agent_runs SET status='orphaned' WHERE status='running' AND last_heartbeat_at < datetime('now', '-N min')`. Atomic. Retorna `{count, orphaned_ids}`.
- **CLI (T4.7):** `hseos state-stale-sweep [--directory D] [--stale-minutes N]` — invoca a mesma função para uso manual ou via cron OS se preferir.

## Definition of Done

- `curl -X POST http://127.0.0.1:3100 -d '{...tools/list}'` lista os 7 novos tools (3 runs + 2 agent-runs + 2 events + 2 handoffs minus duplicates).
- `runs_list({})` retorna runs do `as_runs`.
- `events_search({query: 'foo'})` usa FTS5.
- `state-stale-sweep` marca orphans visíveis em `state-list --orphans`.
- Server MCP em start agenda scheduler; em stop limpa.
- `npm test` passa.
