# PLAN — Wave 8

G2 cleared via /plan mode (Sprint 4 in master plan). Same shape contract documented there.

## Critical artifacts

- T8.5 `lib/registry.js` — `loadRegistry/saveRegistry/addProject/removeProject/validate/projectDbPath` + atomic tmp-rename writes
- T8.2 `lib/snapshot-multi.js` — `takeMultiSnapshot(registry, opts)` reusa `takeSnapshot(db, opts)` da W7, injeta `project_id`, retorna agregado com `projects_meta[]` + `counts_by_project`
- T8.1 `commands/kanban-central.js` — register/deregister/list/start/stop/status; CLI lifecycle mirror state-ui
- T8.3 `state-ui-server/index.js` edit — `--registry <path>` flag muda para multi-mode, sem quebrar mode single
- T8.4 `web/app.js` edit — render `projects_meta` no dropdown, cores aplicadas via inline style nos cards, persistência localStorage
- T8.6 `test/test-kanban-central.js` — 2 fake DBs com migrations 001/002/003 aplicadas, registry temp, server temp port, fetch /api/state, valida shape multi
- T8.7 `hseos.config.yaml` — adicionar `central_port: 3210`, `central_registry: ~/.hseos/projects.json`

## Order of operations

1. Commit scaffolding (este run-dir)
2. Criar 7 worktrees via `git branch + git worktree add` (workaround bug)
3. Tasks paralelas
4. Merge sequencial via `git merge --no-ff -m "chore(merge): ..."` (workaround bug)
5. Cleanup
6. Closeout
