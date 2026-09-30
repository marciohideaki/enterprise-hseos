# W4-04a2b — consumo de revisões pelo engine

Base: integração W4-04a2a `6bba910d`; FR04/05/06; `workflow.md` e
`workflow-reservations-implementation.md`. Reutilizar WorkflowEngine,
RelationalSessionEventStore e cadeia de definições já persistida. Esta unidade
não admite ainda expansão running pelo JobControl nem materializa tarefas novas.

O engine aceita uma definição de entrada somente se seu digest pertencer à cadeia
persistida da reserva. Se houver revisão, a definição efetiva é sempre a última
persistida, independente da versão enviada pelo caller. Antes de manifest/efeitos,
rejeitar entrada que não pertença à cadeia. Após claim, consultar a definição
corrente em cada fronteira de fase; uma revisão append-only que chegue durante uma
fase não altera o trabalho iniciado, mas suas fases novas são executadas depois.

Checkpoint guarda o digest da definição que continha a fase no início dela, mesmo
que uma revisão seja gravada durante join. Replays anteriores permanecem imutáveis.
Spawn/join/checkpoint exigem o claim vigente e uma definição ainda presente na
cadeia. Cancelamento durável bloqueia novo spawn. Release completed exige que todas
as fases da definição corrente tenham checkpoint; conflito CAS por nova revisão
faz o engine reler a reserva e prosseguir, sem liberar como failed nem repetir
filhos já aceitos. Falha/cancelamento usam o digest corrente e drenam como antes.
Claim, prazo e tetos não são renovados. Não executar uma definição fornecida apenas
em memória. V1 sem revisões continua igual.

Testes em `test/test-workflow-reservations.js`: revisão antes de run; revisão durante join e antes de checkpoint; revisão
no intervalo anterior ao release; entrada forjada; checkpoint histórico preservado;
cancelamento bloqueando novo spawn; retomada com definição v1 e reserva revisada.
Node 22/24, 90/80 por arquivo crítico, mutantes dirigidos, revisão isolada, gates
e hook governados antes do commit.
