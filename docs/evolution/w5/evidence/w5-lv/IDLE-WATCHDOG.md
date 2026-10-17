# Pesquisa: ociosidade de agentes (liveness / watchdog) no HSEOS

Data: 2026-10-12. Pesquisa somente leitura. Caminhos relativos a /workspace/github/marciohideaki/enterprise-hseos (REPO) e /workspace/local/references (REF).

## 1. Fatos verificados

### 1.1 O incidente (transcript)
- agent-aw5-02b-f778ea9b8457b029.jsonl linha 486 (06:05:00Z): "O commit da 02b1 esta rodando o pre-commit completo em segundo plano. Aguardo terminar." Ultimo turno do agente.
- Linhas 491-492: dois `attachment.type=queued_command` (`<task-notification>`, status completed; Monitor "commit-done") com timestamp original 06:06:10Z e 06:06:18Z, mas gravados DEPOIS da linha 490 (16:45:31Z). Ou seja, o aviso ficou na fila e so foi entregue quando o agente acordou.
- Linha 487 (16:45:24Z): `<teammate-message teammate_id="team-lead">` (SendMessage) foi o unico gatilho. Ociosidade: 06:06:10Z -> 16:45:24Z = 10h39m entre o aviso e a reacao.
- Padrao repetido: linhas 468-472 (03:41-03:56Z) sao Monitors que "expired after 30m with no events"; linhas 560-561 e 611-612 (16:59Z, 18:19Z) mostram o mesmo atraso entre fim da tarefa e entrega.
- Esperas em segundo plano nao sao esperas "ativas": o turno termina e a unica fonte de acordar e uma mensagem nova.

### 1.2 O que o HSEOS ja tem (Q1 e Q2)
- REPO/repository-contract.yaml (7 linhas): so `identity.remotes` e `capabilities.manifest`. Nada sobre heartbeat, lease, timeout de ociosidade, watchdog ou SLA de reporte. AGENTS.md: nenhuma ocorrencia desses termos (unico hit textual, linha 98, e a palavra "isolated").
- REPO/.hseos/workflows/dev-squad/workflow.md:105-109: contrato de heartbeat "oportunista" (a cada tool use via shim; "para subagentes longos que nao chamam tools, emitir no G2 e no inicio de cada tarefa"); stale default 10 min. Linha 121: `hseos state-list --orphans`. Linha 97: shim com timeout 5 s, exit 0 em qualquer erro (nao bloqueia). G3 (linha 69) e so revisao humana de WAVE-REPORT, sem SLA de reporte.
- REPO/tools/mcp-project-state/lib/stale-detector.js:19-34: `sweepOrphans` so muda `status='orphaned'` quando `last_heartbeat_at < now-10min`; ignora heartbeat NULL; nao acorda nem escala ninguem.
- REPO/tools/mcp-project-state/lib/scheduler.js:1-9 e index.js:220-221: o sweep roda por `setInterval` de 5 min dentro do servidor MCP project-state; so existe enquanto esse servidor esta de pe.
- REPO/tools/mcp-project-state/lib/agent-state-dal.js:113-115 (`recordHeartbeat` + evento `heartbeat`), 349 (`heartbeatSession`), 386-392 (`sweepOrphanSessions` default 1440 min = 24 h, comentario: "an idle-but-open terminal only heartbeats on...").
- REPO/.claude/hooks.json:268-274 (Stop): `state-emit-hook.sh Stop` + telemetry + session-track.sh. `.agents/hooks/registry.yaml:456` (`stop-all-session-track-heartbeat-turn-end`): heartbeat de `as_sessions` NO FIM DO TURNO. Efeito colateral: o instante em que o agente fica ocioso e registrado como "vivo"; o detector de 10 min nao o pega por 24 h na tabela de sessoes. Nenhum hook `TeammateIdle`/`SubagentStop` registrado (grep em REPO/.claude, .codex, .agents/hooks: zero ocorrencias).
- Primitivas reaproveitaveis no core:
  - Lease/fence/deadline: REPO/.specs/features/harness-w4/jobs.md:45-48 (claim com fence monotonico, `lease_expires_at`), :34-36 (`execution_deadline_at`), job-claims-implementation.md:39-41 (invariante: "lease vencido nao prova morte"; dono vivo ou desconhecido bloqueia takeover).
  - Worker hospedado: REPO/packages/delegated-runtime-host/index.js:24 (`MAX_WORKER_LEASE_MS=300000`), :42-47 (`WorkerLeaseSchema`, lease_epoch/ttl/expires_at), :99-102 (eventos `delegated.worker.heartbeat|drain_requested|parked|orphaned`). Vale para workers de runtime hospedado, NAO para teammates do Claude Code.
  - Control API: REPO/docs/engineering-control-api.md:64-67 (`GET /v1/tasks/{id}/events?after=&limit=` com cursor recuperavel), :100 (`cancel`). Serve de barramento de eventos para um watchdog.
  - Swarm: REPO/tools/mcp-hseos-swarm/tools/dispatch_wave.js, get_run_state.js, list_runs.js (estado de run); `.agents/hooks/handlers/swarm-gate.sh` (gate Agent PreToolUse).
- REF/HSEOS_VS_CLAUDE_CODE_ANALYSIS_2026-08-24.md:55 ("sem fleet/lease remoto generico: gap"), :103 (`notify_when_idle` one-shot), :112 (heartbeat/lease listados), :217 (hosted worker lifecycle adotado: leases, heartbeat, drain, orphan, fencing). O gap foi identificado para workers hospedados; o caso "teammate ocioso do harness" nao aparece.

### 1.3 Referencias (Q3)
- rea (REF/rea): e "REA: Reverse Engineer Anything" (README.md linha ~5; Ghidra/Frida, adb). NAO trata liveness, idle nem supervisao de agentes (grep por heartbeat/watchdog/liveness/stall/lease em rea/src e rea/docs sem hits relevantes). Escopo: src, docs, AGENTS.md. Nao serve de evidencia.
- claude-code / claude-code-20260925 (so CHANGELOG e plugins; sem codigo-fonte do harness):
  - 20260925/CHANGELOG.md:3324 Stop/SubagentStop podem devolver `additionalContext` "to keep the turn going"; :3681 entrada de Stop/SubagentStop passa a incluir `background_tasks` e `session_crons`; :5544 `TeammateIdle` e `TaskCompleted` aceitam `{"continue": false, "stopReason"}`; :2880 "messaging a stuck teammate wakes it to retry immediately"; :3077 tarefas de fundo de teammate eram mortas ao fim do turno (corrigido); :1503 resposta final do teammate chega na idle notification; :640 Monitor entrega saida final e exit em uma notificacao.
  - claude-code/CHANGELOG.md:526 e :741: `/goal` — sessao ociosa com goal parado atras de trabalho de fundo faz check-in automatico apos 30 min, depois 1 h, 2 h (max 3 por goal). E o unico mecanismo nativo de "auto-acordar" encontrado, e e da sessao principal, nao documentado para teammates.
  - claude-code-20260925/CHANGELOG.md:3886: `/loop` evita wake-ups redundantes "para tarefas de fundo que ja notificam na conclusao" — a premissa do harness e que a notificacao acorda; o transcript 1.1 mostra que isso falhou para o teammate. Nao ha entrada no changelog explicando; isso e inferencia (ver 2).
  - TeammateIdle existe como evento (REF/repo-radar/repos/claude-code-best-practice/.claude/hooks/HOOKS-README.md:23, requer CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1, so command hook). A semantica exata de exit code 2 nao esta na referencia local: nao verificado.
- openai-codex (REF/openai-codex): `.codex/skills/babysit-pr/SKILL.md:15,26,39-40`: "nao pare porque um snapshot retornou idle"; usar `--watch` na MESMA turn, "nao deixe --watch destacado e termine o turno". E pratica de "espera em primeiro plano", sem watchdog externo. Sem heartbeat/lease de agente no escopo pesquisado (grep rs/md/ts).
- symphony (REF/symphony/SPEC.md): padrao mais proximo do que precisamos. Orquestrador unico com estado autoritativo (:51), `codex.stall_timeout_ms` default 300000 (:633), "se elapsed_ms > stall_timeout_ms, encerra o worker e agenda retry" (:828), `stall_timeout_ms<=0` desliga (:829), reconciliacao antes do dispatch a cada tick (:729, :744), backoff exponencial max 5 min (:625), "uma run NAO PODE ficar parada indefinidamente esperando input" (:1137), terminal reason distinto `Stalled` (:689).
- OpenHarness (REF/OpenHarness/src/openharness/swarm/in_process.py:110, :263-285, mailbox.py:34, :263): status `idle`, `idle_notification` escrita no mailbox do lider no `finally` (entrega deterministica no encerramento), shutdown com timeout (:530-577). Cobre "agente avisa que ficou ocioso"; nao cobre "agente que nunca avisa".
- harness externo (snapshot 20260925, fora deste repositório): packages/guard/timeout-policy/src/index.ts:1-30 (deadline cooperativo por tool-call, TOOL_TIMEOUT); packages/hooks/hooks-claude-code/README.md:62-64,87,157 (`Stop` pode forcar outro passo via `steer()`, `SubagentStop` e so observacao). Nota do vault sobre esse harness (_sources, 2026-08-24): nada sobre liveness (so supervisor de credencial, linhas 54 e 60). As duas comparações de harness do vault (HSEOS_VS_* e HSEOS_V4_HARNESS_COMPARISON): sem tratamento do caso.
- claude-agent-sdk-python: types.py:377-380 (`SubagentStopHookInput`), types.py:2213 (progress heartbeat de tool_use Agent), _internal/transport/subprocess_cli.py:853 (espera por `session_state_changed idle`). Fornece sinal de "idle", nao politica.
- Chorus: sem hit relevante a liveness de agente (grep heartbeat/stall/lease/watchdog so cai em specs de release/daemon, nao lidos a fundo: lacuna).

Conclusao Q3: nenhuma referencia local trata exatamente "teammate ocioso que perdeu a notificacao". Os melhores insumos sao Symphony (stall timeout + reconciliacao deterministica), OpenHarness (idle_notification em `finally`), claude-code (Stop com additionalContext, `background_tasks` no input do Stop, `/goal` check-ins) e Codex babysit-pr (esperar em primeiro plano).

## 2. Inferencias (nao verificadas)
- I1: a notificacao de tarefa de fundo/Monitor e enfileirada (`queued_command`) mas so e drenada no proximo turno do teammate; no harness atual um teammate ocioso so acorda por mensagem. Causa interna do harness nao visivel nos arquivos locais. Um spike de 5 min confirma (teammate lanca `sleep 20 &`, encerra, ver se acorda).
- I2: um `CronCreate`/`/loop` armado pela sessao do lider acordaria o lider (cron e tratado como task-notification, changelog:3078), mas nao esta provado que acorde um teammate; o watchdog deve, portanto, acordar o teammate via SendMessage emitido pelo LIDER, e o lider precisa de gatilho proprio (cron/hook), senao reproduz o problema (item 4 do enunciado).
- I3: Stop hook com `background_tasks` no input (changelog:3681) permite recusar encerramento quando ha tarefa de fundo sem estado terminal declarado. Aplica-se a teammates/subagentes se o harness dispara Stop neles (SubagentStop/TeammateIdle). Precisa de teste.
- I4: o pre-commit de ~11 min e a causa raiz do uso de fundo. Nao propor afrouxar gate (AGENTS.md 3h); propor apenas executar em primeiro plano em blocos.

## 3. Recomendacao: capacidade "agent-liveness" (aditiva)

Principio: contrato "no silent idle". Todo agente despachado so pode encerrar turno com um destes estados declarados:
`DONE` | `BLOCKED{motivo}` | `WAITING_ON{condicao, wake_via, deadline_at}` | `FAILED{motivo}`.
Qualquer fim de turno sem estado terminal (ou WAITING_ON vencido) e violacao observavel.

### 3.1 Camadas
1. Contrato declarativo (core, arquivo canonico). Novo `.hseos/config/agent-liveness.yaml` com: estados terminais, `report_sla_s` por tier, `foreground_wait_max_s` (ex. 540, abaixo do limite de 600 s do Bash), `idle_grace_s`, `stall_timeout_s` (padrao 300, estilo Symphony), `max_wake_attempts`, `escalate_to`. Referenciar de `repository-contract.yaml` via entrada de capability em `.agents/capabilities/components.yaml` (nao assumir que o schema `repository-contract/v1` aceita chave nova: verificar antes; hoje so tem identity e capabilities.manifest).
2. Eventos e lease (core, aditivo ao schema state v4). Reusar `as_agent_runs.last_heartbeat_at` e `recordHeartbeat`; adicionar eventos `wait_declared{condition,deadline_at,wake_via}`, `report{state}`, `wake_sent`, `idle_violation`. Modelar o lease como `delegated.worker.heartbeat` (ttl <= 300 s) e respeitar a regra "lease vencido nao prova morte": vencido = overdue/escalar, nunca takeover automatico. Corrigir a semantica: heartbeat de fim de turno nao pode contar como prova de vida (registrar `turn_end` separado de `heartbeat`).
3. Watchdog deterministico (core, fora do LLM). `hseos liveness watch|check` (CLI, loop de poucos segundos a minutos, ou timer systemd/cron) que le o ledger: classifica cada run em running-ok / waiting-ok / waiting-overdue / idle-sem-estado / done. Acoes: (a) gravar `wake-request` em `.hseos/state/liveness/inbox` e evento; (b) notificar o humano (Notification hook / desktop) quando o lider tambem esta parado; (c) NUNCA matar nem retomar sozinho. Reconciliacao antes de agir, como Symphony :729.
4. Entrega do acordar (hook/harness). O watchdog nao consegue chamar SendMessage; o lider tem de fazer. Recomendar: lider arma um gatilho proprio (CronCreate recorrente 5-10 min ou /loop) cujo prompt e "rode `hseos liveness check --json`; para cada wake-request faca SendMessage". Mais um hook `UserPromptSubmit` que injeta wake-requests pendentes. Validar I2.
5. Hooks do Claude Code (adaptador, nao core): `Stop` e `SubagentStop`/`TeammateIdle` (`.agents/hooks/handlers/liveness-stop-guard.sh`, registrado em registry.yaml e gerado em .claude/hooks.json): se existe `background_tasks` ou nao ha estado terminal no ledger, devolver `additionalContext` mandando declarar estado ou esperar em primeiro plano; guarda contra loop (`stop_hook_active`, max 2 recusas). Fail-open com aviso, coerente com o shim existente (workflow.md:97).
6. Prevencao na origem (processo/skill): regra no workflow dev-squad e no prompt de dispatch: proibido encerrar turno "aguardando" tarefa de fundo; esperas em primeiro plano em blocos <= `foreground_wait_max_s` com helper `hseos liveness await --file|--pid --max 540` que devolve "ainda rodando, chame de novo" (mantem o turno vivo); tarefas > 10 min rodam via runner destacado que grava `status.json` (exit code, fim) e o agente declara WAITING_ON com deadline. Monitors longos (30 m) so como complemento, nunca como unico mecanismo.

### 3.2 Core x hook x paridade
| Item | Onde |
|---|---|
| Contrato yaml, estados, eventos, lease, classificacao, CLI watch/check/await, metricas | core (tools/cli + mcp-project-state/ledger) |
| Stop/SubagentStop/TeammateIdle guard, injecao UserPromptSubmit, CronCreate do lider | adaptador Claude Code |
| Codex e outros | sem equivalente verificado de TeammateIdle; paridade por: instrucao em AGENTS.md/skill dev-squad, `hseos liveness await` em primeiro plano, watchdog externo + notificacao. Hook Stop do Codex: lacuna, nao verificada (.codex/hseos-hooks.json so tem session-track) |
| Hosted workers | ja cobertos por delegated-runtime-host; so alinhar vocabulario |

### 3.3 Como medir
- `reaction_latency` = ts(proximo turno do agente) - ts(task-notification/fim da tarefa); `idle_gap` = fim de turno sem estado terminal ate o proximo evento; `waiting_overdue_s`; `violations/run`; `wake_requests_sent / acked`.
- Baseline retroativo sem mudar nada: script que le transcripts de subagents (`attachment.type=queued_command` timestamp vs primeira linha nao-attachment seguinte). No caso 02b: 10h39m. Meta: p95 < 2x intervalo do watchdog; zero turnos terminais sem estado.
- Teste de aceitacao: teammate sintetico que lanca tarefa de fundo e encerra; esperado: guard recusa; se forcado, watchdog emite wake em <= 1 ciclo.

### 3.4 Riscos
- Falso positivo acorda agente em raciocinio longo (mitigar: idle so conta apos fim de turno registrado; grace).
- Tempestade de wakes/custo de tokens (limite max_wake_attempts, backoff como Symphony :625).
- Stop hook em loop (guard de reentrada, limite).
- Dependencia do lider acordar (cron do lider nao provado; fallback: notificacao ao humano).
- Heartbeat de fim de turno ja existente mascara ociosidade; mudar semantica pode quebrar `state-list --orphans` (manter compat, campo novo).
- Schema state v4 e repository-contract/v1: confirmar que mudancas aditivas passam no validador.
- TeammateIdle e experimental e so command hook; comportamento pode mudar entre versoes.
- Nao afrouxar o pre-commit (AGENTS.md 3h): a solucao e esperar melhor, nao gate mais leve.

### 3.5 Encaixe no roadmap (recomendacao, nao decisao)
- Fase P0 (processo + hook + metrica retroativa + spike I1/I2): task aditiva em W5, porque o problema esta ocorrendo agora na propria execucao da W5 e P0 nao altera fluxos existentes.
- Fase P1 (contrato yaml, eventos novos no ledger, `hseos liveness`, watchdog, paridade Codex): W6, por tocar schema de estado e CLI.
