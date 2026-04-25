# INTAKE — Wave 8: Central multi-project kanban

**Run ID:** 20260425-2124-state-w8-central-kanban
**Workflow:** dev-squad | **Commander:** SWARM (Opus 4.7)
**Base branch:** feature/state-tracking-w7-kanban (W7 stacked, W7 PR ainda não mergeado em master)
**Feature branch:** feature/state-tracking-w8-central-kanban

## Goal

Adicionar **kanban central** que agrega todos os projetos com HSEOS instalado num único board. Cada projeto continua escrevendo no seu `.hseos/state/project.db` local; o server central abre N DBs read-only e expõe um único endpoint SSE com filtro por projeto.

Reusa 100% do código de W7 (snapshot.js, server SSE, frontend); adiciona registry + agregador + flag `--registry` no server.

## Tasks (7 paralelas)

| Task | File(s) | Tier |
|---|---|---|
| T8.1 | `tools/cli/commands/kanban-central.js` (novo) | sonnet-medium |
| T8.2 | `tools/state-ui-server/lib/snapshot-multi.js` (novo) | sonnet-medium |
| T8.3 | `tools/state-ui-server/index.js` (edit — modo --registry) | sonnet-medium |
| T8.4 | `tools/state-ui-server/web/app.js` (edit — UI multi-projeto) | sonnet-low |
| T8.5 | `tools/state-ui-server/lib/registry.js` (novo) | sonnet-low |
| T8.6 | `test/test-kanban-central.js` (novo) | sonnet-low |
| T8.7 | `.hseos/config/hseos.config.yaml` (edit — central_port) | haiku |

## DoD

- `hseos kanban-central register <path>` adiciona ao `~/.hseos/projects.json`.
- `hseos kanban-central start` inicia server port 3210 lendo de N DBs.
- http://127.0.0.1:3210 mostra board agregado com filtro project + cores.
- Falha de 1 DB → `db_status: 'missing'`, demais seguem.
- W7 side-car (port 3200) continua isolado.
- `npm test` passa.
