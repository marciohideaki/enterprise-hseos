# STATUS — audit-fixes (2026-10-27)

| Onda | Feature | Task | Executor | Estado | Commit | Revisão |
|---|---|---|---|---|---|---|
| W1 | feature/audit-fix-w1 | T1 CI cobre todos os testes | exec-t1 (Sonnet) | aceita (rodada 1) | `5ca358ad` | rev-t1 PASS-WITH-NOTES → corrigido; reconferido pelo Commander (23/23, verify OK) |
| W1 | feature/audit-fix-w1 | T3 envelopes MCP | exec-t3 (Sonnet) | aceita (rodada 1) | `cc7a11e5` | rev-t3 PASS-WITH-NOTES (sufixo denial, axon, governance) → corrigido; reconferido pelo Commander (eslint v9 limpo, robustness 29/29, axon 23/23, readiness 6/6; única asserção alterada foi endurecida) |
| W1 | feature/audit-fix-w1 | T4 redação de chave | exec-t4 (Sonnet) | aceita (rodada 1) | `16ddc595` | rev-t4 PASS-WITH-NOTES (F1 prefixo após =/-/_//, F2 cauda colada, c8 probeStderr) → corrigido; reconferido pelo Commander (54/54, eslint v9 limpo, controle negativo de digest preservado com título novo) |
| W1 | feature/audit-fix-w1 | integração | Commander | merges `9c34a5a9`, `6263fd75`, `f2ac5505`; suíte completa da onda 102/102, 3974 testes, 0 falhas, exit 0 (23:52–00:25Z); PR #255 aberta, aguardando CI e autorização de merge do owner | `f2ac5505` | — |
| W2 | feature/audit-fix-w2 | T2 gates de mutação | exec-t2 (Sonnet) | aceita (rodada 1); prova W5 feita na integração | `a6788e01` | rev-t2 PASS-WITH-NOTES (fail/pass isolados, linha única de resumo) → corrigido; W4 checker exit 0 |
| W2 | feature/audit-fix-w2 | T5 controle e lock | exec-t5 (Sonnet) | aceita (rodada 1) | `b7cd77a5` | rev-t5 PASS-WITH-NOTES (janela rename→link declarada como resíduo; teste da devolução; comentários corrigidos); diff de test/ só adiciona; prova final na suíte da W2 |
| W2 | feature/audit-fix-w2 | T6a rollback com receipt | exec-t6a (Sonnet) | aceita (rodada 1) | `3970dd7f` | rev-t6a PASS-WITH-NOTES (flag + receipt contraditório sem teste; integridade/user_version com flag; runbook) → corrigido, 48/48 |
| W2 | feature/audit-fix-w2 | integração | Commander | merges `0b89c01c`, `e014e198`, `3a02f6b3`; suíte da onda 102/102, 3844 testes, 0 falhas, exit 0 (00:37–01:11Z); checkers W4 20 e W5 43 rejeitados, exit 0; PR #256 aberta, aguardando CI e autorização de merge do owner | `3a02f6b3` | — |
| W3 | feature/audit-fix-w3 | T6b swarm por fd | exec-t6b (Sonnet) | aceita (rodada 1) | `df3ed51e` | rev-t6b PASS-WITH-NOTES (hook dentro do laço; base runsDir) → corrigido, 3 mutações mortas, 31/31 |
| W3 | feature/audit-fix-w3 | T7 docs e reconciliação | exec-t7 (Sonnet) | aceita (rodada 1) | `8ef4b877` | rev-t7 PASS-WITH-NOTES (linhas velhas do MAPA, estados sem merge, CHANGELOG SHA-256, A-20) → corrigido |
| W3 | feature/audit-fix-w3 | integração | Commander | merges `02c6c77c`, `5037de06`; suíte da onda 102/102, 3827 testes, 0 falhas, exit 0 (00:48–01:43Z); PR da W3 com os registros desta run | `5037de06` | — |

## Desvios
- 2026-10-27: o hook de contrato de spec recusou prompts de despacho com menos de 500 caracteres; os prompts foram reenviados com o resumo inline (objetivo, decisões, restrições, saída) mais o arquivo `prompts/T*.md`.
- 2026-10-27: `test-campaign-evidence.js` rodado fora do cgroup pendura depois de `CONTROL_REQUEST_REJECTED` (também em HEAD) e segurou o lock do heavy-run por ~46 min. O exec-t4 encerrou o próprio job. O exec-t3 rodou os testes com `nice -n 19`, um por vez, com load1 menor que o número de cores, autorizado pelo Commander; o `heavy-run --check` antes de cada teste não foi aplicado (a orientação chegou depois). Resíduo registrado: esse teste deveria falhar rápido fora do cgroup.
- 2026-10-27: `npx eslint` nos worktrees resolve uma v6 sem configuração; usar `node_modules/.bin/eslint`.
- 2026-10-27: o `worktree-manager.sh merge` faz checkout da feature no checkout principal e exige `status=committed` no meta (os commits saem por commit-in-cgroup). A integração foi feita com o mesmo `git merge --no-ff` num worktree dedicado (`/build/tmp/audit-fixes/int-w<k>`), sem trocar a branch do checkout principal.
- 2026-10-28: resíduo declarado (T5) — o takeover do mutex do lock de install tem uma janela residual entre o `rename` do mutex velho e o `link` de devolução; um terceiro taker pode entrar. Mitigação: o holder é relido sob o mutex e só o lock de um holder morto é removido. Fechar exige redesenhar o lock (fora desta run).
- 2026-10-28: resíduo (T6a) — dois rollbacks da ativação no mesmo segundo colidem no nome `…activated-<stamp>` (resolução de 1 s) e recusam com `BACKUP_EXISTS` (fail-closed, sem perda de dados).

## Merge
- 2026-10-28: o owner foi consultado sobre o merge das PRs #255 e #256 e da PR da W3, e não respondeu em 300 s. Nenhuma PR foi mergeada: o merge exige autorização explícita (AGENTS.md §9). As tags `hseos-audit-fix-w<k>` e o `workflow_dispatch` do CI pós-merge (A-14) ficam para depois do merge.

## Custo por atividade (aproximado)
| Atividade | Executor | Tokens (subagente) |
|---|---|---|
| Exploração para o plano | 3 Explore (Sonnet) | ~196 k |
| W1: T1, T3, T4 e revisões | 3 executores e 3 revisores (Sonnet) | não medido por agente nesta run |
| W2: T2, T5, T6a e revisões | 3 executores e 3 revisores (Sonnet) | não medido |
| W3: T6b, T7 e revisões | 2 executores e 2 revisores (Sonnet) | não medido |
| Suítes de onda (3×, ~33–55 min cada) | Commander via heavy-run | — |
