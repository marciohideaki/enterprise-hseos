# W4-04b2a — invalidação por drift antes do efeito

Tipo: contrato de implementação. Base `0b420bff`; FR04/05/06; extensão de
[workflow.md](workflow.md) e [jobs.md](jobs.md).

Quando o baseline de um filho mudar antes de seu primeiro efeito, registrar
`not_executed` com razão `JOB_BASELINE_DRIFT`. O workflow deve bloquear novos
despachos, drenar todos os filhos e liberar a reserva como falha comprovada.
Após a intenção de despacho, a montagem do workflow pode reconstruir seus
adapters para chegar ao guard do filho; essa montagem não admite efeito. O
guard estrito de `runtime.send` volta a conferir o baseline antes de iniciar
cada filho.
Os predecessores já aceitos preservam seu resultado e não são repetidos. Os
dependentes ainda não despachados recebem resultado `not_executed`; a projeção
do job fica `invalidated` com provas por filho somente depois de confirmar o
terminal do pai e a drenagem. A ausência do terminal mantém o resultado
`uncertain`; falha comprovada de outro filho prevalece como `failed`. Efeito
iniciado ou drain não confirmado continuam `uncertain`, sem reclassificação
como drift seguro.

Teste dirigido altera o baseline após o primeiro aceite de uma DAG de dois nós,
confirma que o segundo não executou e que o primeiro permanece aceito. Testes
negativos de falha antes da drenagem e baseline alterado antes da intenção de
despacho continuam sem segundo efeito. Cobertura e gates integrais Node 22/24
precedem o commit.
