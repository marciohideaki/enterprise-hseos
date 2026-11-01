# STATUS — dev-squad pre-w6-closeout (2026-11-01)

Plano: `PLAN.md`. Commander em Opus; executores e revisores em Sonnet.

## WA — sem gasto

| Task | Escopo | Rodadas | Commit (task) | Revisão |
|---|---|---|---|---|
| A1 | L1 de F08/F18: 17 casos nomeados por requisito e recibo `w3/L1-F08-F18-2026-11.md` | 1 + adendo | `104e2ab1` | rev-a1 PASS-WITH-NOTES → cobertura frouxa (I7, I5), asserts decorativos e contagens corrigidos; reconferência aprovada |
| A2 | L1 de F17: backend efetivo e precedência de credencial ligados ao caminho de produção; declarações versionadas; recibo `w3/L1-F17-2026-11.md` | 2 | `9dba7d03` | rev-a2: as funções só eram chamadas por testes → r1 liga à produção; recusa por chave de ambiente sem documentação → r2 documenta (`v4-migration`, `evolution-matrix`) |
| A3 | Guard do eixo `deterministic` (enum fechado, evidência para promoção nova, legado de 18 famílias fixado) | 0 | `dd7f106b` | rev-a3 PASS-WITH-NOTES |
| A4 | F23: `no-undef`/`no-unreachable` em todos os arquivos do gate c8; sonda por superfície; recibo `w0/F23-EVIDENCE-2026-11.md` | 1 | `404de3e4` | rev-a4: o recibo afirmava lacuna inexistente em `.cjs`/`.mjs` e medição de outro conjunto → corrigido; a medição atual sai da suíte da WA |
| A5 | Dívida 18 fechada no código: piso exato sobre a requisição canônica (12962 schema 1, 15151 schema 2); contagem dupla no `#startStep` corrigida; estouro → `session-budget-exceeded` | 2 | `263e9086` | rev-a5: r1 faixa entre o piso e o primeiro passo admitida e falhando → defeito de contagem dupla corrigido; r2 projeção sem teste e contador abaixo do envelope → corrigidos; reconferência APROVADO |
| A6 | A-20: `w3/TRACE.json` e `w4/TRACE.json` com guard (`test:evolution-trace`) | 1 | `8d902e5d` | rev-a6: teste errado na W4-FR04 e nome de teste conferido por `includes` → corrigido; SHAs alcançáveis a partir da master |
| A7 | Runbook da quarta família no padrão do ADR-0050; binding Gemini L0 (`operational:false`, `authorized:false`) | 0 | `37825ebe` | rev-a7 aprovado; formato do binding fica para a B1 |

### Integração (Commander, `/build/tmp/pre-w6/int-wa`)
- **Conflito de texto** em `test/test-provider-api-adapter.js` (A1 × A2): mantidos os dois lados, 15/15.
- **Conflito de integração** (A2 × A7): o teste de classificação da A2 não conhecia o `gemini-api.example.yaml`. Ele foi classificado como `model_pending`, com a trava "sem declaração ⇒ `operational:false` e `authorized:false`". A mutação que liga `operational` derruba o teste.
- **Hook:** o hook de commit precisa rodar no cgroup por causa do `test-campaign-evidence.js`. O merge da A5 tocou 42 arquivos de teste, acima do teto de 40 do hook leve, e por isso foi commitado com `HSEOS_HOOK_MODE=full`.
- **Neutralidade:** o PLAN e o prompt A1 citavam um fornecedor restrito, e o Commander reescreveu os dois. O COMMON ganhou a regra.
- **Pendências da WA:**
  - a medição c8 atual do gate (141 arquivos), que sai da suíte da onda;
  - nota menor da A6: o título citado na W4-FR07 não cobre "resolver dependências".
- 2026-11-01 17:53–18:32Z: suíte da WA na integração `13beca30`.
  - Resultado: exit 0, 4638 testes, 0 falhas; `verify` com 103 itens e 237 arquivos.
  - `test:kernel-coverage` PASS em 1007 s: 141 arquivos no gate, nenhum abaixo de 90/80, "All files" em 97,82/93,43.
  - Matrizes W4 com 20 e W5 com 43 rejeitados.
  - A medição atual foi registrada no recibo da F23, com o segmento do log em `docs/evolution/w0/evidence/f23-2026-11/`.
- 2026-11-01: a sessão foi reiniciada. Os executores B2 e B3 não chegaram a iniciar; a WB é retomada depois do merge da WA.
