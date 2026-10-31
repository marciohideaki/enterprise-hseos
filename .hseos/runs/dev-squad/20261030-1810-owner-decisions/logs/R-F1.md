# R-F1 — revisão cética do commit 3be12328 (branch task/od-f1-window-receipt)

Veredito: APROVADO COM RESSALVAS (nenhum bloqueante; 1 médio, 3 baixos).

## Passagem 1 (cega)
1. Ativação (`operational-state-db.js`): OK. `readApplyWindow` (~l.808-811 do apply) roda antes de `mkdirSync`, do lock e do backup; o teste confirma banco e diretório de backup intactos. `original_sha256_before` é comparado ao `sha256File(plan.database_path)` calculado pelo apply, não a valor do chamador. `recorded_at >= startedAt` recusa (estrito; igual recusa). O sha da janela é calculado sobre os mesmos `bytes` lidos e validados (sem TOCTOU nesse caminho). Caminho gravado é `path.resolve`.
2. Parser: v1 sem `window` OK; v2 com `window` malformado recusado; `receipt_version` 3 recusado; `window` sem v2 recusado. Não existe recusa de campos desconhecidos no parser (nem antes), então a alegação "como hoje" é neutra.
3. Gate: janela trocada reprova (inclusive a fornecida); com `window` no recibo, outro arquivo só passa se tiver exatamente os mesmos bytes (equivalente). v1 com janela fornecida inalterado.
4. Testes: 7 novos, comportamento real, sandbox via makeSandbox (TMPDIR). Rodados: 53/53, 6, 4, 9 verdes; conjunto de 4 arquivos = 72/72.
5. Mutações (cópia em /build/tmp/rev-f1, removida): (a) validar após o backup: derrubou 1 teste; (b) `>=`->`>`: derrubou 2; (c) aceitar receipt_version 3: SOBREVIVEU (53/53 verde). Ver M1.
6. Execuções: c8 com 5 arquivos (ledger-activation, operational-state-db, operational-state-gate, rehearsal, provider-binding) = 93,21 linhas / 91,57 branches (OK). Com apenas os 4 arquivos da minha seleção = 89,4/88,98 (a seleção importa). check:cli ok; eslint e prettier ok nos arquivos tocados; test-package-surface 1/1; sem atribuição de IA na mensagem do commit.
   `ci-test-shards.mjs verify --shards 6` EXISTE e passa: "OK 102 items ... covered once across 6 shards; 234 test files". A alegação do executor ("não existe") está REFUTADA.
7. Docs: runbook tem a seção com JSON e 4 passos; o bullet antigo (~l.99) foi trocado pelo "Registro da janela" e o bullet de "Fora desta ativação" foi atualizado. Sem resíduo de "decisão aberta".

## Achados
- M1 (médio, teste) `tools/mcp-project-state/lib/operational-state-db.js:582-587` / `test/test-execution-ledger-activation.js` (teste "malformed shape or unknown receipt_version"): o caso `{receipt_version: 3}` é recusado só porque o recibo tem `window` e `receiptWindowProblem` exige `=== 2`. A checagem independente de versão desconhecida (`RECEIPT_VERSIONS`) não é exercida. Repro: trocar `new Set([1, 2])` por `new Set([1, 2, 3])` e rodar o arquivo: 53/53 verde. Falta caso v3 sem `window` (e v0/string).
- B1 (baixo, robustez) `operational-state-db.js` (apply, `preLockSha256` vs `originalSha256`): o sha prévio é tirado antes do `wal_checkpoint(TRUNCATE)` do lock; com WAL não vazio, o sha muda no checkpoint e o apply recusa com "Database changed after the supervised window was validated" depois de já ter criado o diretório de backup e rodado o checkpoint (a promessa "sem tocar no banco" vale só para o caso pré-lock). Não reproduzido empiricamente; derivado da leitura. Fail-safe, mas confuso para o operador; documentar "consumidores parados e WAL checkpointado".
- B2 (baixo) `windowReason`: lê o registro (`readJsonObject`) e depois calcula `sha256File` em leituras separadas; TOCTOU só no gate (somente leitura), sem impacto de escrita. Ideal: um único buffer.
- B3 (baixo) `windowRecordProblem`: `Date.parse` aceita formatos não ISO e sem fuso (interpretados no fuso local do host); `recorded_at` como "2026-10-22T11:59:00" depende do TZ. Sugestão: exigir ISO com `Z`/offset. Não testado além de "not a date".
- I1 (informativo) Recibo v2 sem `window` é válido (apply sem `--window`, por decisão do owner), então remover `window` do JSON do recibo volta ao comportamento antigo (qualquer janela fornecida). O recibo não é assinado; é limite pré-existente, não regressão.

## Passagem 2 (confronto com logs/F1.md)
- 53/53: CONFIRMADO.
- c8 93,21/91,57: CONFIRMADO, com os 5 arquivos (o log diz "5 arquivos" sem listá-los; com 4 dá 89,4/88,98).
- "50/50" em 6 arquivos: não reconferi a contagem exata; os 4 do pedido somam 72 com o ledger; sem divergência de falha.
- Mutações: o log diz 3 testes (pular validação) e 1 (não comparar sha); não reproduzi essas duas. As minhas (a), (b) derrubaram; (c) sobreviveu.
- "verify --shards 6 não existe": REFUTADO (existe e passa).

## Reconferência rodada 1 (a07c9e99, amend de 3be12328)
Veredito: APROVADO COM 1 RESSALVA BAIXA (nenhum bloqueante).
- M1 FECHADO: v3/0/'2' sem `window` recusados; minha mutação (c) agora derruba 1 teste (54/55).
- B1 FECHADO: `mkdirSync(recursive)` devolve só o primeiro diretório criado (undefined se nada foi criado), e só ele é removido. Repro em cópia descartável: backup-dir pré-existente com `precious.txt` e `par/a/b` sob pai pré-existente com `precious2.txt`: ambos recusados com WINDOW_INVALID, arquivos preservados, `par/a` não existe depois, 55/55 verde. O WAL do teste é real (copia `-wal` com size > 0, asserta isso) e o `dumpOperational` fica igual. Ressalva: o checkpoint já rodou, então o sha do arquivo principal muda mesmo na recusa (conteúdo lógico idêntico); o runbook cobre isso.
- Leitura única FECHADA: `windowReason` lê `bytes` uma vez e usa o mesmo buffer para parse e sha.
- Fuso: regex exige `Z`/offset no apply e no gate. Mutação sem a regex derruba o teste do apply. RESSALVA B4 (baixo): o teste do gate (`apply accepts an explicit offset, and the gate rejects a recorded_at without a zone`) passa pela razão errada no TZ -03 deste host: "2026-10-22T11:59:00" sem fuso vira 14:59Z, posterior ao apply, e é recusado por ordem. Com `TZ=UTC` a mesma mutação derruba os 2 testes. Sugestão: usar um valor sem fuso que fique estritamente antes em qualquer TZ (ex.: 2026-10-21T00:00:00).
- Runbook: diff de `activation.md` só acrescenta a seção nova (+bullet de WAL); bullet ~l.99 e nota ~l.299 não tocados. Aviso de WAL correto e coerente com o código.
- Execução (cg.sh): 5 arquivos 83/83; c8 `operational-state-db.js` 93,58 linhas / 91,64 branches; check:cli ok; verify --shards 6 OK (102 itens, 234 arquivos); eslint e prettier ok. Worktree limpo (sem alterações minhas).
