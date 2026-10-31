# R-D8a — revisão cética de 0c71a6d8 (retenção de 90 dias)

Veredito: **PASS-WITH-NOTES** (nenhum defeito de código encontrado; 3 lacunas de teste e 1 nota de política).

## Itens
| # | Item | Veredito | Evidência |
|---|---|---|---|
| 1 | pruneEvidence | PASS | Só nomes `^[a-f0-9]{64}$` (90d) e `.tmp-*` (1d); `lstat` + `isFile`. Sonda: symlink com nome de hash para fora, mtime do alvo 400d: alvo e link intactos; hardlink com nome de hash: só o nome do store sai, o outro nome permanece; nomes `..cccc…` e `.tmp-.._x` não saem do diretório; diretório não é tocado (EISDIR engolido). |
| 2 | Leitura | PASS | `EXPIRED` só quando `UNAVAILABLE` (ENOENT) e idade do receipt `occurred_at` > 90d (`provider-campaign-control.js` ~:316). CORRUPT propaga; ausente recente = UNAVAILABLE. Mutação "sempre EXPIRED" derruba 2 testes. |
| 3 | Caller/throttle/relógio | PASS | `storeEvidence` chama o prune (1x/dia por `state`, `lastPrune`); control passa `{ now: this.now() }` (:694). Teste de dispatch real prova. |
| 4 | Adapters | PASS | API: só `content.delta` (reasoning só entra no digest antigo), teto `MAX_EVIDENCE_BYTES`, credencial do binding em `[value]`. ACP: worker devolve `text`/`text_too_large` (teto 65536). Antigravity `not_observable` está no enum do schema e documentado. native/claude-account: `retainOutput` movido para o store sem mudança de lógica. |
| 4b | Digest ACP | PASS (sem quebra) | O texto NUNCA esteve no digest: o resultado antigo tinha `text_sha256`, não `text`. `attested` (resultado sem `text`/`text_too_large`) tem as mesmas chaves, então `engineeringDigest` é idêntico: verificado nos 3 casos (com texto, too_large, sem texto). Receipts/atestações antigos continuam verificáveis. Anti-adulteração preservada: `text_sha256` segue no digest e `withholdReason` exige sha256(text)==text_sha256. O que muda é o digest do artefato do adapter (arquivos), documentado como re-pin. A frase "deixa de incluir o texto" não se aplica ao código. |
| 5 | containsCredential / redação | PASS-WITH-NOTE | `containsCredential` intacto. Ver achado N1. |
| 6 | Testes | PASS-WITH-NOTES | Diff de test/ só adiciona, exceto `test-provider-campaign-adapters.js` (1 linha trocada por variável + 3 asserts novos, justificado). Mutações próprias: M1 sem `utimesSync` derruba 1 (renovação); M4 EXPIRED sempre derruba 2. Sobreviveram: M2, M3, M5 (achados T1–T3). |
| 7 | Verdes (cgroup) | PASS | evidence+api+acp-boundaries 39/39; adapters+control+key-body+runner 109/109; package-surface+pids+codex-acp-peer+kernel-quality 25/25. |
| 8 | c8 (seleção de 8 arquivos de teste) | PASS | campaign-evidence-store 97.28/94.26; acp-adapter 100/97.14; acp-worker 95.71/96.77; antigravity 100/93.47; api 98.79/93.42; control 96.4/92.98; native 100/84 (stmts/branch). Todos ≥90/80. `campaign-evidence-store.js` não está no `.c8-kernel.json` (informativo). |
| 9 | Docs/lint/G3/commit | PASS | v4-migration e engineering-control-api batem com o código (90d, EXPIRED, prune 1x/dia, not_observable, re-pin). eslint limpo; prettier limpo; G3 ok (só arquivos existentes); mensagem sem atribuição de IA. |

## Achados
- **N1 (Média, política, não-regressão)** `campaign-evidence-store.js` `containsCredential`: corpo de chave privada sem marcador (ex.: 3 linhas base64 com cabeçalho DER `MC4CAQAwBQYDK2V…`) NÃO é detectado e fica retido (`retainOutput` devolveu `evidence_ref`). `redactDiagnosticText` o pegaria, mas por decisão documentada no próprio arquivo não é aplicado à saída retida. Já valia para native/claude; agora passa a valer também para API e ACP. Sugestão: decisão explícita do owner ou aplicar a detecção de corpo como recusa (`credential_pattern`) em texto retido.
- **T1 (Baixa)** `test-provider-api-adapter.js`: nada exercita a credencial do binding como segredo conhecido; a mutação `[value]`→`[]` sobrevive (só o padrão AKIA é testado).
- **T2 (Baixa)** `test-provider-api-adapter.js`: nada prova que `reasoning.delta` fica fora do texto retido; mutação "reter tudo" sobrevive.
- **T3 (Baixa)** `test-campaign-evidence.js`: o symlink plantado tem mtime de agora (utimes segue o link), então o teste de "link não removido" passa mesmo sem a checagem `isFile` (mutação sobrevive). O código está correto; o teste é vácuo para o link. Plantar mtime antigo com `fs.lutimesSync`.
- **N2 (Baixa)** Corrida teórica: entre o prune e `utimesSync` outro processo pode expurgar o arquivo; `utimesSync` lançaria ENOENT sem tratamento. Janela mínima (só artefatos a ~90d).
- **N3 (Informativa)** `lastPrune` com `now` injetado no futuro suprime o prune até o relógio real alcançá-lo; só afeta testes.

## Alegação do executor → resultado
| Alegação | Resultado |
|---|---|
| native/claude já retinham; API e ACP passam; antigravity not_observable | Confirmada |
| Mutação Infinity derruba 4 | Confirmada (4 falhas) |
| Sem prune derruba 2 | Confirmada (2 falhas) |
| Verde 213/213 | Não reproduzível como número único; reproduzi 39+109+25 (e 159 na seleção do c8), todos verdes, 0 falhas |
| Vermelho 11 falhas antes da implementação | Não re-medido (não rodei os testes novos contra a base) |
