# R-T6a — revisão cética de `aaa71e3a` (branch task/audit-t6a-rollback, base f96c6e9c)

HEAD conferido: `aaa71e3a1822b4cf7dfb9ceba71642fe26da53ce` (sem REVIEW_TARGET_MOVED).

## Veredito: PASS-WITH-NOTES

Nenhum bypass do receipt encontrado. Duas lacunas de teste (N1, N2) e uma observação de UX (N3). Nenhuma bloqueia.

## Achados

| # | Sev. | Local | Descrição / reprodução |
|---|---|---|---|
| N1 | Média (teste) | `test/test-execution-ledger-activation.js` (bloco novo, ~:268-406) | Falta teste de `allowMissingReceipt:true` com receipt PRESENTE e contraditório (critério 3). O código recusa (provado por script próprio: `BACKUP_CONTENT_MISMATCH`), mas a mutação M2 (`if (receiptVerified && !allowMissingReceipt)` em operational-state-db.js:~750) sobrevive: 36/36 verdes. Um bypass futuro dessa forma passaria. |
| N2 | Baixa (teste) | idem | O teste "allowing a missing receipt does not relax the other checks" cobre só o sha do backup. `integrity_check`, `user_version` e sha da cópia com a flag não têm caso próprio. Mutação M4 (flag pula o sha do backup) também sobrevive, mas é quase equivalente: o `sha256File(temporary)` posterior recusa com o mesmo código antes de qualquer troca. `integrity_check`/`user_version` rodam antes e incondicionalmente no código (leitura do diff), sem teste que as fixe com a flag. |
| N3 | Info | operational-state-db.js:683-698 | Com a flag, receipt presente porém corrompido (vazio, diretório, JSON inválido, `original_sha256_before` null/""/não-hex) ainda recusa com `RECEIPT_INVALID`; a flag não o contorna. É mais estrito que a spec e seguro; o operador precisa remover o arquivo. Vale uma linha no runbook. |
| N4 | Info | runbook activation.md:120 | A frase do rollback ficou longa: depois de `receipt_verified: true;` segue "re-registrar o servidor legado..." sem separar passo. Coerente com o código, só de leitura pior. |

## Verificações (passagem 1, cega)

1. Caminhos sem receipt (script descartável sobre o código do commit): receipt vazio, diretório, `original_sha256_before` null/"" -> `RECEIPT_INVALID` (recusa, com e sem flag); `--receipt` explícito inexistente -> `RECEIPT_REQUIRED`; JSON sem o campo -> `RECEIPT_REQUIRED` (teste do commit); symlink para receipt válido -> aceito (`readFileSync` segue o link; não é bypass, o conteúdo é cruzado). Nenhum pula o receipt sem a flag.
2. Flag não relaxa o resto: backup sha coberto por teste; integrity/user_version/sha da cópia só por leitura de código (N2).
3. Flag + receipt contraditório: recusa (provado por script), sem teste (N1).
4. `--receipt` de outro backup: o cruzamento é só `original_sha256_before === expectedSha256`; contradição recusa (teste do commit, lib e CLI). Meu cenário "receipt de outro sandbox" passou OK porque os dois bancos de origem são byte-idênticos, então não prova nada; o caso real é o da contradição. Observação pré-existente: `backup_sha256`/`backup_path` do receipt não são cruzados.
5. `receipt_verified`: igual a `Boolean(receipt && original_sha256_before)`, e o cruzamento ocorre no mesmo ramo. Mutação M3 (sempre true) derrubou 2 testes.
6. `node scripts/generate-cli-command-manifest.js --check` = 0; `npm run check:cli` = 0.
7. Runbook coerente com o código (flags, código de erro, `receipt_verified`), ver N4.
8. Diff de `test/`: só linhas adicionadas (nenhuma `-`). Casos antigos (:197, :228, :278, :500, :573) verdes.
9. Contagens literais no worktree (cg.sh, concorrência 1): test-execution-ledger-activation.js 36/36; test-operational-state-db.js 6/6; test-agentic-activation-rehearsal.js 4/4; test-package-surface.js 1/1.
10. Colisão `activated-<stamp>`: `existsSync(preserved)` lança `BACKUP_EXISTS` antes de copiar; um corrida residual cairia em `linkSync` EEXIST, com `rmSync(temporary)` no catch. Banco ativado intacto, nada perdido. Fail-closed confirmado.
11. eslint (3 arquivos) = 0; prettier --check (3 arquivos + manifesto) limpo; mensagem do commit sem atribuição de IA; árvore do worktree limpa.

Mutações em cópia descartável (`git archive` + symlink de node_modules, removida ao fim):
- M1 pulo silencioso (`if (false)`): 3 falhas reais (33/36). Derrubada.
- M2 flag pula contradição: 36/36. SOBREVIVEU (N1).
- M3 `receipt_verified: true`: 2 falhas. Derrubada.
- M4 flag pula sha do backup: 36/36. Sobreviveu, quase equivalente (N2).

## Passagem 2 — alegações do executor

| Alegação | Resultado |
|---|---|
| RECEIPT_REQUIRED com caminho e menção às flags | Confirmada (mensagem em operational-state-db.js:~746) |
| `allowMissingReceipt` e `receipt_verified` true/false; demais checks obrigatórios | Confirmada no código; teste só para o sha do backup (N2) |
| CLI `--receipt`, `--allow-missing-receipt`, `--json` com o campo | Confirmada |
| Manifesto regenerado, `--check` = 0 | Confirmada |
| Runbook atualizado, `v4-migration.md` intocado | Confirmada (diff só em activation.md) |
| Nenhuma asserção existente alterada | Confirmada (diff de test/ só adiciona) |
| Mutação: 6 falhas em 35, 3 por defeito da cópia | Parcialmente reproduzida: em cópia completa são 3 falhas em 36, coerente com "3 reais"; o executor admite que o vermelho não foi provado no worktree (eu o provei via M1) |
| Verde 45/45 antes da divisão de teste | Consistente: hoje 36+6+4 = 46 após a divisão |
| Colisão de 1 s é fail-closed | Confirmada |
| c8 não rodado | Confirmado como não verificado por mim também |

## Não verificado
- Cobertura c8 das linhas novas.
- Hook de pre-commit 132/132 (não reexecutado).
- Rollback com banco real, fora de sandbox (proibido tocar `project.db`).
- Cruzamento de `backup_sha256`/`backup_path` do receipt (fora do escopo do commit).

Recomendação: antes do merge, acrescentar o teste N1 (uma asserção a mais, sem alterar as existentes).
