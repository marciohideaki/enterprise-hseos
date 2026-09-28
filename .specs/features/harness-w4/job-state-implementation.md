# W4-03a — agregado durável e projeção de jobs

Tipo: contrato pré-implementação. Constituição §§2.6/5/7, ADR-0045 Proposed,
FR03/05/06/08, jobs.md. Task hseos-w4-jobs-state criada em 2c06be5 apenas para
preparação documental. Base atualizada por fast-forward para 2b33dc9 após integração W4-02c3c (731c8f0).

## Reuso e fronteira desta task

ExecutionEventLedger continua único store; stream control_job, evento versionado
registrado por migration aditiva 012-job-events.sql no diretório pending-activation.
Não ativar banco operacional. JobControl pertence ao EngineeringControl e usa sua
conexão/transações. Projeção é replay determinístico; não criar tabela de saldo,
store paralelo nem executar scheduler de efeitos na criação.

W4-03a implementa create/cancel de fila, query/events e validação de definição,
horário/dependências/configuração fixada. Claims, fencing e recuperação são W4-03b;
materialização idempotente/backup/rebind W4-03c. Publicação HTTP/CLI/SDK é W4-06a.
Comandos não implementados falham fechados, não retornam recibos de sucesso fictícios.

## Entradas e identidade

Envelope igual ao controle: schema_version=1, UUID command_id/resource_id (job_id),
expected_sequence seguro não negativo, action/input estritos. Criar trabalho task
ou workflow contém definição/inputs existentes, not_before e deadline_at UTC,
depends_on UUIDs distintos, configuração admitida fixada e referências de campanha
quando aplicáveis. Usar contratos existentes de tarefa/workflow/seleção/modelo;
extrair ponto de admissão puro do controle se necessário, sem copiá-lo.

O ID do recurso materializado deve ser conhecido antes de qualquer efeito e
registrado no created. A identidade autorizada da campanha não pode ser trocada
pelo UUID interno aleatório de task_run. Definição e pins são imutáveis e cobertos
por digest canônico. Nenhum input HTTP recebe código ou caminho executável arbitrário.

Criar persiste somente dados admitidos. Não inicia plugin/provider/modelo, não
materializa workspace, não reserva chamada na campanha. Política/baseline/prazo e
orçamento voltam a ser verificados pelo worker antes de executar. Referências de
modelo/campanha devem preservar a identidade original descrita em task-model-composition.

## Tempo, sequência e dependências

not_before/deadline_at exigem UTC canônico válido e not_before < deadline_at.
Prazo absoluto limita a execução; a duração do contrato não começa na criação.
first_started_at/execution_deadline_at permanecem ausentes até a primeira partida.
Query pode mostrar elegibilidade temporal, mas isso não é autorização de despacho.
Não existe recorrência ou execução automática ao consultar.

Dependências devem existir, não repetir job_id, nem formar ciclo. Sucesso só será
reconhecido com resultado verificado do recurso, nunca por conclusão de modelo.
Dependências não concluídas bloqueiam elegibilidade. Falha/cancelamento impede
futuro despacho dependente, com transição governada implementada junto do worker.

Transações com expected_version fecham disputa de criação/cancelamento. Mesmo
command_id e digest devolvem recibo original; payload divergente e sequência
obsoleta são rejeitados. Cancelar queued persiste cancelled sem executar trabalho.
Estados terminais não voltam à fila. Nova tentativa exige outro job e vínculo
explícito preservando autorização/orçamento, a ser implementado sem autoretry.

Events aceita cursor de sequência do stream (after, limit), ordenação estável e
next_cursor. Query/events após reabertura usam somente ledger, sem resolver plugin.
Replay valida eventos e transições; dados adulterados não produzem estado aprovado.

## Saídas e verificação

Outputs: tools/lib/job-contract.js, tools/cli/lib/job-control.js,
tools/mcp-project-state/migrations-pending-activation/012-job-events.sql,
test/test-job-control.js, integração estritamente necessária no controle,
package.json/.c8-kernel.json/test-package-surface.js, STATUS e evidence/jobs-state/\*.
Qualquer extração do ponto de admissão deve ser documentada antes da implementação.

Comando: node --test --test-concurrency=1 test/test-job-control.js
test/test-engineering-control.js test/test-execution-event-ledger.js.
Verificar nomes reais do suite de ledger antes do ensaio; não alegar execução pelo
comando planejado. Node22/24 sequenciais, c8 --all 90/80 por arquivo crítico,
revisão cega/confronto e gate integral antes do commit.

Cenários mínimos: create sem efeito/reserva/workspace; instante anterior/igual a
not_before; prazo expirado sem execução; dependência inexistente/repetida/cíclica;
replay após reabertura; comando repetido/divergente e CAS obsoleto; cancelamento
queued/terminal; paginação de eventos; drift da configuração entre criação e
admissão do worker não muda pin. Dois processos/claims pertencem à W4-03b.

## Descoberta complementar antes de implementar

Catalogação de migrations também é verificada por
test/test-operational-state-db.js (atualmente versão 11),
test/test-agentic-activation-rehearsal.js e test/test-compatibility-audit.js.
Atualizar expectativas aditivas junto de 012, preservando o bloqueio de ativação
operacional. Esses três arquivos entram no output contract se o delta os afetar.
ProviderCampaignControl.events já usa cursor de stream_sequence e deve ser a
referência de forma pública do cursor de jobs, sem copiar sua autoridade monetária.

## Extração de admissão compartilhada

Antes do agregado, extrair `EngineeringControl.admitCreation(action, input, resourceId, deadline)`
do bloco já aplicado por execute. O método retorna definição normalizada e pins,
sem gravar intent, registrar recurso ou materializar workspace. Jobs e controle
imediato usam a mesma implementação. O prazo recebido por jobs é absoluto; o
controle imediato mantém a duração existente. A extração permanece no arquivo
engineering-control.js, sem novo contrato paralelo.

Expectativas de versão de fixture também em test-execution-event-ledger.js, test-governed-execution-runtime.js, test-native-entrypoint-wiring.js, test-execution-projections.js. Atualização aditiva 11→12 incluída no output contract; nenhuma ativação operacional.

Dry-run/rehearsal fixam explicitamente versão candidata: tools/lib/compatibility-audit.js e tools/lib/agentic-activation-rehearsal.js entram no output contract para 11→12, preservando checagens de integridade, banco v4 e gate humano.

Teste de integração do pin de campanha em job reutiliza setup local de test/test-engineering-plugin-model.js, acrescentado ao output contract.

## Forma implementada do created

Create recebe kind, definition (input do controle imediato), not_before,
deadline_at e depends_on. execution_resource_id é igual ao job_id, em namespaces
distintos, reservado reciprocamente contra criação imediata. Admissão persiste
input normalizado, seleção quando presente, plugin_model ligado à campanha
original ou binding legado normalizado/hash. Replay valida dados sem consultar
catálogo, arquivos de binding ou campanha. Worker deverá comparar admissão
atual com o pin antes da materialização; nenhum worker é fornecido por esta task.

Cada comando grava um único JobCommandRecorded v1 atomicamente; o evento contém
comando/digest e, na criação, admissão/digest. Recibo é projeção determinística
até o evento do comando, preservando resultado original após cancelamento posterior.
Só create e cancel queued estão habilitados. Elegibilidade temporal é consulta
separada e retorna admission-required; não autoriza efeitos.

## Correção requerida pela regressão de cancelamento

Hook bloqueou commit com SQLITE_BUSY_SNAPSHOT no teste de cancelamento entre
processos. Investigação identificou transação externa deferred em
EngineeringTaskState.append, que lê antes da transação immediate interna do ledger.
Reprodução determinística com duas conexões será executada antes da correção.
Adicionar tools/cli/lib/engineering-task-state.js e test/test-engineering-task-state.js
aos outputs: adquirir lock de escrita antes do primeiro read, preservando CAS e
sem retries automáticos. A fronteira externa de reconciliação em
engineering-task-runtime.js também deve ser examinada; se corrigida, incluir
regressão de reconciliação e cobertura desse arquivo. Isso é pré-requisito da
integração com a base de recuperação; gate falho não será convertido em exceção.

Reprodução determinística confirmou SQLITE_BUSY_SNAPSHOT nas duas fronteiras.
Correção inclui engineering-task-runtime.js e test/test-engineering-reconciliation.js.
Ambas adquirem BEGIN IMMEDIATE externo antes de ler; CAS e política de reconciliação
permanecem inalterados. Testes provocam escrita concorrente por outra conexão e
exigem bloqueio durante o commit, liberação posterior e nenhuma repetição do efeito.

Mesma fronteira em engineering-workflow-runtime.js incluída: reconciliação dos
filhos compartilha o ledger e requer o mesmo lock externo; teste parametrizado
com tarefa e workflow comprova escrita concorrente bloqueada e efeito único.

Diagnóstico pós-lock: falha de conformance no gate exige capturar o relatório
na mensagem do assert (test-agent-provider-conformance.js), preservando todos os
critérios. Resultados isolados/canônicos posteriores não explicam a falha;
evidências históricas permanecem classificadas como FAIL.
