# R-A5 - Revisão cética da A5 (dívida 18), commit a0ad76f0

Revisor isolado: reporta, não corrige. Worktree `pw-a5-debt18` limpo antes e depois (nenhum edit, commit, stash ou reset). Scratch em `/build/tmp/rev-a5-tmp`.
Nota de método: a Passagem 1 (cega) foi feita sobre o diff e os testes; o `logs/A5.md` foi lido depois de formar os achados 1 a 5 abaixo, mas antes de fechar a bisseção do achado 3.

## Veredito: APROVADO COM RESSALVAS (nenhum FAIL de gate)

O código cumpre o critério literal ("nenhum `max_tokens` termina em `session-failed:internal_error` por estouro de contexto") e todos os gates passam. Há uma lacuna de produto (R1) e documentação incoerente (R2) que o Commander/owner deve decidir antes de dar a dívida 18 por encerrada.

## Verificações (todas via cg.sh, Node 24, TMPDIR próprio)

| Item | Resultado |
|---|---|
| Bisseção independente (script meu, `admission:false`, sem usar `minimumMaxTokens` para decidir) | Schema 1: menor `max_tokens` que monta a 1a requisição = 12656 = piso declarado. Schema 2: 14845 = piso declarado. `piso-1` vira `session-budget-exceeded` ("required model context exceeds the input budget"). Exatidão confirmada, folga zero. |
| Testes tocados: engineering-task-contract/state/extensions/runtime, engineering-environment/tools/control, agent-context(+authority, media), agent-runtime(+contracts) | 233/233 e 51/51 verdes |
| `ci-test-shards.mjs verify --shards 6` | OK, 102 itens, 235 arquivos de teste |
| eslint (`--max-warnings=0`) nos pacotes/lib/testes tocados; prettier nos 10 arquivos | exit 0 |
| `npm run test:package-surface` | 1/1 |
| Atribuição de IA (mensagem do commit e diff) | nenhuma |
| Referências a `NATIVE_TOOLS_MIN_TOKENS` | nenhuma restante (export removido sem consumidor) |

## Item 1 - piso (a)
Correto e exato. Implementação reutiliza `instructionMessage`/`quotedData` do assembler e `nativeToolDefinitions`/`environmentToolDefinition` (extrações sem mudança de comportamento: os testes de ferramentas passam e o bundle usa a mesma fonte). Laço por número de dígitos é necessário e correto (o critério cita `max_tokens` como texto). Único ramo não coberto: `Number.MAX_SAFE_INTEGER` (linha 308), inalcançável na prática.
Piso subiu 11903 -> 12656 (schema 1) e a folga de 2359 do schema 2 foi absorvida. Procurei consumidores afetados: nenhum perfil, runbook, fixture ou campanha usa `max_tokens` entre 11903 e o novo piso em tarefa de engenharia. Fixtures e templates usam 100000; `test-engineering-task-contract.js:891` usa 10000 (já abaixo de ambos); demais ocorrências de `max_tokens` pequeno são specs genéricos de runtime (1, 100, 1500, 3000, 4096), fora do caminho de admissão de engenharia. Não encontrei consumidor real quebrado.

## Item 2 - rede (b)
Tradução específica ao código `AGENT_CONTEXT_BUDGET_EXCEEDED`; `error_code` já permitido continua prevalecendo no `else`. Mutações no `normalizedFailure` (cópia de `a0ad76f0` em scratch):
- M1, traduzir todo erro com `code` para `budget_exceeded`: **morta** (4 testes falham: três de stream/resume de `test-agent-runtime.js` e "a session that fails for another reason reports session-failed with its error code").
- M2, traduzir qualquer `AGENT_CONTEXT*` (inclui `AGENT_CONTEXT_INVALID`): **sobrevive** (147/147 verdes). Nenhum teste prende que um `ContextAssemblyError` não-orçamentário continua `internal_error`. O código está correto; a lacuna é de teste (severidade baixa). Sugestão: um teste em `test-agent-runtime.js` com `ContextAssemblyError` de código `AGENT_CONTEXT_INVALID` esperando `internal_error`.

## Item 3 / R1 - Achado 1 do executor (primeiro passo): posição
Medi por bisseção o menor `max_tokens` que passa do primeiro passo do modelo: **25618** no schema 1 (piso 12656, lacuna 12962) e **29996** no schema 2 (piso 14845, lacuna 15151). O executor citou só o schema 1. Causa (`runtime.js` ~503-506): `projected = used + requestBytes + reserve`, com `used` já incluindo entrada e reserva da montagem; entrada e reserva são contadas duas vezes.
Posição: cumpre o critério literal (não é `internal_error`, é explícito), mas **não cumpre o espírito** "ou recusa na admissão com causa explícita, ou a sessão roda": numa faixa de 12,9k a 15,2k tokens a tarefa é admitida, cria estado e termina em `session-budget-exceeded` já no primeiro passo, sem poder rodar. Pior, a mensagem de admissão e o `v4-migration.md` mandam "levantar `max_tokens` ao menos ao mínimo reportado", o que leva o operador direto para essa falha. A mudança não piorou nada (já era assim), mas o rótulo "piso exato" é enganoso. Recomendação: o Commander escolhe entre (i) incluir a projeção do primeiro passo no piso de admissão (ou corrigir a dupla contagem, mudança de kernel, exige decisão e teste próprios) ou (ii) aceitar e documentar a faixa explicitamente, registrando-a como dívida aberta no MAPA. Hoje nem o MAPA nem os docs a mencionam.

## R2 - Docs incoerentes (corrigir antes do merge)
1. `docs/engineering-task-contract.md:83-94` não foi tocado e descreve o piso antigo: "what the context assembler certainly counts", "native tool schemas of a schema 1 task (1853, measured)", "floor 3712 for `addition.json`" (agora 4461) e "used to end in internal_error".
2. `docs/v4-migration.md:207-211` mantém "The minimum is a lower bound, not a guarantee... Measured margins above the minimum: 752 to 753 ... 2359", que contradiz o parágrafo novo ("the minimum is exact"). Também afirma "Later requests must also fit", o que é verdade, mas o texto precisa reconciliar com R1.
3. MAPA e código `ENGINEERING_MAX_TOKENS_BELOW_FLOOR` estão coerentes (12656/14845, 4461).

## Item 4 - cobertura
Ambos os arquivos estão no `.c8-kernel.json` (gate 90 linhas / 80 branches, `per-file`). Com a seleção que os exercita (21 arquivos de teste: agent-context*, agent-runtime*, compaction, engineering-task-*, engineering-environment/tools/control/project/model/plugin-model/workflow-runtime, environment-production-host/callers, mcp-environment-host; 469/469 verdes), medi c8 com `--check-coverage=false`:

| Arquivo | Linhas | Branches |
|---|---|---|
| packages/agent-context/context-assembler.js | 96,59 | 92,48 |
| tools/cli/lib/engineering-task-extensions.js | 100 | 95,51 |
| tools/cli/lib/engineering-task-contract.js | 99,83 | 97,98 |
| tools/cli/lib/engineering-tools.js | 98,19 | 86,59 |
| tools/cli/lib/engineering-task-runtime.js | 95,98 | 91,62 |
| packages/agent-runtime/runtime.js | 91,25 (e 93,63 em outro runtime.js do conjunto) | 84,61 |

Nenhum abaixo de 90/80. Os 85,33/73,62 do executor eram artefato do subconjunto. Sem FAIL.

## Item 5 - Achado 3 (fragilidade do teste de ledger)
Pré-existente. Na base `7cf336b7` o mesmo teste já usa `newestStateDirectory` filtrando `hseos-ledger-fixture-` no `os.tmpdir()` (linha 892/895/913 da base); o commit A5 não o toca. Com TMPDIR isolado passa (51/51). Fragilidade de teste sob execução concorrente, não introduzida pela A5; vale um ticket separado.

## Resumo de achados
- R1 (média, decisão do Commander/owner): faixa admitida mas sem execução, 12656-25617 (schema 1) e 14845-29995 (schema 2), por dupla contagem no `#startStep`; não documentada.
- R2 (média, corrigir): docs `engineering-task-contract.md` e `v4-migration.md` contradizem o piso exato.
- R3 (baixa): mutante "qualquer AGENT_CONTEXT*" sobrevive; falta teste de especificidade.
- R4 (baixa): `Number.MAX_SAFE_INTEGER` do laço de dígitos sem cobertura.

---

# Reconferência rodada 1 (c1b33918, amend do a0ad76f0)

## Veredito: APROVADO COM RESSALVAS (sem FAIL: não encontrei caminho de excesso real). Uma ressalva exige teste novo (R5).

## 1. Integridade do orçamento em `#startStep`
Raciocínio, conferido no código (`token-counter.js:77-117`, `context-assembler.js:155-158`):
- Antes de existir passo, o accounting da sessão reserva o turno por `turn.budget.input_tokens + reserved_output_tokens` (ramo `else if (turn.budget)`). O assembler admite com `restante = max_tokens - accounting(excluindo este turno)`, logo `input + reserva <= restante`.
- Novo primeiro passo: `used = accounting(excluindo este turno)` + `turn.budget.input_tokens` + `reserva` = exatamente o que o assembler admitiu. A reserva entra uma vez (não zero, não duas); `reconciliation_reserved_tokens` continua em `used` (o `excluded_turn_id` só pula o turno).
- Passos seguintes (continuação de ferramenta, revisão/correção) têm `index > 0` e seguem a fórmula antiga conservadora (accounting inteiro + bytes da requisição inteira + reserva). Turno sem `turn.budget` (legado) também cai na fórmula antiga. Replay/retomada reabrem o mesmo `stepId`; o primeiro passo reprojeta com o estado atual dos outros turnos.
- Nuance, não excesso: a figura do assembler conta mensagens, ferramentas e parâmetros em separado (4464 no schema 1, 6653 no schema 2); o JSON canônico do envelope `{messages,tools,parameters}` tem 36 bytes a mais e a requisição inteira (com ids) ~306 a mais. No piso exato, se o provedor não reportasse `usage`, o accounting estimado do passo (requisição inteira + reserva) passaria de `max_tokens` em ~306 e o resultado sairia marcado `over_budget` (mecanismo já existente em `overBudgetEvidence`). Medi no piso com `usage` reportado: schema 2 completa sem flag; schema 1 abre o primeiro passo e para no segundo. Os bytes de metadados não vão ao modelo; é artefato do contador conservador, mas fica registrado.
- **Mutação "projetar o primeiro passo como zero"** (`firstOfTurn ? 0 : ...`): **nenhum teste cai** (139/139 em agent-runtime + engineering-task-runtime + contract). Também sobrevivem "sem reserva", "sem entrada" e "sem outros turnos" (79/79). Motivo: no caminho normal o assembler já impõe a mesma desigualdade, então a projeção é rede de segurança sem teste que a force (por exemplo, retomada com outros turnos que cresceram, ou reserva de reconciliação mudando entre montagem e abertura). **R5 (média):** falta um teste de `#startStep` com estado alterado entre a montagem e a abertura do primeiro passo, esperando `budget_exceeded`.

## 2. R1 (bisseção, dois schemas) e correção
- Abaixo do piso: `piso-1` recusa na admissão (`ENGINEERING_MAX_TOKENS_BELOW_FLOOR` com o mínimo certo; sem admissão, `session-budget-exceeded` "required model context exceeds"). No piso: schema 2 completa (`criteria-satisfied`) em piso, +1, +300 e +400, sem flag de over-budget; schema 1 abre o primeiro passo (usage registrado) e termina em `session-budget-exceeded` só no segundo passo. A faixa 12,9k a 15,2k sem execução do achado R1 anterior sumiu.
- Posição sobre a correção: é limite legítimo de runtime, não violação do "recusa ou roda". O critério do owner trata do primeiro passo (a tarefa nunca chega a rodar). Uma correção reenvia o contexto crescido (mensagens + feedback) mais nova reserva; exigir isso na admissão obrigaria a prever quantas rodadas o modelo vai usar, o que não é determinável e tornaria o piso dependente de `max_failed_corrections` e do comportamento do modelo. O comportamento é explícito (`session-budget-exceeded` com números, nunca `internal_error`) e agora está declarado nos dois docs ("later steps ... need more, as a correction round does"). Ressalva menor: a mensagem de admissão diz "holds the first model request"; está correta, mas quem usa `max_failed_corrections>0` deve ler a nota do doc.

## 3. R2
Coerente: `engineering-task-contract.md` (piso 4461, medição por bisseção, passos posteriores) e `v4-migration.md` ("exato para o primeiro passo", sem "lower bound"/752/2359). MAPA já estava coerente. Sem referências residuais a 1853/3712.

## 4. R3
Fechado: quatro testes novos em `test-agent-runtime.js` fixam `AGENT_CONTEXT_BUDGET_EXCEEDED` -> `budget_exceeded` e `AGENT_CONTEXT_INVALID`, `AGENT_CONTEXT_BUDGET_COUNTER_CHANGED` (prefixo parecido) e `AGENT_CONTEXT_COUNTER_FAILED` -> `internal_error`. O mutante `startsWith('AGENT_CONTEXT')` deve cair por construção (o teste de `AGENT_CONTEXT_INVALID` espera `internal_error`); não o reexecutei porque o commit passou a testar exatamente essa classe, e o mutante "traduzir todo erro" já morria antes. Não verificado por execução nesta rodada.

## 5. R4
`for (let digits = 1; ; digits += 1)` sempre termina: a entrada cresce linearmente com o número de dígitos (alguns bytes por dígito, contrato <= 1 MiB), `10**digits` cresce exponencialmente e vira `Infinity` em 309, onde `needed < Infinity` retorna. Não há caminho com `NaN` na reserva: `effectiveOutputReserve` usa `cap || 8192` e `requireContextFloor` usa 1 ou o resultado dessa função. Não pendura.

## 6. Execução (cg.sh, TMPDIR próprio, host em modo normal)
- Testes que importam runtime.js, context-assembler.js e engineering-task-*: 237/237 e 51/51 verdes (agent-context*, agent-runtime*, engineering-control/environment/tools/task-*).
- c8 com a seleção de 21 arquivos (473/473 verdes): context-assembler 96,59/92,48; engineering-task-extensions 100/95,51; engineering-task-contract 100/97,98; engineering-tools 98,19/86,59; engineering-task-runtime 95,98/91,62; agent-runtime/runtime.js 91,28/84,87. Todos acima de 90/80.
- `check-w4-mutations.js`: 20 rejeitados, 0 falhas, 0 ignorados.
- `ci-test-shards verify --shards 6`: OK, 102 itens. eslint (`--max-warnings=0`) e prettier: exit 0. package-surface: 1/1.
- Worktree intocado; sem atribuição de IA.

## Achados da rodada
- R5 (média, exige teste): mutantes da projeção do primeiro passo sobrevivem; a rede de `#startStep` não está presa por teste.
- R6 (baixa, informativa): contador do assembler vs requisição inteira difere (36 bytes de envelope, ~306 com metadados); no piso exato sem `usage` do provedor a sessão sairia `over_budget` no evidence.
- R3 só verificado por leitura de testes, não por execução do mutante.

---

# Reconferência rodada 2 (263e9086, amend do c1b33918)

## Veredito: APROVADO. Sem FAIL e sem ressalva aberta; uma observação informativa (fonte desconhecida).

## 1. R6 - piso com envelope (12962 schema 1, 15151 schema 2)
- Bisseção independente (admissão ligada, modelo scripted): `piso-1` é recusado com `ENGINEERING_MAX_TOKENS_BELOW_FLOOR` e o mínimo certo (12961 vs 12962; 15150 vs 15151). No piso e em piso+1 o primeiro passo roda. Medi `canonicalJson(request real) + reserva` (a conta que a sessão faz sem `usage`): 12962 e 15151, iguais ao piso, então `over_budget` não pode ocorrer no primeiro passo. Schema 2 completa (`criteria-satisfied`, sem flag). Schema 1 abre o primeiro passo e para num passo posterior (correção), como já documentado.
- Comprimentos dos ids: conferidos no runtime (`session:${randomUUID()}`, `turn:${randomUUID()}`, `stableId` = 40 hex; correções criam turnos com o mesmo tamanho).
- **Fonte desconhecida (nomes mais curtos):** só é usada em `validate-task` (não executa) e nas pré-leituras estruturais (`agent run` sem modelo; `parseCreationInput` do controle para `binding_id`/`plugin_model`). Nenhum caminho que cria sessão fica só com esse piso: `agent run` repete a leitura com `outputCap` e `model` do binding, scripted usa `SCRIPTED_MODEL`, e a API de controle chama `requireContextFloor` com `provider_id`/`model` do binding ou do pin do plugin em `admitCreation` antes de qualquer execução (jobs e recuperação usam `admission:false` depois dessa admissão). `runEngineeringTask` com plugin model só chega pelo controle (já admitido). Não achei consumidor real que seja admitido apenas com nomes mínimos. Observação baixa: se um novo chamador surgir com plugin model fora do controle, ele herdaria a subestimativa; hoje não existe.

## 2. R5 - mutantes da projeção (copia de 263e9086, 4 executados)
projeção do primeiro passo = 0: morto (4 falhas, os dois testes de banda "no max_tokens near the floor"); sem reserva: morto (4); contagem dupla (`tokenUsage` no primeiro passo): morto (4); sem outros turnos: morto (1, "the first step is projected component by component"). Todos caem; R5 fechado.

## 3. test-v4-lazy-cli
Passa (dentro do lote de 265 testes verdes, junto com plugin-model e control). O módulo `engineering-task-extensions` agora é carregado só quando o contrato declara capacidades (`requestTools` faz `require` condicional), e `validate-task` continua sem carregar integrações opcionais.

## 4. Execução (cg.sh, TMPDIR próprio)
Testes: 265/265 e 51/51. c8 do gate, 475/475 verdes: context-assembler 96,59/92,48; engineering-task-contract 100/98,02; engineering-task-extensions 100/95,51; engineering-task-runtime 95,99/91,66; engineering-control 97,61/89,17; engineering-tools 98,19/86,59; agent-runtime/runtime.js 91,28/85,12. `check-w4-mutations`: 20 rejeitados, 0 falhas. `verify --shards 6`: OK, 102 itens. eslint e prettier nos 12 arquivos JS alterados: exit 0. package-surface verde. Sem atribuição de IA no commit.
