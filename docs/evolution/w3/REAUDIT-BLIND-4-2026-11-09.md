# Reauditoria cega 4 da F14 v3 (execução 3), 2026-11-09

**Veredito: a promoção NÃO é aprovada. `real_consumers` da F14 permanece `not_verified`. Item BLOCKED.**

Escopo: a regra de status vinculante da T4 (`docs/evolution/w3/stab2/T4.md`, "Regra de status") exige, juntos, recibo L2 completo, prova de credencial vinda do adapter, custo conferido na console, reauditoria em duas passagens e decisão do owner. Esta reauditoria é feita sobre o recibo `F14-V3-2026-11.md` e a evidência `evidence/stab3-f14v3/real-attempt3/`, contra o ADR-0050 (L2). Nenhum arquivo de status foi editado: nem `requirements.json`, nem `STATUS.md`, nem `MAPA.md`. Nenhum valor novo foi criado em `real_consumers`.

Método: revisor isolado (Sonnet), duas passagens. A passagem cega recebeu só o artefato e a pergunta "o que o recibo prova e não prova?". O confronto veio depois, contra as alegações do executor. O revisor reporta e não corrige. O achado MAJOR-1 foi reconferido pelo executor no código e no `campaign.json` (ver abaixo). Os demais achados são do revisor e **não** foram reproduzidos um a um pelo executor, exceto onde dito.

## 1. Passagem cega: o que o recibo prova

- Com o medidor corrigido, a nota promovida chegou ao contexto em 15 de 15 execuções promovidas e em 0 de 15 controles (`replay.note_in_context`, uma fonte `trusted`/`data`); nas promovidas o modelo `gpt-4o-2024-08-06` escreveu a regra arbitrária e passou nos testes protegidos e no verificador do produto. Os 15 controles e os 3 pilotos falharam (0 de 18 sem memória).
- O p estratificado de 5/5 contra 0/5 em 3 tarefas, 2/252³ ≈ 1,25e-7, confere com o `campaign.json`.
- Reproduzido no `campaign.json`: 219 requisições, 462.542 tokens de entrada (339.456 em cache) e 21.440 de saída; 0 ilegíveis; 0 órfãos; `source_db_unchanged` e `replay.ok` verdadeiros nas 33; modelo respondido `gpt-4o-2024-08-06` nas 33; varredura de artefatos limpa em 151 arquivos; custo US$ 1,370755 sem desconto de cache e US$ 0,946435 com 50% de desconto nos tokens em cache.

## 2. Passagem cega: o que o recibo NÃO prova

- **Utilidade em tarefas reais.** A regra é arbitrária e só existe na nota; o desenho mede se a nota chega ao contexto e é usada. O recibo já reconhece a ressalva (linhas 130 e 154).
- **Separar "acertar a regra" de "terminar dentro do limite".** 14 dos 15 controles e os 3 pilotos pararam em `request-cap-reached` (limite de 8 requisições).
- **Que os controles falharam por regra errada.** O dado contraria isso: os controles de `retry` e `priority` deram 0 de 9 e 0 de 8 nos testes protegidos, abaixo da solução ingênua de referência (5 de 9 e 5 de 8, `filter.json`). O controle de `priority` que não bateu o limite (7 requisições) também deu 0 de 8. Isso sugere arquivo incompleto ou quebrado, e não regra errada. Não é decidível a partir do repositório, porque `runs/` e os ledgers não foram copiados. A frase do recibo "os 15 controles escreveram e falharam por erro de regra" vem da revisão da execução 2 e não foi reconferida na execução 3.
- **Generalização.** Um modelo, um provedor, uma chave compartilhada, tarefas do executor, n=5 por tarefa e condição.
- **Independência da prova de backend.** O `model` vem do SSE do próprio servidor.
- **Confirmação limpa do protocolo pré-registrado.** A execução 3 veio depois da correção do medidor e da troca do contrato-base, ambas feitas depois de ver dados da execução 2. O critério estatístico não mudou, mas o desenho mudou.

## 3. Tabela do recibo L2 contra o ADR-0050

| Item exigido | Estado | Evidência |
| --- | --- | --- |
| Credencial efetiva pelo adapter | parcial | `provider_proof.verdict` = `pass` nas 33, com `credential_source: request-header`, `credential_pool: false`, `fallback: false`. Mas em 17 das 33 a prova foi ajustada pelo roteiro antes do veredito (ver seção 4). O recibo não traz a referência da credencial (chave "fornecida pelo operador", fora do `pass`). |
| Assinatura primeiro | ausente | Nada no recibo sobre rota de assinatura avaliada, justificativa da rota por API ou declaração de que token de assinatura não foi reutilizado. |
| Versões observadas | parcial | Modelo datado e origem `https://api.openai.com` observados. Faltam endpoint completo, protocolo e SDK (T4, mapa L2). |
| Cota | ausente | Não sondada e sem exceção auditada do owner. |
| Custo real ≤ teto | ok na aritmética, parcial na conferência | US$ 0,12 + 1,36 + 0,95 ≈ 2,43 ≤ US$ 3,00. A conferência da console foi feita pelo executor com a sessão do owner, e não pelo owner; a chave é compartilhada. |
| Jornada com `tools/call` e aprovação (MRTR) | ausente | Só geração com ferramentas de engenharia do runtime. Não há decisão do owner sobre o ramo "sem superfície" para a F14; a resposta 12 do ADR vale só para a F17. |
| Recuperação com mudança de estado | ausente | Não exercitada nesta campanha. |
| Replay idempotente | parcial | `replay.ok` é a releitura da sessão pelo store, e não um replay sem novo efeito. |
| Drain sem órfãos | parcial | A conta compara `tool.execution.started` com `completed` (0 órfãos nas 33); não há checagem de processos. |
| Varredura de segredos | ok | 151 arquivos limpos. |
| Real × fixture | ok | `evidence_kind: real` em todas as execuções e `database.kind: real`. |
| `does_not_prove` | parcial | A seção do recibo é a do ensaio e está desatualizada: contradiz a execução real (itens 1, 2, 3 e 5). |
| Consumidor sintético excluído | parcial | Tarefas desenhadas pelo executor; a resposta 3 do owner de 2026-11-05 pede uma tarefa real de modelo que leia memória promovida. |
| Validade de 90 dias | ausente | O recibo não registra data de validade. |
| Reauditoria em duas passagens | pendente | Esta é a reauditoria; o confronto está na seção 5. |
| Decisão do owner | pendente | Não registrada. |

## 4. Achado MAJOR-1, reconferido pelo executor: prova do adapter ajustada pelo roteiro

Em `f14v3.cjs` (linhas 355 a 365), quando o guard recusa uma chamada além do limite de requisições, o roteiro reescreve a prova do adapter antes de julgá-la: `requests_total` passa do valor relatado pelo adapter para o número de requisições que o próprio guard contou como feitas, e `backend_verified` é recalculado.

Reconferido no `campaign.json` da execução 3: **17 de 33** registros têm `cap_adjustment` (3 pilotos e 14 controles da série; exemplo: `requests_total_reported: 9`, `requests_made: 8`). O resumidor oficial, sobre a prova original, saiu com `summarizer_exit` 1 nessas 17 (e 0 nas outras 16). O `verdict: pass` publicado nessas 17 vem da prova ajustada. O número `made` é informado pelo guard do roteiro, e não pelo adapter, o que é autoatestação do roteiro, que a regra da T4 diz não contar. O recibo e o README não divulgam o ajuste. A alegação "prova do adapter `pass` nas 33" precisa dessa ressalva: 16 passaram sem ajuste e 17 só depois do ajuste.

## 5. Confronto com as alegações do executor

| # | Alegação | Veredito | Observação |
| --- | --- | --- | --- |
| A1 | `CRITERION MET`, 5/5 contra 0/5, p=1,25e-7, 0 problemas de protocolo, 33 execuções, 219 requisições | confirmada como números | Com as ressalvas da seção 2 e o achado B1 abaixo. |
| A2 | `provider_proof` = `pass` nas 33, com modelo datado e origem corretos | parcial | Verdadeira no resultado publicado; 17 vêm de prova ajustada (seção 4). |
| A3 | Custo ~US$ 0,95 na execução 3; acumulado real ~US$ 2,43 ≤ US$ 3,00 | aritmética confirmada, console não verificada | A leitura da console é do executor e a chave é compartilhada. |
| A4 | Varredura limpa, drain 0 órfãos, replay ok 33/33, `source_db` inalterado | confirmada no que mede | Replay é releitura de sessão; drain é por eventos. |
| A5 | Resultado quase certo por construção; não prova utilidade real | confirmada | Mais forte do que o recibo diz: os controles ficam abaixo da solução ingênua (0/9 e 0/8 contra 5/9 e 5/8). |
| A6 | Mapa L2 do executor | parcialmente confirmada | O revisor discorda em três pontos: credencial é parcial e não ok; custo é ok só na aritmética; drain é parcial. Esta tabela já incorpora isso. |
| A7 | Regra de status da T4 não satisfeita; F14 permanece `not_verified` | confirmada | O próprio recibo (linha 142) reconhece que faltam a reauditoria e a decisão do owner. |

## 6. Inconsistências do recibo

- **B1, sem registro explícito.** A T4 (linha 42) diz "Reprovou: encerra e registra, sem rodada extra". A execução 2 saiu `CRITERION NOT MET` pelo veredito original. O que existe no recibo é a decisão do teto cumulativo de US$ 3,00 (2026-11-08, owner e Commander); não há registro explícito de autorização de uma terceira execução paga depois do reprovado. O atenuante é que a causa foi um defeito do medidor (linha 90), mas o critério foi reaplicado depois de ver os dados, e a ressalva 6 do próprio recibo o admite.
- **MAJOR-3.** O recibo mantém seções do ensaio que contradizem a execução real: cabeçalho "RASCUNHO", "NÃO EXECUTADO", "Nenhum gasto" (linhas 1 a 5); "Resultado real: vazio" (linhas 55 a 61); estimativa de custo do ensaio (linhas 37 a 39); `does_not_prove` itens 1, 2, 3 e 5 (linhas 144 a 150); "cópia do banco é do dia do ensaio" (linha 158).
- **MAJOR-4.** Mudança de contrato (A2) e do medidor depois da execução 2: divulgada, mas a execução 3 não é a execução do protocolo pré-registrado.
- **MINOR.** `campaign.json` carrega o custo estimado pelo roteiro (US$ 1,3708; acumulado US$ 2,87), e não o corrigido pela console (cerca de US$ 0,95 e US$ 2,43). O hash de confirmação da "próxima execução" (linha 100) é agora o da execução 3.

## 7. Veredito e o que falta para destravar

**Não aprovado. Ressalvas impeditivas:**

1. Itens ausentes do L2: assinatura primeiro, cota ou exceção auditada, recuperação com mudança de estado, validade de 90 dias, `tools/call` com aprovação ou decisão do owner sobre o ramo "sem superfície" na F14.
2. Prova do adapter ajustada pelo roteiro em 17 de 33 execuções, sem divulgação (seção 4).
3. Referência da credencial ausente no recibo.
4. Tarefas desenhadas pelo executor, e não pelo owner.
5. Sem registro de autorização da terceira execução paga sob a regra "sem rodada extra" (B1).
6. Controles abaixo da solução ingênua: sem os ledgers, não se descarta que o resultado meça término e não a regra.
7. Conferência da console feita pelo executor, e não pelo owner.
8. Seções de rascunho e `does_not_prove` do recibo a reescrever.
9. Decisão do owner pendente.

Decisões que cabem ao owner, e que este documento não toma: se o ramo "sem superfície" vale para a F14; se tarefas do owner são necessárias antes de promover; se a terceira execução paga é ratificada; e se o ajuste de prova por limite de requisições é aceitável ou exige o adapter contar só o que enviou.

## 8. Limites desta reauditoria

O revisor leu o repositório e o `campaign.json`; não teve acesso a `runs/` nem aos ledgers (não copiados) e não pôde reconferir a console. Os achados fora do MAJOR-1 são do revisor e não foram reproduzidos individualmente pelo executor. Não houve gasto nem chamada externa.

## 9. Decisões do owner depois da reauditoria (2026-11-09)

O owner decidiu quatro pontos (registrados em `ADR-0050`, "Respostas posteriores do owner (2026-11-09)"). Efeito sobre as ressalvas impeditivas da seção 7:

| Ressalva da seção 7 | Estado agora |
| --- | --- |
| 1. Jornada com `tools/call` e MRTR | **Resolvida pela decisão:** o ramo "sem superfície" vale para a F14. Seguem abertos: assinatura primeiro, cota ou exceção auditada, recuperação com mudança de estado e validade de 90 dias. |
| 2. Prova do adapter ajustada pelo roteiro (17 de 33) | **Aceita pelo owner**, só para a execução 3 da F14 v3; o texto da regra da T4 não mudou. |
| 3. Referência da credencial ausente no recibo | Aberta. |
| 4. Tarefas desenhadas pelo executor | **Aberta, e agora exigência do owner:** só promover com tarefas do owner. |
| 5. Terceira execução paga sem registro de autorização | **Ratificada pelo owner.** |
| 6. Controles abaixo da solução ingênua | Aberta. |
| 7. Conferência da console feita pelo executor | Aberta (o owner conferiu o crédito de US$ 3,17 no painel em 2026-11-09, depois da campanha da F15, e não o da F14). |
| 8. Seções de rascunho e `does_not_prove` do recibo | Aberta. |
| 9. Decisão do owner | Dada nos quatro pontos acima; falta o resto. |

**A promoção continua bloqueada.** `real_consumers` da F14 segue `not_verified`: faltam tarefas do owner, os itens abertos do L2 (assinatura primeiro, cota, recuperação, validade de 90 dias), a referência da credencial, o tratamento dos controles com 0 de 8 e 0 de 9, a reescrita do recibo e uma nova reauditoria sobre o material novo. Nenhum arquivo de status foi editado.

