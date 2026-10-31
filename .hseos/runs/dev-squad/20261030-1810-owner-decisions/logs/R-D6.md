# R-D6 — revisão cética da task D6 (commit 48197ebd, base f953992b)

Veredito: PASS-WITH-NOTES

## Itens
1. `.c8-kernel.json`: PASS. Só 6 linhas acrescentadas ao `include`; `lines`, `branches`, `per-file`, `check-coverage`, `all`, `exclude` intactos (diff de 6 inserções, 0 remoções). Nenhum `c8 ignore` novo (grep no diff de tools/packages e nos 2 testes novos: 0).
2. `package.json`: PASS. Só o `test:kernel` mudou (1 linha); acréscimos: 2 arquivos novos + test-operational-state-db, test-execution-ledger-activation, test-execution-projections, test-w5-environment-ledger, test-state-purge. Nada removido. `ci-test-shards.mjs verify --shards 6`: OK (102 itens, 229 arquivos). Também mudou `.github/scripts/ci-test-shard-weights.json` (666 -> 680 para kernel-coverage), arquivo que a spec do revisor não listava, mas coerente com o acréscimo.
3. Qualidade dos testes: PASS. Amostra de 12 casos lida (migrations x2, approval store x5, projections x3, activation x2): todos afirmam códigos de erro, contagens de linhas no banco, rollback e mensagens; nenhum só chama função. Observação (baixa): `test-execution-state-gate.js:300-322` ("unexpected storage error") tem um `live.db.prepare = live.db.prepare.bind(...)` sem efeito e um `assert.ok(approvals)` decorativo; o caso ainda afirma o erro real "no such table".
4. Código inalcançável: CONFIRMADO. `007-execution-approvals.sql:43-46` (`execution_approvals_no_replace`, BEFORE INSERT ... RAISE(ABORT)) dispara antes da checagem de PK, então o `catch` de `SQLITE_CONSTRAINT_PRIMARYKEY` em `execution-approval-store.js:177-181` nunca é atingido; o teste afirma `/identity is immutable/`. Nota: a numeração citada (137-138) não bate com este arquivo; as linhas descobertas reais são 87-88 e 180-181.
5. Mutações (cópia descartável em /build/tmp/rev-d6, removida): (a) `migrations.js:76` `<=` -> `<`: 2 testes falham (logger/skip e corrida de versão); (b) `execution-projections.js:279` check de schema anulado (`false &&`): 1 teste falha (stale schemas). Ambas mortas.
6. Execução: 4 arquivos (gate x2, operational-state-db, execution-ledger-activation) 80/80 passam via cg.sh. c8 com 8 testes do kernel (117 pass): approval 98.08/95; ledger 100/97.9; projections 98.63/97.41; migrations 97.97/93.33; operational-state-db 92.18/87.83. Todos acima de 90/80.
7. Sandbox: PASS. Bancos em mkdtemp sob `TMPDIR`/`os.tmpdir()` (que respeita TMPDIR); `/tmp` literal ausente; o único caminho `os.tmpdir()/hseos-gate-never-created` nunca é criado (o teste afirma isso); `.hseos/state/project.db` não é tocado.
8. eslint (rtk proxy): exit 0; prettier nos 2 testes + .c8-kernel.json + package.json: OK; `test-package-surface.js`: 1/1. Mensagem do commit sem Co-Authored-By nem menção a IA.

## Achados
- BAIXA — `test/test-execution-state-gate.js:300-322`: linhas sem efeito (ver item 3).
- BAIXA — numeração de linhas da alegação (137-138) não corresponde ao arquivo; real 177-181.
- INFO — o gate depende de testes pré-existentes para `packages/agent-environment/index.js`: com os 8 testes de ledger o index.js fica em 71,68% (linhas 8-10,13-23...); com os testes de environment/lsp/dap/memory sobe a 100% em um dos index.js listados, mas não isolei por arquivo. É coerente com o gate rodar o `test:kernel` completo; não é defeito.

## Alegação -> veredito
| Alegação | Veredito |
|---|---|
| approval 98.08/95 | confirmada |
| ledger 100/97.94 | confirmada (100/97.9) |
| migrations 97.97/93.33 | confirmada |
| operational-state-db 92.18/88 | confirmada com ressalva (92.18/87.83 no meu subconjunto; 88 arredondado) |
| projections 98.63/98.36 | parcial (98.63 linhas; branches 97.41 no meu subconjunto) |
| agent-environment/index 100/100 | não confirmada isoladamente (depende dos testes de environment; o subconjunto de ledger dá 71,68%) |
| duas mutações mortas | confirmada (fiz 2 próprias, ambas mortas) |
| código inalcançável no approval store | confirmada (trigger BEFORE INSERT) |
| exit 1 por test-environment-browser.js:244 sob carga | não verificada (não rodei o test:kernel completo, por instrução) |

Nada de afrouxamento detectado; nada editado no worktree.
