# WAVE-8-REPORT — Central multi-project kanban

**Run:** 20260425-2124-state-w8-central-kanban
**Wave:** 8 (Sprint 4)
**Branch:** feature/state-tracking-w8-central-kanban (stacked sobre W7)
**Status:** READY-FOR-G4
**Date:** 2026-04-25

## Result Summary

7 tasks executadas e merged. Central kanban operacional: agrega N projetos via registry, modo single (W7) preservado, graceful degrade de DBs ausentes confirmado em smoke.

## Task Results

| Task | Commit | Merge | Result |
|---|---|---|---|
| T8.1 — kanban-central CLI | `aa9b08e` | `1b2298f` | ✅ |
| T8.5 — registry.js | `22b6f3d` | `ed4df39` | ✅ |
| T8.2 — snapshot-multi.js | `2344528` | `7814fc3` | ✅ |
| T8.3 — server --registry mode | `0cfbc00` | `e905d54` | ✅ |
| T8.4 — frontend project filter + badges | `049d8d3` | `a874b80` | ✅ |
| T8.6 — smoke test | `378aa11` | `71d4e9c` | ✅ |
| T8.7 — config keys | `7e7170e` | `726e4e1` | ✅ |

## E2E smoke (com 2 DBs reais)

```
curl /health  →  { mode: 'central', projects: 2, projects_ok: 2 }
curl /api/state →
  projects_meta: [
    { id: 'proj-a', label: 'Project A', color: '#00d3ff', status: 'ok' },
    { id: 'proj-b', label: 'Project B', color: '#bd93f9', status: 'ok' }
  ],
  runs: 2 (cada um com project_id injetado),
  tasks: 2, agentRuns: 2,
  counts: { running: 2 },
  counts_by_project: { 'proj-a': { running: 1 }, 'proj-b': { running: 1 } }
```

**Graceful degrade test (deletar 1 DB):**
- proj-a status: `missing` ✅
- proj-b status: `ok` ✅
- runs após deleção: 1 (só proj-b) ✅
- Server continua respondendo sem crash ✅

## Lint Cleanup (closeout)

3 errors fixed inline durante closeout:
- `registry.js:74` — `>= 0` → `=== -1` invertendo if/else (unicorn duplo: `consistent-existence-index-check` + `no-negated-condition`)
- `registry.js:90` — `validate()` ternário aninhado quebrado em if/else if/else
- `snapshot-multi.js:116` — `{ ...emptyCounts(), ...(s.counts || {}) }` → `s.counts ? { ...emptyCounts(), ...s.counts } : emptyCounts()` (unicorn `no-useless-fallback-in-spread`)

## CLI Usage

```bash
# Setup once per environment
hseos kanban-central register /opt/projeto-a --id projeto-a --color "#00d3ff"
hseos kanban-central register /opt/projeto-b --id projeto-b --color "#bd93f9"
hseos kanban-central list

# Daily use
hseos kanban-central start    # port 3210, lê todos os projetos do registry
hseos kanban-central status
hseos kanban-central stop
```

## Architecture

```
~/.hseos/projects.json (registry per-host, gitignored)
  └─ projects[]: [{ id, path, label, color }]
                     │
                     ▼ read-only WAL (cada projeto)
hseos kanban-central start (port 3210)
  ├─ snapshot-multi: agrega via takeSnapshot(db) por projeto, injeta project_id
  ├─ /api/state: retorna { projects_meta, runs, tasks, agentRuns, events, orphans, counts, counts_by_project }
  ├─ /events: SSE merged stream (1s tick + SHA1 diff)
  └─ /health: { mode: 'central', projects: N, projects_ok: M }
```

## Backward compat

Server preserva modo single-DB (sem `--registry`). W7 side-car em port 3200 continua funcionando isolado.

## Definition of Done — Verification

- [x] `hseos kanban-central register/deregister/list/start/stop/status` funcionais
- [x] http://127.0.0.1:3210/api/state retorna agregado de N projetos
- [x] Cards no UI mostram badges de projeto + cor (border-left aplicado via inline style)
- [x] Filtro project no UI persiste em `localStorage`
- [x] Graceful degrade de DB ausente (smoke test confirma)
- [x] Per-project side-car (port 3200) preservado
- [x] `npm test` lint passa
- [ ] **Pending G4:** human abre PR
- [ ] **Pending G5:** human merge para master (após mergear W7 e este sequencialmente)

## Notes

- Sprint 4 (este wave) só tem 1 wave por design — escopo enxuto, foundation reusada de W7.
- Wave 9 fast-follow (fora deste plano): Dockerfile + docker-compose para distribuição em container, Caddy reverse proxy, Tailscale ingress.

## Halt — Pending G4

```bash
git push -u origin feature/state-tracking-w8-central-kanban
gh pr create --base feature/state-tracking-w7-kanban \
  --title "feat(state): wave 8 central multi-project kanban" \
  --body "$(cat .hseos/runs/dev-squad/20260425-2124-state-w8-central-kanban/WAVE-8-REPORT.md)"
```
