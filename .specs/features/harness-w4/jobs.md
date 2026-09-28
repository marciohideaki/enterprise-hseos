# Contrato de jobs W4

Tipo: contrato de design; FR03/05/06/08, ADR-0045 Proposed.

## Envelope e definição v1

Comando segue controle existente: schema_version=1, command_id UUID, resource_id
UUID (job_id), expected_sequence inteiro seguro >=0, action e input estrito.
Ações públicas: create, cancel, reconcile, resume; claim/dispatch/settle são operações
internas do controlador, não comandos arbitrários HTTP. Mesmo command_id com mesmo
digest retorna recibo original; payload divergente falha. Sequência obsoleta falha
antes de qualquer efeito, inclusive expansão/claim concorrentes.

Create contém kind task/workflow, definição fixada (contrato e IDs de binding,
sem paths executáveis), not_before UTC, deadline_at UTC absoluto, depends_on IDs
existentes distintos, campaign_id/authorization_id referenciados quando houver
provider, seleção de extensões com digests e baseline esperado. Definição inclui
limites de execução existentes, não saldo novo. Datas inválidas, deadline anterior
a not_before, auto-dependência e grafo cíclico são recusados. Criar só persiste dados;
materialização de workspace/tarefa é posterior à elegibilidade e à admissão.

## Estados e relógio

queued → claimed → materializing → ready → dispatching → running → succeeded.
Falhas antes do efeito: failed/expired/invalidated. Cancelamento queued → cancelled;
com trabalho iniciado: cancelling → cancelled somente depois de drain comprovado.
Crash/recibo perdido/resultado de drain desconhecido → uncertain.
Terminal: succeeded, failed, expired, invalidated, cancelled; não volta à fila.
Reconcile registra observações e decisões, sem repetir efeito. Nova tentativa é
novo job explicitamente vinculado ao anterior e à mesma autorização/campanha.

Elegibilidade: now >= not_before, now < deadline_at, todos predecessores com
resultado verificado succeeded, baseline/configuração atuais e autorização válida.
Falha de predecessor cancela dependentes ainda não despachados. First_started_at e
execution_deadline_at=min(deadline_at, first_started_at+max_duration_ms) são fixados
na primeira partida. Tempo na fila não consome duração; retomada não renova prazo.

## Persistência, ownership e recuperação

ExecutionEventLedger.append/appendBatch com expected_version, sob transação SQLite.
Evento inicial registra definição/digest/IDs. Eventos seguintes registram claim,
intenção de materialização, recurso criado, reserva, intenção de despacho, recibo,
cancelamento, drain e reconciliação. Catálogo SQL é aditivo e fechado; eventos têm
versão própria. Query projeta stream e events usa cursor de sequência estável.

Claim carrega fence monotônico, PID/start_ticks/resource_parent, acquired_at e
lease_expires_at. Cada transição que produz efeito revalida fence, sequência,
cancelamento e prazo. Expiração isolada não permite roubo. Dono vivo ou desconhecido
bloqueia; dono comprovadamente morto exige reconciliação/drain antes da troca.
Dois processos concorrentes devem obter um único dono e uma única materialização.

Antes de materializar, persistir ID determinístico do recurso e intenção. Crash antes
ou depois da criação é reconciliado pelo ID e recibo no mesmo ledger; não criar outro
workspace silenciosamente. Antes de provider, reservar na ProviderCampaignControl
com ID estável. Crash entre job/reserva/dispatch é conciliado consultando a campanha;
intenção sem prova negativa de efeito permanece uncertain. Sem retry externo automático.
Worker usa fila reconstruída do ledger e concorrência padrão 1; não substitui
GovernedExecutionScheduler, que continua encaminhando efeitos pelo port governado.

## Superfícies e orçamento

POST /v1/jobs/commands; GET /v1/jobs/{id}; GET /v1/jobs/{id}/events?after=&limit=.
Mesmo envelope/autenticação/erros do controle; métodos equivalentes em CLI e
ControlClient JS/TS/Python. Campos desconhecidos e upload de código são recusados.

Job aponta campanha existente; não cria teto próprio. Autorizações continuam
consumidas uma vez por ledger. Recursos são reservados no workflow/sessão; dinheiro
na campanha. Cancelamento ou perda de recibo não liberam reserva incerta. IDs
correlacionam parent/child/plugin/job e impedem nova campanha para resetar saldo.
Troca de backend exige nova admissão dentro da campanha original.

## Projeção compatível da preparação03c

JobLifecycleRecorded v1 mantém seu enum existente. A preparação adiciona o evento
JobMaterializationRecorded v1 e o campo `materialization.phase` (`planned`/`ready`)
à projeção. Durante essa subfase o status de ownership permanece `claimed`; ready
não é sucesso nem liberação de despacho. A fase posterior03d acrescentará seus
próprios eventos de dispatch/settlement, com compatibilidade explícita. Os estados
conceituais acima não autorizam ampliar silenciosamente o enum de eventos antigos.
