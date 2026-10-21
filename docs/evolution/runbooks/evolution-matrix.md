# Runbook F1 — matriz evolutiva (campanhas comparativas)

Status: **preparação (W7), nada é despachado por este documento.** Execução e dono: W8. Cada campanha exige autorização própria do owner, com binding, teto e validade explícitos (seção 6). Todo número de orçamento abaixo é **PROPOSTO**, não autorizado.

Fonte normativa: `docs/evolution/PLAN.md:86-93` (18 execuções iniciais; depois ≥30 tarefas reservadas, três repetições por configuração elegível; separar comparação do harness e produto completo; ganho exige indicador principal melhor, sem regressão obrigatória, intervalos de confiança agrupados por tarefa; empate ou inconclusivo não é superação) e `docs/evolution/PLAN.md:96-98` (cada marco mantém três estados: determinístico, consumidor real, ativação).

## 1. Escopo e o que está fora

Dentro: definir harness, catálogo de tarefas, métricas, estatística, orçamento proposto e critérios PASS/FAIL da matriz.

Fora, explicitamente:

- Despachar qualquer chamada a modelo, abrir campanha, reservar orçamento ou ler credencial.
- Usar rota paga. Os precedentes da W5 usaram `max_cost_microusd: 0` (`/build/tmp/hseos-w5/live/owner-decision.md`, sem copiar); rota de API paga é decisão separada do owner.
- A 4ª família real (runbook F2, `fourth-family.md`). A matriz só a inclui quando o F2 tiver PASS; até lá ela é "não elegível", não "ausente".
- Reaproveitar a reserva da W4-07b ou qualquer grant histórico da W3 (expirados em 26–27/09/2026, `docs/evolution/w4/STATUS.md:530-531`).
- Publicar, mergear ou ativar. Resultado da matriz é evidência, não decisão de release.

## 2. Harness existente a reaproveitar

Não criar controlador novo. O padrão já existe e foi exercitado na bateria viva da W5 (T2, T3, T4):

| Peça                           | Onde está                                                                                                                                                   | Papel na matriz                                                                                                                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campanha governada             | `providerCampaigns` do `EngineeringControl` (`tools/cli/lib/engineering-control.js:379`); autorização em `tools/cli/lib/provider-campaign-control.js:77-92` | `max_requests`, `max_cost_microusd`, `deadline`, `binding_ids`, `task_ids` (máx. 100), `quota_exceptions` com `expires_at` ≤ `deadline`. Reserva antes do efeito, recibo depois, linhas `opened`/`reserved`/`receipt` no ledger |
| Contrato de tarefa v2 e aceite | `tools/cli/lib/engineering-task-contract.js`, `engineering-project-verifier.js`                                                                             | Verificador fixado fora do controle da tarefa; `pids_peak` na evidência                                                                                                                                                         |
| Jornadas de consumidor real    | `test/journeys/` (`core-journey.mjs`, `mcp-journey.mjs`, `w5-environment-journey.mjs`; descrição em `test/journeys/README.md`)                              | Instalação do tarball fora do checkout; `assertReceipts` (`w5-environment-journey.mjs:308`) valida as linhas do ledger                                                                                                          |
| Testes da campanha             | `test/test-provider-campaign-control.js`                                                                                                                    | Regressão do próprio controle; roda antes de cada campanha                                                                                                                                                                      |
| Padrão de despacho da bateria  | `/build/tmp/hseos-w5/live/` (subpastas `t2`, `t3`, `t4`) (fora do repositório, **não copiar código**)                                                       | Ver abaixo                                                                                                                                                                                                                      |

Padrão do `live-dispatch.mjs` da bateria (descrição, não cópia):

1. **Clone descartável** do alvo, limpo, com dependências; o passo `baseline` exige que o verificador **rejeite** o baseline não corrigido (prova que o teste falha pelo motivo certo).
2. **Pin antes da primeira reserva**: SHA-256 do script verificador, do conjunto de arquivos protegidos (`protected.sha256`) e do `baseline_sha`. Qualquer divergência depois do pin invalida a execução.
3. **Binding inspecionado sem inferência**, depois campanha aberta sob teto (`max_requests`, custo, validade de 45 min, exceção de cota registrada com motivo).
4. **Um despacho governado por vez**: reserva, chamada, recibo; o modelo só devolve texto (o worker da assinatura rejeita eventos que não sejam `message.delta`, ver achado 1 de `/build/tmp/hseos-w5/live/evidence-catalogue.md`). A correção é aplicada pelo harness, não pelo modelo.
5. **Verificador externo** (`verify-*.sh`, modo `tests` e `coverage`) e `assert-receipts.mjs` sobre o diretório da execução.
6. **Recibo** no formato `hseos-live-battery-receipt/v1` (`/build/tmp/hseos-w5/live/receipt-template.json`): `capability_use` com `recorded_by: system|agent_claim_only`, `limit` ("o que isto não prova"), `cost`, `review`, `gates`, `does_not_prove`. Códigos de saída: 0 PASS, 1 FAIL, 3 BLOCKED.

Lacunas conhecidas do harness (a matriz não pode ignorá-las):

- O recibo sob assinatura traz `cost_microusd` nulo: **custo não é medido** na rota de conta (`docs/evolution/w5/STATUS.md:321`). A métrica de custo da matriz precisa de fonte própria (tokens do recibo, tempo de parede) e rotular o que é estimativa.
- A jornada de consumidor real da W5-11b **não roda no CI** e fez 2 de 3 despachos (`docs/evolution/w5/STATUS.md:321`, W5-11b).
- `pids_max=64` foi insuficiente para clientes reais (o cliente `codex` bateu no teto, `docs/evolution/revalidation-2026-10/STATUS.md:105`); o código só aceita 32 a 256; a W5 tornou o campo obrigatório nos adapters de campanha de cliente (commit `35865271`). Configurar o teto por binding antes da matriz.

## 3. Elegibilidade e desenho

**Configuração** = (família, binding, stack, braço). Uma configuração é **elegível** quando:

1. o binding tem campanha real com recibo e recuperação comprovados, e grant vigente (não expirado);
2. identidade, cota e cobrança estão registradas (cota desconhecida só com exceção explícita e limitada do owner, `docs/evolution/w3/BINDINGS.md`);
3. há `pids_max`, memória e prazo declarados e a drenagem do cgroup foi verificada;
4. o verificador da stack existe e rejeita o baseline.

Famílias hoje: Codex (conta), Claude (conta), compatível/ACP e Antigravity local têm evidência histórica na W3 (`docs/evolution/w3/CLOSEOUT.md`); **a elegibilidade precisa ser reconfirmada** porque os grants expiraram. A 4ª família real (Gemini API) só entra após o F2.

**Braços** (PLAN.md:87-89):

- **Harness (comparação controlada):** mesmo modelo, tarefa, ambiente e orçamento sempre que o cliente suportar; muda só o harness (candidato HSEOS vs. referência declarada).
- **Produto completo:** configurações reais de cada produto, diferenças declaradas na tabela de configuração. Não se atribui diferença ao harness neste braço.

**Fase 1, 18 execuções (PROPOSTA de composição):** 2 famílias × 3 tarefas piloto × 3 repetições = 18, uma stack (Node/TypeScript), braço harness. Objetivo: provar o pipeline (pin, recibo, estatística, orçamento), medir variância e custo por execução. **Fase 1 não decide ganho** e as tarefas piloto saem do catálogo (não voltam como reservadas). A composição exata das 18 não está definida em `PLAN.md`; precisa de decisão do owner (seção 10).

**Fase 2, ≥30 tarefas reservadas:** por configuração elegível, ≥30 tarefas × 3 repetições. Duas famílias e duas stacks quando elegíveis (proposta: Node/TypeScript e Python; stacks como no registro protegido da W1). Se só uma stack ou família for elegível, a matriz roda assim e declara a lacuna; não se completa com fixture.

## 4. Catálogo de tarefas (proposto)

Formato de cada tarefa: repositório e `baseline_sha`, descrição do defeito ou feature, critérios de aceite, verificador (script + testes ocultos), arquivos graváveis e somente leitura, `max_requests` esperado, estrato (tamanho, stack, tipo), hash do conjunto.

Critérios de inclusão:

- Resolúvel por tarefa delimitada, com verificador determinístico externo, **rejeitando o baseline** e aprovando a referência humana.
- Sem rede, sem segredo, sem dependência de relógio; execução cabe no cgroup (pids, memória, prazo).
- Tamanho que caiba na janela do binding (a campanha limita tokens de entrada/saída e `max_duration_ms`; ver parâmetros em `provider-campaign-control.js`).
- Estratos balanceados: correção de defeito, feature pequena, refatoração coberta por teste, tarefa com teste ausente (aceite fraco é recusado desde a W5-10b, `ENGINEERING_ACCEPTANCE_WEAK`).
- Consumidores sintéticos são rotulados `is_synthetic: true` com motivo (precedente W5-11b, consumidor B).

Tarefas reservadas e contaminação:

1. **Congelar antes de rodar**: publicar só o hash do catálogo (SHA-256 do conjunto de tarefas + verificadores) em um commit; o conteúdo reservado fica fora do repositório publicado e fora do contexto de qualquer agente que desenvolva o harness.
2. **Origem**: tarefas novas, escritas pelo owner/equipe, ou derivadas de commits posteriores ao corte de conhecimento dos modelos avaliados (o corte do modelo deve estar registrado por binding); nunca de issues públicas conhecidas.
3. **Separação**: tarefas de desenvolvimento do harness (usadas para ajustar prompt, limites, correções) são disjuntas das reservadas; reservada usada para depuração é **queimada** e sai da análise.
4. **Verificador oculto**: o modelo não vê o verificador nem os testes de aceite; arquivos protegidos entram no pin (`protected.sha256`) e o workspace da tarefa não os contém graváveis.
5. **Sem retry seletivo**: as 3 repetições são pré-registradas; não se descarta repetição por resultado. Execução BLOCKED/incerta conta como falha na análise de intenção de tratar, e é reportada à parte.
6. Revisão cética isolada de cada tarefa do catálogo (duas passagens, `AGENTS.md` global §3h) antes do congelamento.

## 5. Métricas e estatística

**Indicador principal (proposto):** taxa de tarefas resolvidas com **aceite aprovado pelo verificador externo**, por tarefa (fração das 3 repetições aprovadas). A escolha é do owner; ela precisa ser fixada **antes** da fase 2.

**Regressões obrigatórias (guarda, não indicador):** defeitos/aprovações incorretas (aceite do verificador vs. revisão cética), órfãos/descendentes não drenados, repetição de efeito, incerteza não reconciliada, violações de escopo/segredo/rede. Qualquer ocorrência de classe crítica reprova a configuração, independentemente do indicador principal.

**Secundárias** (PLAN.md:89-92): intervenção humana, latência (parede) e recursos (`pids_peak`, memória), consumo (tokens; custo só quando medido), custo de carregamento, acoplamento/isolamento/compatibilidade, recuperação/cancelamento, tempo e rastreabilidade da revisão.

**Unidade de análise = tarefa, não execução.** As 3 repetições da mesma tarefa são correlacionadas; tratá-las como independentes subestima o intervalo.

Procedimento:

1. Para cada tarefa `i` e braço `a`, calcular `p_ia` = média do indicador nas 3 repetições.
2. Diferença pareada por tarefa: `d_i = p_i,candidato − p_i,referência`.
3. Estimativa: média dos `d_i`.
4. **IC 95% agrupado por tarefa**: bootstrap percentil reamostrando **tarefas** (10 000 réplicas, semente fixa registrada no recibo), mantendo as repetições da tarefa juntas. Conferência cruzada: intervalo t sobre os `d_i` (n−1 g.l.) ou erro-padrão robusto agrupado por tarefa; divergência material entre os dois é registrada e a decisão usa o mais conservador.
5. Secundárias contínuas (latência, tokens): mediana dos pareamentos por tarefa e o mesmo bootstrap; reportar a razão e o IC, não só p-valor.
6. Regressão obrigatória: **não inferioridade** com margem `δ` fixada pelo owner antes da fase 2; o limite inferior do IC da diferença deve ficar acima de `−δ`.
7. Comparações múltiplas (famílias × stacks): o indicador principal é uma única hipótese pré-registrada; subgrupos são exploratórios e rotulados assim.
8. Poder: com ≥30 tarefas e 3 repetições, calcular na fase 1 a variância intra e entre tarefas e registrar o menor efeito detectável; se o IC não excluir zero, o resultado é **inconclusivo**.

Reavaliação periódica com versões fixadas: a cada versão de cliente, modelo ou harness, repetir um subconjunto reservado não queimado; registrar versões (cliente, modelo, SDK, kernel `hseos`), `binding_sha256` e `baseline_sha` no recibo.

## 6. Orçamento PROPOSTO por campanha

**Nada abaixo está autorizado.** O owner decide valores, validade e binding; a autorização é materializada em `max_requests`, `max_cost_microusd`, `deadline`, `binding_ids`, `task_ids`, `quota_exceptions` (`provider-campaign-control.js:77-92`).

Regras da proposta:

- **Uma campanha por (binding, stack, fase)**; `task_ids` ≤ 100 por campanha; sem reaproveitar saldo entre campanhas sem nova confirmação (precedente W5).
- **`max_cost_microusd: 0`** nas rotas de assinatura (sem créditos pagos); rota paga só com teto próprio, e o custo medido vira métrica. Nunca converter percentual de cota em contagem inventada (`docs/evolution/w3/STATUS.md`, cota desconhecida).
- **Validade curta**: cada campanha expira em até 45 min (precedente da bateria) ou em janela explícita; a matriz é fatiada em campanhas dessa duração.
- **Exceção de cota**: motivo registrado citando a decisão do owner, `expires_at` ≤ `deadline`.
- Uma única binding por campanha; sem pool de identidades, sem fallback de credencial.

| Fase | Campanha                         | Execuções                          | `max_requests` proposto | `max_cost_microusd`            | Escopo                          | Validade                    |
| ---- | -------------------------------- | ---------------------------------- | ----------------------- | ------------------------------ | ------------------------------- | --------------------------- |
| 1    | piloto, por família              | 9 por família (3 tarefas × 3 rep.) | 9 × R + reserva de 10%  | 0 (assinatura)                 | 3 tarefas piloto, stack Node/TS | 1 janela de 45 min por lote |
| 2    | reservadas, por (família, stack) | ≥90 (≥30 tarefas × 3 rep.)         | 90 × R + reserva de 10% | 0 ou teto próprio da rota paga | ≥30 tarefas reservadas          | fatiada em lotes de 45 min  |

`R` = requisições por execução, medido na fase 1 (a bateria W5 usou 2–3 por tarefa, `owner-decision.md`; **estimativa, não garantia**). A tabela é calculada depois da fase 1; antes disso não há número para autorizar. Total da fase 2 = Σ por (família, stack) elegível, p.ex. 2 famílias × 2 stacks = 4 campanhas-base, cada uma em vários lotes. Se uma rota paga entrar, o teto de custo é por campanha e o excedente interrompe o lote (BLOCKED).

## 7. Passos de execução (W8, cada um sob autorização)

1. Pré-condições: `uptime` e `heavy-run --check` (global §3f); um job pesado por vez; execuções sob `/build/tmp/hseos-w5/bin/run-in-cgroup.sh`; nada em `/tmp` literal.
2. Congelar catálogo e hash; registrar versões; revisão cética do catálogo.
3. Fase 1: abrir a campanha piloto (com autorização), rodar as 18 execuções, produzir recibos, estatística piloto, `R` e variância.
4. Gate de decisão: owner confirma indicador principal, `δ`, composição da fase 2 e orçamento.
5. Fase 2 por lotes, uma campanha por vez; `assertReceipts` após cada lote; recibo por execução e consolidado.
6. Análise (seção 5), revisão cética em duas passagens do relatório, publicação interna do resultado com `does_not_prove`.

## 8. Critérios de PASS / FAIL

PASS da **matriz** (processo): todas as execuções têm recibo do sistema; pin íntegro; nenhuma execução apagada; IC calculado por tarefa; versões fixadas; custo rotulado como medido ou estimado; zero violação de classe crítica.

Veredito por configuração:

- **Ganho comprovado:** limite inferior do IC da diferença do indicador principal > 0 **e** todas as regressões obrigatórias dentro de `−δ` **e** zero violação crítica.
- **Empate / inconclusivo:** IC contém 0 ou margem de poder insuficiente. **Não é superação.**
- **Regressão:** IC do indicador principal inteiramente < 0 ou não inferioridade violada: FAIL da configuração.
- **BLOCKED:** execução sem recibo, binding sem grant vigente, cota desconhecida sem exceção, capacidade do host: reportado como BLOCKED com a causa, **nunca convertido em PASS**; não afrouxar gate, limite ou verificador para passar.

Rodadas de correção do harness durante a matriz: no máximo 3 por entrega; depois, mudar de estratégia e registrar (`AGENTS.md` global §3h).

## 9. Riscos

- Grants expirados: reabrir exige nova autorização; não existe saldo da W3/W4 reutilizável.
- Custo não medido sob assinatura: comparação de custo entre braços fica qualitativa até haver fonte.
- Variância do cliente (limite de threads/EAGAIN visto no Codex, `docs/evolution/w3/LIVE-CAMPAIGN-10USD.md`): reduzir via `pids_max` por binding e registrar como configuração, não ajustar por tarefa.
- Contaminação: tarefa reservada vazada ou queimada invalida o catálogo; manter a lista de queimadas.
- CI não roda a jornada real: a matriz é execução local sob cgroup delegado, sem prova de portabilidade (Node 22/24, macOS/Windows não cobertos).
- Carga do host: o fan-out de lotes não pode empilhar (global §3f).

## 10. Decisões que cabem ao owner

1. Composição exata das 18 execuções (a proposta acima é uma leitura de `PLAN.md:86`).
2. Indicador principal e margem de não inferioridade `δ`.
3. Stacks elegíveis da fase 2 e se a rota paga entra (teto em USD).
4. Orçamento por campanha (valores só após a fase 1), validade e binding.
5. Fonte do catálogo reservado (tarefas escritas pelo owner vs. derivadas) e quem guarda o conteúdo congelado.
6. Se a 4ª família espera o F2 ou a matriz roda sem ela, com a lacuna declarada.
