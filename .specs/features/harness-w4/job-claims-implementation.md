# W4-03b — ownership, fencing e recuperação de jobs

Tipo: contrato pré-implementação, FR03/05/06/08; jobs.md, ADR-0045 Proposed.
Base d948154 após integração de W4-03a (cbf79f2), gate/hook aprovados. Não certificar worker antes
que os testes de dois processos e morte/drenagem estejam executados.

## Reuso

- JobControl/ExecutionEventLedger: mesmo stream control_job e CAS transacional;
  receipts existentes continuam compatíveis.
- executorOwner/isExecutorOwnerAlive/reapExecutorOwner do executor: identidade
  PID/start_ticks/resource_parent e verificação/drenagem de cgroups existentes.
  Reutilizar schema de ownership existente via exportação do dono, se necessário;
  não duplicar interpretação de /proc ou um executor paralelo.
- EngineeringControl.admitCreation: dados atuais comparados ao pin original;
  projectWorkspaceSnapshot e contratos existentes conferem baseline antes do efeito.
- Campanha permanece original; claim não reserva chamada monetária.

## Fronteira

Esta task acrescenta ownership e recuperação à fila, não execução externa nem
materialização. JobWorker fornece operações internas de claim/reconciliação e
projeção reconstruível de elegibilidade. A integração de despacho no serviço e
materialização idempotente são W4-03c; interfaces públicas, W4-06a.

Nova migration aditiva registra evento de ciclo de vida versionado. Preservar
leitura de JobCommandRecorded v1 e resultados originais de create/cancel, mesmo
quando eventos internos avançam a sequência. Atualizar expectativas de versão
candidata de testes/dry-run/rehearsal, mantendo banco operacional v4 e seus gates.

## Invariantes

1. Claim só com sequência esperada, queued elegível, dependências verificadas,
   pin/baseline atuais, autorização ainda válida e prazo não vencido. A transação
   revalida sequência/cancelamento/prazo após qualquer admissão assíncrona.
2. Persistir fence inteiro monotônico, owner e lease; nenhuma credencial no evento.
   Primeiro claim fixa first_started_at e execution_deadline_at como mínimo do
   deadline absoluto e duração admitida. Recuperação/renovação não prorrogam isso.
3. Lease vencido não prova morte. Owner vivo ou identidade desconhecida bloqueiam
   takeover; erro ao observar identidade não vira owner morto. Null owner não é morto.
4. Owner comprovadamente morto exige reconciliação explícita e drain comprovado
   antes de trocar fence. Não assumir que a morte do controlador encerrou os filhos.
   Resource parent incompatível/ilegível mantém bloqueio/uncertainty.
5. Incerteza após possível efeito nunca permite retry externo automático. Como
   esta task ainda não despacha, registrar a fronteira de claim sem fingir recibo
   de execução ou resultado verificado. W4-03c estenderá reconciliação de efeitos.
6. Cancelar claimed não pode simplesmente escrever cancelled se houver trabalho
   com dono vivo. Persistir solicitação e encerrar somente após drain demonstrado;
   terminal nunca volta à fila. Expirado não adquire novo claim.
7. Dois controladores independentes, mesma base SQLite: só um claim vence. Fence
   antigo falha em qualquer operação interna posterior. Queries não iniciam worker.

## Saídas

- tools/cli/lib/job-worker.js, job-control.js; tools/lib/job-contract.js se necessário.
- Schema de owner exportado do módulo existente quando reutilizado.
- Migration pending-activation aditiva e expectativas relacionadas de compatibilidade.
- test/test-job-recovery.js e helper de processo explicitamente local de testes.
- package.json, .c8-kernel.json, teste de superfície do pacote, STATUS/evidence.

## Verificação

Node22/24 sequenciais, em cgroup delegado limitado a 3GiB/CPU não zero/nice19.
Testes: dois processos disputam claim; stale seq/fence; antes do horário; expirado;
owner vivo com lease vencido; morto com filho sobrevivente; identidade desconhecida;
reabertura da base; reconciliação sem repetir efeito; cancelamento durante claim;
prazo fixo após recuperação. Cada caso deve observar ledger e processos reais
quando o critério depender de vida/morte/drain, sem substituir a prova por contadores.

Cobertura --all 90% linhas/80% branches por crítico; revisão cega/confronto e gate
integral antes do commit. Não iniciar testes simultâneos ao gate da task anterior.

## Revisão preventiva — precisões aceitas

- Owner vivo: reapExecutorOwner recusa reaping. Cancelamento será solicitação
  persistida e confirmação cooperativa pelo owner com fence atual. Nesta fase
  sem dispatch, prova é ausência de trabalho iniciado; não produzir recibo fictício
  de execução/drain. Owner inacessível mantém bloqueio.
- Reaper drena por PID/start_ticks, não por job. Pode encerrar descendentes de
  outros jobs do mesmo processo morto; eles mantêm ownership/fence antigos até
  sua própria reconciliação. Não atribuir confirmação individual por inferência.
- admitCreation fixa associação/pin, mas não garante campanha executável. Claim
  consulta autoridade original para cancelamento/prazo/incerteza pendente, sem
  reserva monetária. Revalidar após await e na fronteira transacional.
- Reconciliação também usa fencing: persistir intenção com sequência/fence; após
  observar morte e aguardar reaper, conferir novamente sequência, owner,
  cancelamento e prazo antes do novo fence. Dois recuperadores podem drenar
  idempotentemente, mas somente um consolida recuperação.

Ponto de reuso monetário identificado: ProviderCampaignControl.admitDispatch
confere scope, manifests, cancelamento, pendências, prazo e limites sem reservar
nem inspecionar provider. Worker pode chamá-lo com binding original registrado e
resource_id autorizado, sem invocar adapter.validateDispatch (exige request já
preparado) nem adapter.inspect. Verificação de conta/quota no despacho continua
no fluxo original de campanha, antes do efeito. Não copiar os cálculos monetários.

## Comandos da task

```bash
node --test --test-concurrency=1 test/test-job-recovery.js test/test-job-control.js test/test-engineering-plugin-model.js
node --test --test-concurrency=1 test/test-engineering-*.js test/test-job-*.js test/test-agentic-activation-rehearsal.js test/test-compatibility-audit.js test/test-execution-event-ledger.js test/test-execution-projections.js test/test-governed-execution-runtime.js test/test-native-entrypoint-wiring.js test/test-operational-state-db.js test/test-package-surface.js
VALIDATION_ENFORCED=true ./scripts/governance/worktree-manager.sh validate hseos-w4-job-claims
```

Executar em Node24 e depois22, usando heavy-run/cgroup conforme acima. Cobertura
c8 --all inclui job-worker.js, job-control.js e engineering-task-state.js, com
--check-coverage --per-file --lines=90 --branches=80. As suítes não certificam
materialização nem a campanha real W4. JobLifecycleRecorded v1 usa migration013.
Reconciliação persiste recovering antes de drain; receipt final depende de mesma
sequência/fence após await. Comando interrompido pode ser retomado explicitamente;
nenhum poll despacha ou retoma efeitos automaticamente.
