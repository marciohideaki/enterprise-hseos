# T6b — relatório do executor (exec-t6b), recebido 2026-10-28T00:41Z

Commit `2bde7a88` em `task/audit-t6b-swarm`.

## Alegações do executor

**A-08**
- Helper `stopChild` em `test-mcp-hseos-swarm-scope.js:51`: só aguarda o `exit` se o filho ainda estiver vivo, e cria a promessa antes do `kill`. Os dois `finally` passam a usá-lo.
- Boot quebrado (forçado com preload via `NODE_OPTIONS`): antes, EXIT=0 sem contagem; depois, `fatal: server exited (1)` e EXIT=1.
- `test-mcp-hseos-swarm.js` já tratava o boot quebrado e não foi alterado.

**A-10**
- `mkdirContained` e `readdirContained` (este com `withFileTypes`), ambos por fd via `/proc/self/fd` e com `hooks.afterCheck`. O fallback por caminho fora do Linux está declarado.
- Aplicados em `plan_squad.js`, `consolidate_handoff.js`, `get_run_state.js` e `list_runs.js` (`list_runs` usa `isDirectory` no lugar de `statSync`).
- O `base` do mkdir é `projectRoot()`, porque `runsDir` pode não existir. `resolveRunDir` restringe antes.

**Testes**
- Novos: mkdir com ancestral trocado (2 cenários) e readdir com diretório trocado.
- Vermelho: 27 passam e 2 falham.
- Mutação de volta ao mkdir por caminho: 28 passam e 1 falha.
- Verde:

| Comando | Resultado |
|---|---|
| `scope` com `node` | 29/29 |
| `swarm` | 6/6 |
| `scope` com `node --test` | 29/29 |
| `package-surface` | verde |
| eslint/prettier | limpos |

**c8 de `run-scope.js`**
- 95,92 stmts, 88,76 branch, 100 funcs.
- Sem cobertura: o fallback fora do Linux e os ramos defensivos de erro.
