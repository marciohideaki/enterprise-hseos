# W4-04a2c — expansão de workflow em execução

Tipo: contrato de implementação. Base `1e90d2b0`; FR04/05/06; intake v2 de
reservas em `docs/decisions/harness-w4-workflow-reservations-intake.md`.

O comando de expansão usa o mesmo CAS de sequência e recibo do job. Quando o
job está `running`, a operação exige materialização pronta, despacho ativo,
owner vivo, reserva de sessão com claim registrado e ausência de cancelamento.
Validação de contrato, baseline e orçamento precede o append. A transação
SQLite grava a revisão da reserva, a revisão do job, os registros de controle
dos filhos e seus estados criados; qualquer falha reverte todos os streams.

O plano de materialização guarda o prefixo original byte a byte e acrescenta
somente filhos com IDs derivados do job, do command ID e do ID lógico do nó. A
preparação de arquivos dos filhos novos é idempotente e não altera diretórios
dos filhos iniciados. Arquivos preparados por uma tentativa que perde o CAS
permanecem fora do ledger e não conferem autoridade de despacho; o saneamento
de artefatos órfãos exige evidência de recuperação na W4-04b.

Cada filho tardio recebe prazo `min(prazo_original_do_pai, instante_da_expansão
+ duração_do_contrato)`. As janelas dos filhos anteriores não mudam. O plano
retém os hashes de registro por fronteira para que o replay valide cada filho
contra a versão em que foi preparado. O runtime carrega a montagem de um filho
tardio somente quando seu ID consta do plano persistido, e o engine acrescenta
fases ao fim da definição já pinada; checkpoints anteriores preservam seus IDs.

Testes dirigidos cobrem duas revisões consecutivas, reabertura, idempotência,
cancelamento vencedor e rollback entre a revisão da sessão e o append do job.
Um cancelamento do trabalho antigo ainda pode permanecer `uncertain`; a prova
de drenagem e reconciliação é critério de W4-04b. Nenhuma autorização financeira,
publicação, ativação operacional ou merge na foundation decorre desta task.
