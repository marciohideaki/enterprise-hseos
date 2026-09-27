# Verificação W4

Tipo: contrato de verificação. Fontes: PLAN.md §4; spec FR01–FR08; Constituição §7.

Testes novos rodam junto do delta, Node --test --test-concurrency=1. Execução Linux
isolada usa systemd-run --user --scope --quiet -p Delegate=yes; não pular cenários
por indisponibilidade de isolamento. Default de executor: 256 MiB/32 processos;
cenários positivos timeout <=3 s, adversariais de timeout <=1 s, saída <=64 KiB;
drain máximo 5 s conforme executor existente. São limites de ensaio, não SLA de
produção. Registrar wall time observado, limites e status/descendants_terminated.
Relógio lógico injetado testa elegibilidade sem sleep; disputas e drain usam processos
reais. Não usar apenas mocks para fencing, persistência, isolamento ou conformance.

| Célula | Casos e teste previsto                                                                                   | FR                |
| ------ | -------------------------------------------------------------------------------------------------------- | ----------------- |
| P1     | import sem efeito, incompatibilidade, hash trocado, paths/autoridade; test-execution-plugin-manifest.js  | 01                |
| P2     | saída inválida, timeout, órfão, segredo/rede/workspace negados; test-execution-plugin-runtime.js         | 02/05             |
| J1     | horário, prazo, atraso, reinício pendente; test-job-control.js                                           | 03                |
| J2     | dono vivo/morto/desconhecido, dois processos, fence/seq/replay; test-job-recovery.js                     | 03/05             |
| F1     | crash antes/depois de create/reserva/dispatch/efeito/recibo; test-job-faults.js                          | 03/06             |
| D1     | ciclos/deps, expansão dupla/concorrente/limite, join parcial/baseline/cancel; test-workflow-expansion.js | 04/05             |
| B1     | reservas concorrentes, recibo perdido, cancel, backend, filho tardio/segundo saldo; test-job-campaign.js | 06                |
| I1     | externo/offline, help/import, não selecionado, upgrade/rollback; test-execution-plugin-install.js        | 07                |
| S1     | jornada CLI/API/SDK JS/TS/Python com cursor; test-job-surfaces.js                                        | 08                |
| R1     | consumidores reais tool/provider/context + binding elegível, recuperação/cancel; evidência W4-07         | 02/03/05/06/07/08 |

Cada recibo contém revisão Git + hash de arquivos, ambiente, comando literal,
início/fim, exit code, contagem de testes/skips, resultado e limitações. Fixtures
adversariais, consumidores reais e ativação são estados separados. Testes de W3 não
são reciclados como prova W4; orçamento e recibos históricos são preservados.

Final: npm test e VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh em
Node 24 e 22, sequencialmente; npm run test:kernel-coverage em ambos. Inventário de
arquivos críticos inclui todos os novos módulos mesmo não executados; >=90% linhas
/>=80% branches por arquivo. Expandir .c8-kernel.json e quality-surface conforme delta.
Mutantes dirigidos removem fences, admissão, reserva e bloqueio de incerteza: testes
precisam rejeitar cada mutante, sem alterar evidência histórica. Revisão adversarial
mapeia cada afirmação a recibo; bloquear fechamento se alguma célula obrigatória
estiver pendente, incerta, fixture-only ou omitida.
