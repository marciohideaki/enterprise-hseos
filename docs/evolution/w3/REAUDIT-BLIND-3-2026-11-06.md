# Terceira reauditoria cega de F14 e F15, 2026-11-06

Escopo: dois auditores isolados e independentes (um por família), sem acesso às conclusões do executor, receberam só os critérios (`requirements.json`, ADR-0050) e os caminhos da evidência das campanhas novas (`F14-BEHAVIORAL-2026-11.md` e `F15-NATURAL-COMPACTION-2026-11.md`), com ordem de recalcular tudo dos arquivos brutos. É a passagem cega; a passagem de confronto fica com o Commander. O owner decidiu não criar valor novo no enum de `real_consumers`. Este documento não altera `requirements.json`. Continua `REAUDIT-BLIND-2-2026-11-06.md`.

**Resultado: nenhum status muda. F14 `real_consumers` e F15 `real_consumers` ficam `not_verified`.**

| Família | Veredito              | Razão decisiva                                                                                                                                                                                                                                                                                                                                     |
| ------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F14     | manter `not_verified` | O controle sem memória também passou uma vez (1 de 3 contra 2 de 3 com a memória) com o mesmo tipo de código (`Math.round`), então os dados não mostram que a memória promovida causou o resultado (Fisher exato, p próximo de 1). A tarefa e a nota seguem desenhadas pelo executor (§5.2) e a resposta do owner de 2026-11-05 pede "tarefa real" |
| F15     | manter `not_verified` | Não existe recibo L2: credencial e cota não foram comprovadas pelo adapter, a conta dona da chave e o saldo não foram identificados e o custo é precificado à mão. O valor por API exige exatamente isso                                                                                                                                           |

## O que os auditores recalcularam e confirmaram

- **F14:** os 12 `index.js` reexecutados contra os três testes protegidos dão os mesmos resultados do recibo; o banco da fonte não mudou nas 12 execuções; o `project.db` arquivado tem o hash registrado e o evento de promoção com ator `owner` e digest `e209c090…`; 116 requisições, 0 ilegíveis, US$ 0,4128, igual ao recibo.
- **F15:** os tokens e custos por execução batem exatamente; nas 5 execuções completas o checkpoint do `fork` vem depois da compactação (sequência 17) e antes da primeira escrita, com a linhagem íntegra e o pai inalterado.

## Achados que o executor aceita e registrou nos recibos

1. **F14 – o rótulo prometia mais que os dados.** "Efeito comportamental observado" foi trocado por "indício direcional, sem prova de causa". Controles e promovidas rodaram em blocos separados no tempo, sem aleatorização, e o `gpt-4o` aplicou a convenção errado em uma execução promovida.
2. **F14 – motivo de promoção divergente:** o `prepare-*.json` traz "production-path campaign" e o ledger "behavioral campaign" (o comando executado levava o segundo). O ledger é a fonte.
3. **F15 – a verificação protegida aprova arquivos mutilados.** A referência da `mini-3` terminou com 347 bytes e uma função (os ajudantes foram apagados) e foi aprovada, porque a verificação só testa `add`. As execuções compactadas preservaram o arquivo (2.063 bytes). "Aprovado" não prova que o resto do arquivo foi preservado, e isso explica parte da divergência de bytes (4 de 10 pares iguais).
4. **F15 – "natural" é relativo à janela declarada.** O contexto declarado é o padrão de 20.000 tokens desde a C9 e o limiar é medido em bytes do JSON canônico. Com a janela real do modelo, o arquivo de 2 KB não compactaria, e a posição 17 é determinística. (O auditor leu o 20.000 como uma redução feita nesta rodada; não foi: é o valor de sempre.)
5. **F15 – a causa da reprovação da `4o-3` não foi diagnosticada** (erro do modelo ou perda por compactação), e tokens em cache não receberam desconto no custo.

## O que cada família ainda precisa para mudar

- **F14:** uma tarefa do operador, não desenhada pelo executor; repetição suficiente para distinguir efeito de acaso (ou um desenho em que o controle não passe por acaso), com ordem aleatorizada; mais de um provedor; e custo faturado ou por ledger.
- **F15:** um recibo L2 completo (credencial usada comprovada pelo adapter, versões do cliente e do modelo, cota observada ou exceção auditada, replay e drain); uma verificação protegida que cubra o arquivo inteiro (para uma comparação que prove preservação); diagnóstico da falha da `4o-3`; e repetição maior.
