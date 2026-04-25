# INTAKE — Wave 7: Kanban (Web side-car + CLI ASCII)

**Run ID:** 20260425-1942-state-w7-kanban
**Workflow:** dev-squad
**Commander:** SWARM (Opus 4.7)
**Base branch:** master (pós-merge Sprint 1)
**Feature branch:** feature/state-tracking-w7-kanban

## Goal

Wave 7 — entregar **2 superfícies** do kanban de agentes:
1. **Side-car web** local em `127.0.0.1:3200`, reativo via SSE, lê `.hseos/state/project.db` em read-only e reflete mudanças em tempo real (polling 1s + checksum diff).
2. **CLI ASCII colorido** (`hseos kanban`), terminal-first, lê SQLite direto sem precisar do side-car ativo, opcional `--watch`.

Ambas surfaces compartilham a mesma lib `tools/state-ui-server/lib/snapshot.js` — DRY, single source of truth.

## Tasks (7, 100% paralelas)

| Task | File(s) | Tier |
|---|---|---|
| T7.1 | `tools/state-ui-server/lib/snapshot.js` | sonnet-medium |
| T7.2 | `tools/state-ui-server/index.js` | sonnet-medium |
| T7.3 | `tools/state-ui-server/web/index.html` + `web/app.js` + `web/styles.css` | sonnet-medium |
| T7.4 | `tools/cli/commands/state-ui.js` | sonnet-low |
| T7.5 | `tools/cli/commands/kanban.js` | sonnet-medium |
| T7.6 | `.hseos/config/hseos.config.yaml` (edit) | haiku |
| T7.7 | `test/test-state-ui.js` + `test/test-kanban-cli.js` | sonnet-low |

## Non-goals

- Drilldown de eventos por click (defer).
- Filtros UI por agente/projeto (use querystring).
- Auth (bind 127.0.0.1 isola).
- WebSocket bi-direcional (SSE basta).

## Definition of Done

- `hseos state-ui start` → browser em `127.0.0.1:3200` mostra colunas com cards.
- Modificar SQLite externamente (`hseos state-emit ...`) → board atualiza ≤1s sem reload manual.
- `hseos kanban` → ASCII colorido sem precisar de side-car rodando.
- `hseos kanban --watch` → re-render contínuo a cada 1s; SIGINT encerra graceful.
- `npm test` passa.
