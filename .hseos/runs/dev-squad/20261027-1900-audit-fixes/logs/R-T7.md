# R-T7 — revisão cética da T7 (docs), alvo `ae4f9f82` (HEAD confirmado, sem REVIEW_TARGET_MOVED)

**Veredito: PASS-WITH-NOTES.** Nenhum fato novo foi refutado. Há 4 notas de consistência, nenhuma bloqueante.

## Verificado contra a fonte primária (passagem 1, cega)
- Decision 0006 do ECP: `gh api` no repo do ECP mostra "Accepted (2026-10-01, owner)". OK.
- 20 "aceito" em `w5/STATUS.md`: itens 1–7, 10–19, 23–25 = 20 (8, 9, 20, 21, 22, 26 vão para W10; 27 fechado). Os 8 com dono owner são 4, 5, 11, 15, 16, 19, 23, 24, como o MAPA lista. OK.
- M09: `w5-07/receipt.json:183`, dentro de `mutants_killed_by_new_tests`. Nenhuma outra linha o dá como sobrevivente. OK.
- Receipt: na base, `operational-state-db.js:528-529` (`backup_path`/`receipt_path`) e `:727` (`${backup}.receipt.json`) casam. OK.
- `:1102` (adaptador, comentário "Aligned with mcp-transport") e `:363` (`if (admission && binding) requireContextFloor`, em `tools/cli/lib/engineering-control.js`) corretos na base.
- STATUS do closeout: `4a089fe6` é o merge "integrate w3-contracts" e é ancestral da #238; `8c7d462d` é o merge "integrate w5-l4" e é ancestral da #240; `e8c45695`/`0ccb00a4` são ancestrais da #240; `a6278fdb` é o merge "integrate ... into task/w3-forget", ancestral da master. #238–#243 estão MERGED. Os estados e as ressalvas "não confirmado" são honestos.
- Tags `hseos-pend-p2/p3/p4` presentes em `git ls-remote --tags origin`. OK.
- Itens de commit: T1 `5ca358ad` liga `test-pids-max-single-source.js` ao `test:agent-transitive-isolation` (fora do CI na base: 0 ocorrências). P2 (#251) trouxe os testes de K9, `apply` pela CLI e a varredura de `pids_max` da árvore toda (>300 arquivos). T1, T3, T4 estão em `feature/audit-fix-w1`; T2, T5, T6a em `feature/audit-fix-w2`.
- v4-migration vs `3970dd7f`: flags `--receipt <path>` e `--allow-missing-receipt`, campo `receipt_verified`, código `EXECUTION_ACTIVATION_RECEIPT_REQUIRED`, receipt inválido continua em `EXECUTION_ACTIVATION_RECEIPT_INVALID` (nunca contornado). Hash do backup, `integrity_check`, `user_version` e hash da cópia continuam obrigatórios. Bate.
- §8: A-08/A-10 "em correção, não confirmado"; A-14 "não confirmado". Nenhum item "fechado" sem commit. Os commits citados existem.
- Nenhum recibo em `docs/evolution/**/evidence/**` nem `requirements.json` alterados (`git diff --name-only`: 7 arquivos, só docs/run records).
- Relatório copiado: `diff` com `AUDIT-REPORT.md` após o cabeçalho de 3 linhas + linha em branco = idêntico.
- Links relativos (MAPA→relatório, MAPA→`../../v4-migration.md`, PLAN→relatório/MAPA, relatório→MAPA, runbook `activation.md`): todos resolvem.
- `node --test --test-concurrency=1 test/test-documentation-neutrality.js`: 2/2 verde. Mensagem do commit sem atribuição de IA.

## Achados
1. **BAIXA — resíduo velho contradiz a correção nova.** `docs/evolution/pendencias-w0-w5/MAPA.md:32` ainda diz "`test-mcp-environment-host` (K9) falha sem cgroup delegado, também na baseline", e `MAPA.md:68` ainda diz "varredura ainda limitada a 5 arquivos". A nota da linha 113 desmente ambos; o leitor da §1/§2 vê a afirmação velha. Fonte: P2 #251 (`79e1c066`) e `test-pids-max-single-source.js:176`.
2. **BAIXA — "fechado pela T6b" prematuro.** `MAPA.md:107` (linha swarm-scope) diz "fechado pela T6b (ver §8)", enquanto §8 diz A-08 "Em correção ... não confirmado". T6b não tem revisão nem integração (só `2bde7a88` no branch local). Texto deveria dizer "em correção pela T6b".
3. **BAIXA — "Corrigido (PR #255)" com a PR aberta.** §8 marca A-01/A-02/A-03/A-05 como "Corrigido (PR #255)"; `gh pr view 255` = OPEN, sem merge. Aceitável se a T7 só entra depois, mas o Commander deve conferir a ordem de merge ou reescrever para "corrigido na PR #255 (aberta)". Idem "Corrigido (W2, PR a abrir)".
4. **INFO — A-20 parcial.** §8 diz "Run records atualizados"; o relatório A-20 tem mais dois pontos (sem rastro promessa→teste legível por máquina em `w3/w4 STATUS`; runs sem handoffs/logs) que não são tratados nem declarados como resíduo.
5. **INFO — CHANGELOG:37.** "locked to the SHA of the `contracts-v0.4.0` tag" é aproximação: o `w5/STATUS.md:228` diz "travada por SHA-256 da tag"; e as fixtures `registry-0.3.0/0.3.1.json` são de versões anteriores. Não há tag `contracts-v0.4.0` neste remoto (esperado: é do ECP). Sem impacto factual grave.

## Passagem 2 (confronto com `logs/T7.md`)
Confirmo as alegações: neutralidade 2/2, links, sem trocas de neutralidade, A-08/A-10/A-14 como declarados, tags no remoto. Refuto implicitamente a alegação "§6: ... incluídos K9, apply e pids_max" como completa: as menções velhas das linhas 32 e 68 (achado 1) ficaram.

## Não verificado
- `verify --shards 6` e Prettier (não rodados; só leitura). Prefixos dos nomes de PR de W2/W3 inexistentes.
- Conteúdo da PR #241 além do título/ancestralidade (W4-INT-1 e W4-INT-2 exatos); o executor já os marca "não confirmado".
- Se o primeiro noturno com o M-10 ocorreu (A-14, §7).
