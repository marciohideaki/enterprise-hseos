# STATUS — run `20261113-repo-hygiene`

Base `master` `a4fabbd5`. Escopo, autorizações e divergências da linha de base: `INTAKE.md`. Plano e Execution Protocol: `PLAN.md`.

## HA — Análise (onda em curso)

| Fase | Artefato | Resultado |
|---|---|---|
| 0 Pré-voo | `INTAKE.md` | `git fetch --prune`; `master` limpa; 0 PR aberta; `heavy-run --check` `normal` (load1 1,28; 6 núcleos físicos) |
| 0 Linha de base | log em `$TMPDIR/hygiene-20261113/` (não versionado) | ver abaixo |
| 1 Inventário | `INVENTORY.md` | 3 exploradores Sonnet em paralelo, somente leitura |
| 2 Grafo | `docs/hygiene/20261113/reference-graph.{mjs,config.json,json}` | commits `ae717dc0`, `ddde51e9` (rodada 1), `256426b5` (rodada 2); determinístico (sha256 `f39e0c1c…` em 2 execuções) |
| 3 Classificação | `CLASSIFICATION.md`, `REMOVAL-SET.txt`, `REVIEW-HA.md`, `OWNER-GATES.md` | 145 ANDAIME (562188 B), 0 DUPLICADO, 10 OWNER-GATES; revisão cega aprovada com ressalvas, ressalvas aplicadas |
| 4 Plano | `PLAN.md` | ondas HA–HE |

### Linha de base da suíte completa (fatos de ferramenta)

1. `heavy-run --mem 4G -- npm test` saiu com **exit 1** na cadeia `&&`, no passo `test:capability-intake-guard`: `✖ unclosed destructuring heads at 1 MB stay under 200 ms (1172.570219ms)`. É o teste de desempenho relativo que falha sob carga (OG-17, já registrado). A máquina estava com 3 exploradores em paralelo. O mesmo teste, rodado isolado (`--test-name-pattern`), deu `pass 2, fail 0`.
2. `heavy-run --mem 4G -- node .github/scripts/ci-test-shards.mjs run --shards 1 --shard 1` roda todos os itens: **115 pass e 1 FAIL**. O item que falhou foi `npm run test:kernel-coverage`. A cadeia do kernel parou no meio do primeiro segmento `node --test`, sem nenhum `✖` e sem sumário, e os arquivos dos segmentos que não rodaram apareceram com 0% de cobertura.
3. `heavy-run --mem 8G -- npm run test:kernel-coverage`: **exit 0**, `tests 2466, pass 2466, fail 0`, nenhum `ERROR: Coverage`, `All files` com 97,89% de linhas e 93,44% de ramos.

Conclusão: a falha do passo 2 vem do teto de 4G do `heavy-run`, que é pequeno demais para o kernel sob c8. Não é regressão: o CI da `master` em `a4fabbd5` está `success` (CI, Core journey e Standalone Smoke). **Decisão (D1):** as suítes completas desta run usam `heavy-run --mem 8G`. Isso não afrouxa nenhum gate: o teto é de recurso do host e nenhum limiar muda.

## Decisões

| ID | Decisão | Motivo |
|---|---|---|
| D1 | Suíte completa com `heavy-run --mem 8G` | O kernel-coverage não cabe em 4G; ver a linha de base |
| D2 | Inventários-instantâneo e `.gitignore`/`.prettierignore` não contam como citação | Mapas de caminho→hash num commit fixo não citam evidência; a lista explícita foi aprovada pelo revisor |
| D3 | `.specs/` da raiz é NECESSÁRIO, não DUPLICADO | 0 de 42 blobs iguais em `.enterprise/.specs`; o `AGENTS.md` §12 a cita |
| D4 | Áreas de evidência ancoradas (`docs/evolution/**`, `docs/v4`, `_graph`) ficam | Mesmo com registros de run e logs tratados como não citantes, a cadeia segue ancorada por citação viva |
| D5 | A HC é um único lote | Os 145 itens são registros de run e uma auditoria pontual da mesma natureza |
