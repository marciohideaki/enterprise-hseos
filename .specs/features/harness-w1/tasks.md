# Tasks sequenciais W1

Todas: execution_mode=isolated; task/hseos-evolution-w1. Base lógica
feature/hseos-evolution-w0-quality; feature de entrega
feature/hseos-evolution-w1-engineering. W0 ainda sem commit: importação no índice
fixada em 28f6ba59233e80bc35cdf51e12f433ec9efed9b8; mudanças W1 fora do índice.

| ID | Entrega | Inputs / outputs | Dependência | Verify step | Estado |
|---|---|---|---|---|---|
| T1 | Contrato v2 e snapshot | engineering-task-contract + módulo workspace, testes v2 | W0 | rejeitar baseline/link/escopo inválido e preservar v1 | verificado; matriz final Node22/24 |
| T2 | Registry e verificadores Node/TS/Python/web | engineering-verifier + registry, fixtures multiarquivo | T1 | correto/incorreto/vazio/adulterado em sandbox | verificado; matriz final Node22/24 |
| T3 | Busca/patch/diff/Git e aplicação | engineering-tools + workspace, testes concorrência | T2 | precondições, baseline, rejeição e preservação concorrente | verificado; matriz final Node22/24 |
| T4 | Serviço/API local versionada | controle persistente + transporte HTTP, testes recuperação/auth | T3 | sequência/idempotência/cursor/reconciliação | verificado; matriz final Node22/24 |
| T5 | CLI e SDK JS/TS/Python | consumidores públicos e contratos, testes cruzados | T4 | mesma identidade e efeito pelas interfaces | verificado; matriz final Node22/24 |
| T6 | Instalação e fechamento | exemplos, migração, docs, recibos | T5 | suítes/gates/pack/instalação externa sequenciais | verificado; gates, matriz e instalação externa |

Não marcar W1 concluída enquanto T1–T6 não atenderem os respectivos aceites.

Evidências e limites: docs/evolution/w1/STATUS.md e evidence/receipt.json.
