# W4-03c — materialização idempotente no ledger de controle

Contrato pré-implementação; FR03/05/06/08, jobs.md, ADR-0045 Proposed.
Base atualizada após integração03b (commit9a5129a), com gate/hook aprovados.
A unidade seguinte03d integra polling/dispatch/settlement ao serviço existente.
Esta subdivisão mantém escopo W4, tarefas isoladas e um commit por unidade.

## Reuso e fronteiras

- JobWorker: claim, expected_sequence/fence, ownerPID/start_ticks/resource_parent,
  prazo fixo, admissão corrente e reaper. Não criar claim ou relógio paralelo.
- EngineeringTaskState, createEngineeringTaskWorkspace, engineeringSessionSpec,
  assembleEngineeringTask e assembleEngineeringWorkflow são superfícies existentes.
- Workflows já compartilham seu ledger entre filhos com views {db,directory}.
  Reutilizar esse padrão para jobs no ledger de controle. Não criar saldo ou ledger
  de autorização separado; não afrouxar assertTemporaryFixtureDirectory.
- ProviderCampaignControl permanece autoridade monetária; materialização é só
  preparação local. Não inicializar provider, chamar modelo ou reservar dinheiro.
- Resolução de recurso imediato continua compatível. Jobs podem ter views no
  ledger do controle; caminhos não são aceitos como autoridade enviada pelo cliente.

## Contrato proposto

1. Persistir intenção versionada antes de criar diretório/arquivos, sob transação
   immediate com sequência/fence. Fixar task_run_id/session_ids, definição hidratada
   validada, seleção/binding/campanha e destino derivado jobs/<jobUUID> no controle.
   Todo snapshot deve corresponder ao baseline e hashes já admitidos.
2. Materializar tarefas/workflows usando views do mesmo ledger. Ledger canônico
   registra criação e recibo; projection em memória é descartável. IDs e diretórios
   não mudam ao reabrir/reconciliar. Dados temporários locais não entram no pacote.
3. Criar arquivos ausentes somente no estado de materialização e com o snapshot
   fixado. Arquivo existente exige bytes/hash esperados, tipo regular, sem link,
   inode/ancestralidade válidos. Nunca sobrescrever arquivo divergente. Divergência
   ou identidade desconhecida mantém uncertainty, sem novo workspace silencioso.
4. Compartilhar inicialização de tarefa/sessão com caminhos existentes, evitando
   duplicar validação dos contratos ou scheduler. Materialização não executa o
   probe de processo nem provider; attestExecutor fica antes do despacho governado.
5. Preservar execution_deadline_at da primeira claim; filhos limitados pelo prazo
   do job/workflow e limites existentes. Retomada nunca calcula now+duration.
6. Registro control_task e recibo de materialização devem consolidar obrigatoriamente de forma atômica
   no controle (appendBatch existente). Crash parcial consulta a
   mesma intenção/IDs/ledger; não cria outro recurso nem repete execução.
7. Cancelamento/fence/prazo conferidos novamente após await e antes de consolidar.
   Dois controladores não materializam o mesmo job nem alteram workspace de owner
   vivo. Dono morto segue reconciliação explícita+drain antes de assumir preparação.
8. Materialized/ready não significa succeeded: aceite continua no runtime. Acesso
   pelas superfícies antigas não pode despachar job contornando seu claim/fence.
   Operações de efeito da tarefa vinculada exigirão vínculo job persistido e a
   fronteira de despacho03d; wrappers públicos não recebem um bypass arbitrário.

## Arquivos e compatibilidade

Estender job-worker/control e engineering-control/task/workflow-runtime pelos
pontos existentes; se um novo módulo for necessário, justificar no inventário.
Nova migration aditiva para eventos de materialização; atualizar testes de versão
candidata/dry-run/rehearsal sem ativar schema operacional. Novos testes test-job-
materialization.js; fixtures locais e testes de compatibilidade das entradas antigas.
O teto do pacote aprovado03b é1452. Qualquer nova revisão exige inventário/decisão;
não combinar migrations históricas ou remover assets só para acomodar contagem.

## Verificação

Node22/24 sequenciais, heavy-run --pin --mem3G, cgroup delegado, nice19, CPU nãozero.
Testar crash antes/depois de intenção/criação/recibo, reabertura e reconciliação
idempotente, dois processos concorrentes, dono vivo/morto/desconhecido, baseline
alterado, cancel durante preparação, arquivo/link adulterado e prazo preservado.
Comparar IDs/streams/workspace e ausência de efeitos/reservas em todos os cenários.
Compatibilidade: suites engineering-control/task/workflow e test-job-*.
Cobertura --all por arquivo crítico90/80; revisão cega/confronto, gate/hook antescommit.

Hipótese de auditoria herdada: EngineeringControl.execute contém transação externa
deferred em intent. Reproduzir disputa read→write com outra conexão antes de mudar;
não atribuir SQLITE_BUSY_SNAPSHOT sem prova nem adicionar retries de efeitos.

## Revisão preventiva — precisões obrigatórias

- Query/evidence de view parte do EngineeringControl validado e do vínculo
  control_task persistido, confere control_identity/job_id/destino derivado e usa
  o db desse controle. Não chamar openExecutionLedgerFileFixture no subdiretório;
  não aceitar handle/path arbitrário em CLI/HTTP. Queries não montam providers.
- Separar preparação incompleta comprovada de possível execução. Registro parcial
  só é completável quando nenhum evento de dispatch/efeito existe e IDs/hashes são
  exatamente os da intenção. Qualquer prova de dispatch entra em uncertainty e não
  usa o algoritmo de copiar arquivos. JobWorker.unmaterialized deve evoluir sem
  interpretar mero registro como prova de ausência de efeito.
- A retomada reconhece individualmente diretório, manifesto, cada arquivo, evento
  created, sessão pai e filhos. Cada item tem identidade na intenção; estado
  existente deve coincidir antes de avançar. Não reatribuir IDs nem duplicar created
  ou sessões. Origem temporal dos filhos fica na intenção, limitada pelo job.
- Já03c bloqueia TODAS entradas antigas de efeito sobre job/filhos: resume,
  cancel/reconcile que executem probe, terminal, workflow e execução direta por
  caminho. O vínculo persistido exige controle/fence nas fronteiras internas.
  Apenas leitura e a preparação governada ficam disponíveis até dispatcher03d.
- Registro control_task + recibo exigem appendBatch atômico no MESMO db; não há
  exceção “quando possível”. Preservar compatibilidade de recursos imediatos.

Evolução de evento observa Data Contracts & Schema Evolution Standard DC26–29
(produtor G e709368). JobLifecycleRecorded v1 possui enum estrito; não acrescentar
fases silenciosamente como se consumidores antigos tolerassem valores desconhecidos.
Usar evento/versionamento aditivo sem editar migrations históricas. Novo limite de
pacote não é inferido da autorização03b (que cobriu precisamente1452 entradas).

## Descoberta de reuso — sessões de workflow

AgentRuntime.create já é idempotente por spec exata. LocalSubagentProvider.spawn
exige attachment/fork/subagent.requested ao encontrar sessão filha existente;
pré-criá-la só com runtime.create causaria SUBAGENT_CHILD_CONFLICT. Preservar
semântica: intenção fixa IDsfilhos e materializa contratos/workspaces, cria sessão
pai; sessãofilha nasce no spawn governado após dependências/reserva de recursos.
Recuperação03c exige ausência dessas sessões filhas. Se já houver fork/turns, não
é preparação pura e deve permanecer incerta até reconciliação apropriada03d.
Esse ajuste concretiza o reuso, sem criar despacho prematuro na materialização.

O vínculo de preparação (control_task/job_prepared, incluindo IDsfilhos) deve ser
persistido atomicamente com a intenção ANTES dos arquivos/eventoscreated, fechando
a janela anterior ao registered final. assembleEngineeringTask recusa recursos
com esse vínculo por padrão. Inicialização de sessão usa helper fechado que
somente chama runtime.create e drena; não retorna runtime/bundles nem expõe flag
pública para send/probe. Assim, contratos/workspaces parcialmente criados também
não abrem caminho alternativo de efeito. Query usa helper estritamente readonly.

## Fronteira física e replay de consultas

O helper de assembly também confere a associação da view ao arquivo do ledger da
fixture contenedora (`assertExecutionLedgerView`), reutilizando a validação existente
sem abrir outro banco nem ampliar a ativação operacional. Trocar apenas `db` no
handle não pode criar sessão/orçamento paralelo sobre o workspace do job. A proteção
contra execução reconhece ID, diretório canônico e sessão durável, independentemente
do manifesto editável. Inicialização lazy pode construir adapters admitidos para
validar a sessão, mas não lança plugin, abre transporte nem chama provider/modelo.

A subdivisão03d retém despacho/settlement/polling e certificação de backup/restore;
nenhum desses critérios foi removido. Referências em tasks.md e STATE-LIFECYCLE.md.
