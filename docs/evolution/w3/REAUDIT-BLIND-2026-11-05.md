# Reauditoria cega de F14, F15 e F17, 2026-11-05

Escopo: três auditores isolados e independentes (um por família), sem acesso às conclusões do executor, receberam só os critérios (`requirements.json`, ADR-0050) e os caminhos da evidência, com ordem de derivar o veredito dos arquivos brutos e de não confiar nos rótulos dos recibos. É a passagem cega; a passagem de confronto fica com o Commander. O owner decidiu não criar valor novo no enum de `real_consumers`. Este documento não altera `requirements.json`.

**Resultado: nenhum status muda. F14 `real_consumers`, F15 `real_consumers` e F17 `deterministic` ficam como estão.**

| Família | Eixo             | Veredito                            | Razão decisiva                                                                                                                                                                                                                                                                     |
| ------- | ---------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F14     | `real_consumers` | manter `not_verified`               | O consumidor segue sendo um roteiro escrito para o teste, com o contrato adaptado para induzir a leitura da memória (consumidor sintético, ADR-0050 §5.2). Trocar o provider scriptado por modelo real não muda isso                                                               |
| F15     | `real_consumers` | manter `not_verified`               | O gatilho literal do ADR (retomada de `fork` aprovada com modelo real) foi satisfeito na run5, mas o cenário combinado de F15-R1 não foi demonstrado: o checkpoint do `fork` (sequência 58) é anterior à compactação (62), e a comparação com o histórico integral não é auditável |
| F17     | `deterministic`  | manter `not_verified_for_evolution` | O ADR-0050 §2 exige todos os bindings em L1. Não existe binding local declarado, e a composição ACP tool-free de terceiro segue sem backend efetivo provado (C4 BLOCKED)                                                                                                           |

## Achados que o executor aceita e corrigiu nos recibos

- F14: a prova da promoção pelo owner não foi arquivada (o `project.db` da caixa foi apagado). O recibo agora declara isso. Também declara que a memória entrou por montagem de contexto do host (sem `memory.retrieve`) e que o controle é pouco informativo.
- F17: a causa do `session-budget-exceeded` estava atribuída à janela de 8192 sem prova (o total reportado foi 6.320). O recibo agora diz que a causa não foi estabelecida. A captura bruta do backend foi anexada.
- F15: o recibo é o de `F15-FORK-REPEAT-2026-11.md`, já mesclado. Os achados abaixo ficam registrados aqui.

## Achados do F15 (recibo já mesclado)

1. O `fork` sai de um checkpoint anterior à compactação; a prova do `fork` não cobre a compactação preservada nele.
2. `artifacts_equal` compara `JSON.stringify` de artefatos entre sessões diferentes (`orchestrate.cjs`), oscila entre as execuções e o roteiro não grava os valores comparados.
3. `single_compaction: false` e duas escritas na execução compactada contra uma na referência, em todas as execuções, sem explicação.
4. A instrução da volta de reconciliação foi ajustada em quatro iterações contra o mesmo modelo, e só a `run5` usa o texto final: uma amostra, não estabilidade. A mudança altera quando o modelo pergunta ou para; nenhum gate foi alterado.
5. O recibo agrupa como "duas aprovações" a `run4` (texto intermediário) e a `run5` (texto final).
6. Custo estimado e sem ledger; L2 incompleto.

## O que cada família precisa para mudar

- **F14:** um consumidor que não seja o roteiro da campanha: o `agent run` de produção com memória sobre o `project.db` ativado, e uma tarefa que não aponte a memória no requisito.
- **F15:** um `fork` que preserve a compactação, uma comparação com o histórico integral auditável, e repetição do texto final da instrução.
- **F17:** decisão do owner sobre um fornecedor local no vocabulário do manifesto; binding local e manifesto com teste de contrato; backend efetivo da composição ACP (ou exceção auditada); cota por binding remoto (ou exceção auditada).
