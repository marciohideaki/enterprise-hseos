# Design W2

Contexto proprietário: engenharia HSEOS. Estender EngineeringControl e o executor
agent-isolation-attestation; reutilizar ExecutionEventLedger, política nominal,
lattice de permissões, deadline/max_output_bytes/max_tool_calls do contrato.

## Protocolo e estado

POST /v1/terminals/commands: schema_version=1, command_id UUID, resource_id UUID,
expected_sequence inteiro, action e input estritos. open recebe task_id, command_id,
mode (pty/job), rows/cols. input recebe data base64, resize recebe rows/cols.
Outras ações: pause, continue, interrupt, eof, terminate, recover, reconcile.
GET /v1/terminals/:id e /events?after=&limit= são consultas. Anexação é consulta
cursorada, sem transferência de autoridade; qualquer cliente autenticado compartilha
sequência e idempotência. Rejeitar campos desconhecidos e limites excessivos.

Eventos ControlCommandRecorded v1 em stream control_terminal com payload versionado
kind: opened/intent/receipt/output/exited/recovered/reconciled. Leitores W1 não consomem
esse agregado; não reescrever eventos nem alterar schema operacional v4/candidato 11.
Registro durável de intenção/reserva e owner antes do spawn. Uma intenção sem receipt
permanece incerta, inclusive input/SIGINT/resize. Consultas jamais reaplicam efeitos.
Reconciliação associa digest de relatório, resposta humana e terminais já drenados.

## Executor

Broker Python confiável externo ao sandbox fornece PTY/pipes e multiplexa comandos
JSON. Usa lançamento bwrap/seccomp e cgroups já existentes. Filho entra no grupo
antes do exec; parent-death signal cobre morte do broker. Broker observa EOF do
controlador e deadline independente, mata cgroup e espera drenagem. Interrupção usa
pidfd com pertencimento ao cgroup verificado; cancelamento usa cgroup.kill.
O broker nunca executa fonte de projeto. Um wrapper isolado cria a sessão e
controlling tty com TIOCSCTTY antes do exec, permitindo semântica real de PTY.
Reap de recuperação usa identidade PID/start_ticks e grupo nominal; não mata PID
arbitrário. Saída/entrada e buffers de transporte são limitados. O Node persiste
output antes de disponibilizar cursor. Crash entre saída e persistência significa
saída possivelmente perdida e efeito incerto, nunca execução repetida.

## Orçamento e concorrência

Terminais abrem somente antes de started do parent. Cada open reserva uma chamada
no ledger da tarefa; o runtime soma essas reservas ao orçamento de ferramentas.
Múltiplos terminais compartilham deadline e teto total de chamadas. Mutações CAS
reservam intenção antes de await; cancelamento durável fecha novas admissões.
Parent resume/apply exigem terminais encerrados e reconciliados. Terminate/recover
podem interromper pendências, mas não liquidam efeitos incertos silenciosamente.

## Evidência e segurança

IDs, digest e causalidade no ledger; payload de entrada não é registrado, apenas
hash. Saída é conteúdo privado da candidata, limitado; ambiente do host/credenciais
não entram no sandbox. Erros públicos tipados sem stderr do host. Testes de crash
antes/depois de spawn/efeito/receipt, perda de receipt, cursor, concorrência e árvores
reais comprovam o protocolo. Verificações determinísticas não certificam modelos.
ADR candidata em adr-drafts/terminal-lifecycle.md; rollback desabilita endpoints e
drena recursos, preservando ledger. Nenhuma ativação global.

## Detalhes de implementação verificados por testes de falha

`prepared` registra o cgroup exato antes do spawn. `stopping` é uma barreira durável:
preparação posterior é rejeitada; remoção do grupo impede launcher tardio de entrar.
Recuperação pode cancelar um terminal de outro controlador sem atingir cgroups de
sessões irmãs. Claim de comando e validação da sequência executam em transação
immediate do controle. Registro de execution_started do parent e guarda de reservas
executam na mesma transação do ledger da tarefa.

Controle e tarefa usam fixtures distintos existentes. Reserva conservadora precede
commit do claim no controle; um crash pode gastar orçamento sem lançar processo.
Cancelamento de parent reconhece reservas sem registro de controle e as liquida
como incertas, sem reexecução. Incerteza histórica nunca é apagada por um encerramento
posterior; só uma decisão explícita posterior ao evento incerto pode reconciliá-la.
Consulta de owner morto sem evento final reporta recovery_required e incerteza.

Arquivos W2: executor.js, terminal-executor.js, terminal-broker.py, terminal-control.js,
terminal-budget.js, terminal-attach.js, engineering-control/http/task-runtime/task-state,
commands/control.js e SDKs; testes test-terminal-{executor,control,api}.js e crash-worker.
