# W4-03d — despacho e encerramento de jobs

Status: contrato de implementação; depende de W4-03c integrada antes de alterar runtime.
Base da feature: feature/hseos-evolution-foundation; task nasce da feature W4.
FR03/05/06/08; ADR-0045 Proposed; não autoriza ativação operacional.

## Autoridade e reuso

Reutilizar JobWorker para claim, admissão e dono; JobMaterializer para preparação;
EngineeringTaskState para aceite; runtimes task/workflow e supervisor para execução,
recursos e drain; ProviderCampaignControl para cada reserva monetária. Nenhum saldo,
executor ou scheduler de efeitos paralelo. Estado operacional permanece v4; nova
migração candidata é aditiva, mantendo replay dos eventos12–14.

Intenção de despacho deve preceder inclusive probe de isolamento e coleta de contexto.
Comando interno estrito fixa UUID, sequência esperada e fence. Depois da admissão
assíncrona, reler claim, dono, prazo, cancelamento e plano na transação que grava
intenção. First_started_at/execution_deadline_at nunca são recalculados.

Uma capacidade interna de execução associa conexão física validada, job, fence,
owner e IDs do plano à intenção persistida. Não aceitar boolean de bypass nem callback
arbitrário nas interfaces públicas. Entradas legadas continuam recusando jobs fora
do despacho governado. A capacidade expira ao concluir/drain e não autoriza filhos
tardios; revalidar antes de probe, contexto, modelo, ferramentas e início de filho.

## Evento e estados

JobExecutionRecorded v1 acrescenta intent, settled e uncertain. Intent só a partir
de claimed+ready sob owner atual e prazo vigente. Nova projeção expõe running sem
mudar enum do JobLifecycleRecorded v1. Settlement contém referências às versões dos
agregados de tarefa/sessão e seus hashes. succeeded exige todos os aceites approved,
sessões terminais e drain comprovado. Modelo completed sozinho nunca prova sucesso.
Resultado blocked ou drain inconclusivo permanece uncertain; falha verificada pode
ser failed. Cancelamento terminal exige drain. Eventos são estritos e replay puro.

Queued vencido ou com dependência terminal sem sucesso recebe transição durável
expired/cancelled. Cancel durante running persiste pedido e propaga para tarefas e
supervisor. Falha bloqueia novos despachos. Jobs terminais não retornam à fila.

## Recuperação e serviço

Depois de intent, recuperação de preparação é proibida. Dono vivo/desconhecido não
pode ser substituído por lease. Dono morto exige reap/drain. Ausência de recibo externo
não prova ausência de efeito: sem retry automático. Reconciliação somente observa
streams de tarefa/sessão/campanha; se não há prova conclusiva, registra uncertain.
Aceite já persistido pode ser conciliado sem novo modelo/ferramenta. Identidades,
prazos e autorização permanecem os originais.

Polling reconstrói fila pelo ledger, um job por vez por padrão, sem iniciar em query
ou import. Integra lifecycle do serviço control existente. Shutdown interrompe claims,
solicita cancelamentos, aguarda execuções/drains e só então fecha SQLite. Dois processos
podem consultar fila, mas CAS entrega claim a apenas um. Nenhum auto-retry de incerto.

Backup/restore exige controle parado, banco e workspace consistentes, preservação de
histórico/IDs/configuração e recusa de dois controles ativos. Reabertura revalida fixture
física; não remover pin dev/ino. Relocação não é implicitamente permitida.

## Arquivos e verificação

- Estender tools/cli/lib/job-{control,worker,materialization}.js,
  engineering-{control,task-runtime,task-state,workflow-runtime}.js e commands/control.js.
- Novo tools/cli/lib/job-dispatch.js e migration015 candidata para evento aditivo.
- Atualizar consumidores de versão candidata, contratos e testes de compatibilidade.
- Regenerar tools/cli/command-manifest.json pelo compile:cli após mudança em control.js.
- test/test-job-faults.js cobre despacho task/workflow, aceite falso, cancel/expiry/drift,
  crash antes/depois intent/efeito/recibo, owner vivo/morto/desconhecido, dois processos,
  shutdown, backup/restore, idempotência e negação das entradas antigas.
- Gate90/80 por arquivo crítico incluindo não executados; mutantes de despacho sem
  claim, settlement sem aceite e retry incerto devem falhar.
- Node22 e24 sequenciais, isolamento contido, sem contas pagas nesta unidade.
- Comandos: node --test --test-concurrency=1 test/test-job-faults.js
  test/test-job-materialization.js test/test-job-recovery.js; npm run test:kernel-coverage;
  VALIDATION_ENFORCED=true scripts/governance/quality-gates.sh.
- Revisão isolada cega e confronto dos recibos antes de commit. Resultado planejado
  não equivale a evidência executada; limitações ficam explícitas no recibo.
