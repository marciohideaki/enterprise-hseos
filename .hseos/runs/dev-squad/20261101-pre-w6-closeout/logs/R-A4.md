# R-A4 — revisão cética da A4 (F23, commit 65b7d731)

Veredito: APROVADO COM RESSALVAS (código e teste corretos; o recibo tem duas alegações que vão além da evidência e devem ser corrigidas antes da promoção da F23).

## Passagem 1 (cega)
1. Escopo do lint: OK. O diff só adiciona `...kernelSurfaces` ao bloco de regras do kernel. Nenhuma regra antiga foi afrouxada, nenhum global novo foi declarado, o lint dos 141 arquivos passa com exit 0 sem alterar código. Os 84 arquivos de `tools/` do gate estavam limpos.
2. Sonda: OK. Cobre packages/tools (.js), .agents/.enterprise (.cjs) e docs (.mjs), com `missingKernelAuthority();` lintado no caminho real; exige severidade 2 nas duas regras em todos os 141 arquivos e `.js/.cjs/.mjs` + `tools/` ao menos uma vez.
3. Recibo: ver achados.
4. Mutações (cópia descartável, removida):
   - (a) tirar `tools` da sonda: pass 11 / fail 1 (cai a asserção final de `tools/`). Derruba.
   - (b) desligar `no-undef` só para `.cjs`: a forma "tirar .cjs do bloco do kernel" NÃO derruba (pass 12), porque os `.cjs`/`.mjs` fora de packages/tools já tinham `no-undef` pela base `js.recommended`. Com `no-undef: off` explícito para `**/*.cjs`: pass 11 / fail 1. Derruba.
5. Execução: test-kernel-quality-surface 12/12; eslint do kernel + config + teste exit 0; prettier (config, teste, recibo) ok; `verify --shards 6` OK (102 itens, 235 arquivos); neutralidade 2/2. Sem atribuição de IA no commit.

## Achados
- A1 (média) Alegação falsa no recibo, seção 3: "os dois `.cjs` de hooks e o `.mjs` de `docs/` estavam no gate sem a regra ativa". Medido na base 7cf336b7 com `calculateConfigForFile`: `.agents/...liveness-guard.cjs`, `.enterprise/...liveness-guard.cjs` e `docs/evolution/w5/liveness-idle-metric.mjs` já tinham `no-undef`/`no-unreachable` = error. A lacuna real era só os 84 `.js` de `tools/`. A sonda `.cjs/.mjs` é regressão preventiva, não correção.
- A2 (média) Conjunto medido vs conjunto atual: o recibo apresenta 102 entradas/141 arquivos como "o conjunto do gate" e ancora 96,86/90,26 em `1ae317c0`. Naquela cabeça o `include` tinha 41 entradas (log: 73 arquivos). As 61 entradas adicionadas depois (W5: ledger, adaptadores MCP, memória, environment, liveness, coordenação) não foram medidas por esse log. O recibo diz que "o gate segue medido pela cabeça 1ae317c0", o que sugere cobertura 90/80 comprovada para 141 arquivos. Deve declarar que a medição cobre só o conjunto antigo e que o conjunto atual está sem medição verde registrada.
- A3 (baixa) O sha256 `6d2ff28f...` do recibo é do log descompactado (confere com `zcat | sha256sum`); o `.gz` em disco tem outro hash. Citar "descompactado".
- A4 (baixa) Os números do log existem (All files 96,86 / 90,26) e a honestidade sobre os 231 arquivos de `tools/` fora do gate e sobre a ausência de log de 2026-11-01 está correta. `engineering-model.js`/`plugin.js` (80,95/81,01) vêm de CONFORMIDADE-W0-W5.md de 2026-10-27, não do log de 1ae317c0; ok, mas a fonte distinta fica implícita.

## Passagem 2 (confronto com logs/A4.md)
- Confirmado: vermelho 11/1 e verde 12/0, W4 20 / W5 43, shards, package-surface, lint 141, 231 fora, requirements.json intocado, medição de 2026-11-01 sem artefato.
- Refutado/omitido: o log não menciona A1 nem A2; o executor não verificou que `.cjs/.mjs` já estavam cobertos e não comparou o `include` de 1ae317c0 com o atual. Mutação do executor (remover `kernelSurfaces`) vale, mas só prova o caso `tools/`.
- Não reexecutei W4/W5 mutations nem package-surface (aceitos pelo log; shards e testes de superfície reexecutados).

## Reconferência rodada 1 (404de3e4)
Veredito: APROVADO. A1, A2 e A3 corrigidos; A4 (baixa) segue como nota.
- A1: §3 declara a lacuna real como só os 84 `.js` de `tools/` e os `.cjs`/`.mjs` como já protegidos pela base; o teste deles é regressão.
- A2: medição de 1ae317c0 marcada como histórica, 41 entradas / 73 arquivos (conferido no `.c8-kernel.json` daquela cabeça e no log); seção "Medição atual" com `PENDENTE-COMMANDER`, sem números inventados.
- A3: ambos os hashes conferem (6d2ff28f... descompactado; 8f0df789... do .gz).
- Escopo: `diff 65b7d731 404de3e4 --stat` altera só o recibo (11+/4-). Sem atribuição de IA. Prettier e neutralidade (2/2) passam.
