# WAVE-A-REPORT — stab2-wave-a

Sem custo, sem mudança de produto. Documentos em `docs/evolution/w3/stab2/`.

| Tarefa | Executor | Resultado | Revisão |
|---|---|---|---|
| T1a `ci/commit-tier-gates` | Sonnet | propõe descartar: o hook light cobre; conflita em `quality-gates.sh` | sem revisão isolada |
| T1b `guard-ts-parser-spike` | Sonnet | propõe descartar o código e guardar o relatório | sem revisão isolada |
| T1c rascunhos W6–W8 | Sonnet | specs: aproveitar trechos; `W4-W8-PLAN.md`: descartar como documento | sem revisão isolada |
| T1d `legacy-code-review` | Sonnet | propõe integrar em PR própria; validador enfraquece `SKILL-01` | sem revisão isolada |
| T2 falha da `4o-3` | Sonnet | erro do modelo, com defeito concorrente da poda | aprovado com ressalvas, corrigidas |
| T3 janela do binding | Opus (Commander) | binding da #283 inutilizável; opções A a D | aprovado com ressalvas, corrigidas |
| T4 protocolo | Opus (Commander) | F14 estratificada, regra de status, mapa L2 | aprovado com ressalvas, corrigidas; teste estratificado não revisado |
| T5 inventário | Haiku | 13 entradas, nenhuma em código vivo | sem revisão isolada |
| T6 correção de recibos | Commander | limiar, janela, binding local | revisado com a T3 |

## Desvios do protocolo
- `worktree-manager.sh merge` não foi usado: ele faz checkout da feature no checkout principal, e ela estava no worktree de integração. Merge `--no-ff` feito lá, com a mesma mensagem.
- `validate` com nada em estágio roda a suíte inteira; os documentos passaram a ser postos em estágio antes, o que usa a regra do próprio gate para mudança só de documentos. Uma execução da suíte foi interrompida por isso.
- A revisão foi uma passagem por documento, cega à conversa, mas com o documento em mãos; o confronto foi feito pelo Commander ao aplicar os achados, não por revisor separado.
- T1a, T1b, T1c, T1d e T5 são insumos de decisão e não tiveram revisor isolado.
