# W4-03b — revisão e evidência em andamento

Base d948154; W4-03a cbf79f2 passou gate/hook e está integrada apenas na feature.
Recibo anterior: prior-jobs-state-commit.log.gz. Sem ativação operacional.

Revisão cega identificou P1: append público permitia contornar admissão/drain;
P2: após drain concorrente, receipt consolidado podia ser confundido com estado.
Correções: método #append privado; retorno do receipt após drain antes de acessar
state. Primeira rodada 7/8 falhou na exposição pública. O teste concorrente não
reproduziu a janela TypeError; correção dessa janela foi confirmada estaticamente.
Rodada seguinte 30/30, sem skips. Confronto independente encerrou ambos achados.

Rodada com cgroups reais: 21/21, mas cobertura de branches worker 78,76% FAIL.
Não houve commit ou redução do gate. Testes adicionais de campanha, workflow e
admissão incerta: 40/40; worker 100% linhas/86,06% branches; jobs 100%/96,39%.
Nova rodada completa Node24 em curso após adicionar rejeição de replay adulterado.

Provas reais locais: dois processos disputam mesmo job; dono morto deixa processo
em cgroup populated 1; reconciliação remove grupo somente após drain; cancelamento
concorrente invalida sequência; resource parent incompatível mantém recuperação
pendente. Plugins/contas são fixtures, não certificação de consumidores reais W4.

Próximos gates: Node24/22 sequenciais, lint, confronto final, gate integral e hook.

Node24 completa: 281/282, zero skips. Única falha: package entry count1452 >1450.
Cobertura críticos: state100/82,55; jobs100/96,39; worker100/91,42. Inventário
comprova duas entradas novas necessárias: worker e migration013; nenhuma temporária
nesse delta. Threshold permanece1450. Node22 em curso; commit/gate bloqueados.

Node22 completa: mesmo281/282 e falha exclusiva package1452>1450, zero skips.
Lint inicialmente encontrou prefer-switch/explicit-length-check; correções locais
aplicadas sem alterar requisitos. Pós-lint41/41 Node24 e41/41 Node22 sem skips;
worker100/91,30 e jobs100/96,39. Lint final exit0 (sessão77093), diffcheck limpo.
Cobertura anterior state100/82,55 continua correspondente (arquivo não mudou).
Inventário final arquivado; contador1450 permanece intacto. Nenhum commit03b.

Confronto final independente confirmou12/12hashes, resultados Node22/24,
semântica do switch e inventário final1452/9.086.345bytes. Sem novo bloqueio de
código identificado. Inventário comprimido anexado é o pós-lint; o arquivo
ignorado package-inventory.json é anterior e não é a referência final.
Decisão sobre limite pendente; nenhum gate integral ou commit foi tentado.

Usuário autorizou explicitamente a revisão1450→1452 para os dois arquivos do
inventário apresentado. Teto22MB e exclusões permanecem. Validação do ajuste
e gate integral pendentes; falhas históricas mantidas sem reclassificação.

Após autorização, pacote passou Node24/22. Gate integral Node24 PASS exit0,
zero falhas/um aviso de template. Log também registra Broken pipe no scanner
de higiene; não se afirma log sem diagnósticos. Conformance passou. Hook pendente.
