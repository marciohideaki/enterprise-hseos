# Segunda reauditoria cega de F14 e F15, 2026-11-06

Escopo: dois auditores isolados e independentes (um por família), sem acesso às conclusões do executor, receberam só os critérios (`requirements.json`, ADR-0050) e os caminhos da evidência nova, com ordem de derivar o veredito dos arquivos brutos. É a passagem cega; a passagem de confronto fica com o Commander. O owner decidiu não criar valor novo no enum de `real_consumers`. Este documento não altera `requirements.json`. Continua o `REAUDIT-BLIND-2026-11-05.md`.

**Resultado: nenhum status muda. F14 `real_consumers` e F15 `real_consumers` ficam `not_verified`.**

| Família | Evidência nova                                                                                                                                              | Veredito              | Razão decisiva                                                                                                                                                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F14     | `F14-PRODUCTION-PATH-2026-11.md`: `agent run` de produção, requisito sem citar a memória, memória lida por `source_db` somente leitura, promoção pelo owner | manter `not_verified` | É uma execução com tarefa e nota desenhadas pelo executor (marcador detectável, fixture de teste): demonstração, e não consumidor real nos termos do ADR-0050 §5.2. Nenhum valor existente do enum cabe: o valor por API exige recibo L2 com custo real comprovado, e aqui o custo não foi medido |
| F15     | `F15-COMPACT-BEFORE-WRITE-2026-11.md`: compactação antes do checkpoint do `fork`, 3 de 4 execuções reais                                                    | manter `not_verified` | Falta o recibo L2 com custo real e credencial comprovada, e a igualdade de bytes com o histórico integral só ocorreu em 1 de 6 pares comparados                                                                                                                                                   |

## O que mudou desde a primeira reauditoria

- **F14:** o caminho de produção foi exercitado (antes era um roteiro com host montado à mão), o requisito deixou de citar a memória, a prova da promoção ficou arquivada em arquivo (cópia do `project.db` com hash, integridade `ok`, evento de promoção com ator `owner` e digest), e a fonte foi aberta somente para leitura sem alteração (`source_db_unchanged: true`). O auditor reconhece que o consumidor está "menos sintético que antes".
- **F15:** o `fork` agora nasce depois da compactação e antes da primeira escrita, com a compactação no prefixo. Estava a lacuna principal da primeira reauditoria.

## O que continua pesando

**F14**

1. O consumo não passa por uma tarefa que o operador teria: contrato e workspace vêm de um fixture de teste, e a nota foi escrita para ser detectável.
2. O custo é desconhecido (`usage` ilegível), então não há "custo real abaixo do teto".
3. Uma execução, um modelo pequeno, e um controle que precisou de um ajuste de limite antes de uma execução válida.
4. O host injeta o contexto; o modelo não chamou `memory.retrieve`.
5. O ator `owner` é um rótulo declarado; o verificador protegido aprova os dois casos, então o efeito só aparece no artefato.
6. Estados e SSE brutos ficam fora do git; só os hashes são verificáveis a partir do repositório.

**F15**

1. `artifacts_equal` (bytes) só foi verdadeiro em 1 de 6 pares; o resto é igualdade por critérios e por conteúdo sem espaço no fim.
2. `single_compaction` é falso em todas as execuções, a execução compactada escreve duas vezes contra uma na referência, e o `fork` termina com mais de uma compactação.
3. A tarefa foi escolhida (arquivo inicial preenchido) para forçar a compactação antes da escrita: prova o mecanismo nesse caso, não numa tarefa qualquer. A estabilidade foi de 3 de 4.
4. Custo estimado e sem ledger; L2 incompleto.

## Exageros dos recibos que o executor corrigiu

- F14: o custo "abaixo de US$ 0,02" não tinha base de medição; o recibo agora diz que o custo não foi medido. O rótulo foi trocado de "uso de memória por modelo real" para "demonstração em uma execução com controle". Foram acrescentados o ajuste de limite do contrato e o fato de o contrato vir de um fixture.
- F15: as ressalvas já estavam no corpo do recibo; o auditor aponta que o rótulo "preservada" pesa mais que os pares de bytes; o recibo permanece como está, com as lacunas listadas.

## O que cada família precisa para mudar

- **F14:** uma tarefa real do operador (fora de fixture e sem marcador desenhado para ser detectado), repetida e com mais de um modelo, e custo medido por ledger.
- **F15:** custo medido e credencial comprovada (L2), uma comparação de artefatos auditável e estável, e repetição da compactação antes da escrita numa tarefa que não tenha sido escolhida para induzi-la.
