# Symphony x HSEOS: análise de lacunas (somente leitura)

Data: 2026-10-12. Análise sem edição de repositórios, sem commit, sem suítes. Caminhos relativos a SYM=/workspace/local/references/symphony e REPO=/workspace/github/marciohideaki/enterprise-hseos (HEAD `c67fa51f`, master). A spec da trilha LV foi lida no worktree `REPO/.worktrees/hseos-w5-contracts` (`liveness.md`, commit `231de2e3`); os worktrees `hseos-w5-lv1` e `hseos-w5-lv2` existem, mas não li código novo deles.

## 0. Escopo lido (e não lido)

Lido por inteiro: `SYM/SPEC.md` (2312 linhas, 1-2312, sem pular seção, incluindo o Apêndice A); `liveness.md`; `/tmp/hseos-w5/research/IDLE-WATCHDOG.md`; `harness-w5/spec.md`; `docs/evolution/PLAN.md`; `jobs.md` (W4).

Lido em parte:
- `SYM/elixir`: README, WORKFLOW.md, `config/schema.ex` (campos), `orchestrator.ex` (índice de funções e linhas 208-256, 581-660, 1034-1074, 1232-1245), `workflow_store.ex` (início), `agent_runner.ex` (142-156), `docs/token_accounting.md` e `docs/logging.md` (início).
- `workspace.ex`, `codex/app_server.ex`, `path_safety.ex`, `ssh.ex`: só por grep de funções, sem leitura do corpo.
- Não lidos: `status_dashboard.ex` (1941 linhas), `presenter.ex` (só grep), adapters Linear/GitHub/Jira/Asana/GitLab, testes e `.codex/`/`.github/`.
- HSEOS: `design.md` e `tasks.md` da W5 só por títulos (o worktree original foi removido durante a análise); `requirements.json` só os 27 `acceptance` (F01-F27); `job-claims-implementation.md` só 37-42; `job-worker.js` 119-239; `job-dispatch.js`, `job-control.js` e `engineering-workspace.js` só por grep.
- Axon não foi usado; usei grep com `BYPASS_AXON=1`. Qualquer "não encontrei" abaixo significa "grep nos diretórios `packages`, `tools/lib`, `tools/cli/lib`, `tools/mcp-*` não achou", não "provado ausente".

Legenda: COBERTA / PARCIAL / AUSENTE / N-A (não aplicável). Na coluna "Quem cobre": LV, W5, W6, W7, fora (nenhuma trilha atual).

## 1. Diferença estrutural que condiciona tudo (fato)

O Symphony é dono do loop: ele sobe o processo do agente (`codex app-server`), recebe todos os eventos por stdio e decide continuar, reiniciar ou matar (SPEC 10.1, 10.3, 16.5). O HSEOS, no caso dos teammates do Claude Code, não é dono do loop: o harness conduz o agente e o HSEOS só enxerga hooks e transcripts. Por isso as peças do Symphony que dependem de "matar o worker e reiniciar" (stall -> retry, backoff de reexecução) não se transplantam; o que se transplanta é a ideia de reconciliar contra a fonte de verdade e de classificar com razão tipada. A trilha LV já reflete isso ao trocar "kill + retry" por "wake + escalar" (`liveness.md:41`, `:104`).

Segundo fato: o HSEOS recusa retry automático de reexecução de propósito. `jobs.md:56` ("Sem retry externo automático"), `tools/cli/lib/engineering-model.js:8-9` (`max_attempts: 1` porque tentativa incerta não pode reiniciar orçamento) e `workflow-linked-retry-implementation.md:3-8` (retry é comando explícito que cria job novo ligado por `retry_of`). O retry/backoff do Symphony (SPEC 8.4) é portanto uma capacidade deliberadamente divergente, não uma omissão.

## 2. Matriz de capacidades

### 2.1 Orquestração e liveness

| # | Capacidade Symphony (SPEC / Elixir) | HSEOS (evidência) | Status | Quem cobre |
|---|---|---|---|---|
| C01 | Orquestrador único com estado autoritativo em memória; só ele muta o scheduling (SPEC 51-52, 280-293, 637-638, 725-729) | Estado durável no ledger SQLite com `expected_version`: `tools/mcp-project-state/lib/execution-event-ledger.js:276`; jobs `jobs.md:42-57`. Não há orquestrador daemon único; a coordenação de squads é humana/LLM (`.hseos/workflows/dev-squad/workflow.md:78-86`) | PARCIAL (autoridade durável sim, daemon de dispatch não) | fora (W4 entregou ledger e comandos; sem tick) |
| C02 | Tick loop: reconcilia -> valida -> busca candidatos -> ordena -> despacha -> notifica (SPEC 735-752; `orchestrator.ex:83-126`, `tick_token`) | Único loop periódico é o `setInterval` do sweep de órfãos, só enquanto o MCP project-state está de pé: `tools/mcp-project-state/lib/scheduler.js:46,62`. Claims/dispatch de jobs são por comando explícito (`tools/cli/lib/job-worker.js:205-239`); não achei laço que varra jobs `queued` | AUSENTE para dispatch; PARCIAL para vigia | LV2 (`watch`, liveness.md:104) cobre o vigia; dispatch autônomo fora |
| C03 | Reconciliação antes do dispatch, a cada tick, contra a fonte de verdade (SPEC 729, 744, 819-839; 16.3 L1865-1890) | LV2 aceite "reconcilia antes de agir, comparando HEAD/pid/arquivo de status": `liveness.md:112`. Reconcile de jobs existe como comando: `job-worker.js:216-230`, `job-dispatch.js:338,357` | PARCIAL (LV cobre liveness; job não tem periodicidade) | LV2 + fora |
| C04 | Detecção de stall: `now - (last_event ou started_at) > stall_timeout` (default 5 min; <=0 desliga), checada a cada tick (SPEC 489-491, 823-829; `orchestrator.ex:581-650`) | LV: `stall_timeout_s=900`, "fim de turno sem evento novo = stalled" (`liveness.md:32`). Sweep legado: `stale-detector.js:19-34` (10 min, ignora heartbeat NULL) | PARCIAL: LV só detecta stall depois do fim do turno (idle); o Symphony detecta silêncio durante o turno | LV (ver 3.2) |
| C05 | `turn_timeout` = silêncio máximo no stream, zerado a cada saída; não é teto de duração total (SPEC 1023, 1147-1149) | `packages/runtime-providers/claude-cli-driver.js:311`: timeout total, sem reset por saída. `codex-app-server-driver.js:331-358`: só timeouts de 1 s para interrupção. Não achei timeout de silêncio | AUSENTE | fora (F01/F18); P1 |
| C06 | Terminal reasons distintos: Succeeded/Failed/TimedOut/Stalled/CanceledByReconciliation (SPEC 676-692) e categorias de erro normalizadas (1151-1161) | LV: 4 estados declarados + classificador de 6 (`liveness.md:18,104`); `reason` é texto livre. Em outras áreas há códigos tipados (`JOB_*`, `ENV_*`) | PARCIAL | LV (falta `reason_code` tipado; ver 3.4) |
| C07 | Retry de falha com backoff exponencial `min(10000*2^(n-1), cap)`, cap 5 min, sem jitter (SPEC 797-801; `orchestrator.ex:1240-1243`) | Recusado por desenho (ver seção 1). Backoff existe só para o provider HTTP (`openai-compatible-provider.js:170-176,234,404`, `max_attempts<=5`) e para wake na LV (`liveness.md:36`) | N-A (reexecução automática); wake com backoff COBERTA | LV |
| C08 | Continuation retry: após saída normal, re-agenda em 1 s e re-checa se a issue segue ativa (SPEC 664-674, 799, 2002-2007; `orchestrator.ex:208-221`) | Sem equivalente de "reabrir porque a fonte de verdade diz que não acabou". Mais próximo: Stop guard recusa fim de turno sem LIVENESS (`liveness.md:88`) e wake request (`:57`) | PARCIAL | LV (ver 3.1) |
| C09 | Continuação dentro do worker: re-checa o tracker após cada turno e abre novo turno no mesmo thread, até `max_turns` (SPEC 451-454, 1026-1031; `agent_runner.ex:101-173`, texto de continuação em `:144-152`) | `max_turns` por sessão existe (`packages/agent-runtime/runtime.js:24,1070`; `engineering-workflow-runtime.js:84-109`). Condição "continue enquanto o estado externo estiver ativo" não existe | PARCIAL | fora |
| C10 | Estado "blocked" para input/approval pendente: fica reivindicado, é isento de stall, aparece no snapshot e na API (SPEC 1073-1075 exige que não fique parado indefinidamente; impl. `orchestrator.ex:234-240,600-606,757`, README "blocked") | LV declara `BLOCKED` (`liveness.md:18`), mas o classificador (`:104`) lista running/waiting_ok/waiting_overdue/stalled/idle_no_state/done, sem `blocked`/`failed`. Prevenção no provider: `approvalPolicy:'never'` (`codex-app-server-driver.js:229,307`), `experimental_request_user_input` desligado (`codex-acp-composition.js:35`) | PARCIAL | LV (lacuna P0, ver 3.5) |
| C11 | Claims com `claimed`/`running`/`retry_attempts`, anti-duplicação (SPEC 640-660, 725-728) | Superior: claim com fence monotônico, `lease_expires_at`, PID/start_ticks, "lease vencido não prova morte" (`jobs.md:45-49`, `job-claims-implementation.md:37-42`, `job-worker.js:41-44,133,171-179`) | COBERTA (e mais forte) | W4 |
| C12 | Elegibilidade: estado ativo, `dispatchable`, `required_labels`, não-claimed, slots (SPEC 754-769) | Elegibilidade de job: `not_before`, `deadline_at`, dependências `succeeded` (`job-control.js:315-322`; `jobs.md:34-38`). Sem labels/tracker | PARCIAL (outro modelo) | W4 |
| C13 | Prioridade: 1..4 asc, depois `created_at`, depois identificador (SPEC 771-775; `orchestrator.ex:796-814`) | Não achei campo `priority` em jobs/scheduler (grep em `job-*.js`, `scheduler.js`) | AUSENTE | fora; P2 |
| C14 | Concorrência global e por estado (`max_concurrent_agents`, `_by_state`) (SPEC 448-462, 777-788) | Global apenas: `packages/governed-execution/scheduler.js:69,210` (default 4, efeitos governados); worker de jobs default 1 (`jobs.md:57`); regra de máquina `heavy-run` fora do repo (AGENTS global 3f). Por estado: não achei | PARCIAL | fora; P2 |
| C15 | Requeue por falta de slot com erro explícito (SPEC 2040-2044) | N-A: sem fila de dispatch autônoma (C02) | N-A | - |
| C16 | Revalidação do issue imediatamente antes do dispatch (SPEC 805-811; `orchestrator.ex:920-940,1006-1024`) | `JobWorker.admit` recompara digest de admissão e baseline antes de claim/recover (`job-worker.js:143-157`); `JOB_BASELINE_DRIFT`, `CONTROL_PROVIDER_BINDING_DRIFT` | COBERTA (e mais forte) | W4 |
| C17 | Run attempt com `attempt` null/1..n e fases de lifecycle (SPEC 231-244, 676-690) | Estados do job `queued...succeeded` + `uncertain` (`jobs.md:21-27`); tentativa nova = job novo (`workflow-linked-retry-implementation.md`) | COBERTA (modelo diferente) | W4 |
| C18 | Live session: `session_id`, `last_event`, `last_timestamp`, `turn_count`, pid (SPEC 245-265) | Heartbeat em `as_agent_runs.last_heartbeat_at` (`agent-state-dal.js:113-115`), mas `turn_end` o renova (`.agents/hooks/registry.yaml:456`). LV2 separa `turn_end` de heartbeat (`liveness.md:42`) | PARCIAL | LV2 |
| C19 | Token accounting: preferir totais absolutos, deltas contra o último reportado, ignorar `last_token_usage`; agregado por orquestrador (SPEC 1419-1443; `docs/token_accounting.md`) | Caminho de engenharia: `thread/tokenUsage/updated` com checagem de identidade (`codex-app-server-driver.js:412-427`), `accounting.total_tokens` e estimativa de uso incerto (`engineering-reconciliation.js:149`), limites `max_tokens` agregados (`engineering-workflow-runtime.js:84-109`). Teammates Claude Code: `tokens_in/out` "se conhecido" (`.hseos/workflows/dev-squad/workflow.md`, tabela "Per-phase emission contract", linha não registrada) | COBERTA no kernel; PARCIAL nos squads de harness | fora (F13 no kernel); P1 para squads |
| C20 | Rate limits: último snapshot de rate limit visto em qualquer evento, exposto no snapshot (SPEC 292-293, 1445-1448) | Leitura e falha fechada, sem snapshot agregado: `codex-app-server-driver.js:249` (`account/rateLimits/read`), `claude-cli-driver.js:223-255` (`rate_limit_event`, `quota_unavailable`), 429 retryável em `openai-compatible-provider.js:114`. `claude-cli-driver.js:230` guarda `allowed_warning`, sem superfície | PARCIAL | fora; P1 |
| C21 | Snapshot sincronizado: `running[]`, `retrying[]`, `codex_totals`, `rate_limits`, erros `timeout/unavailable` (SPEC 1390-1409) | `GET /api/state` em `tools/state-ui-server/index.js:170` com runs, agent_runs, órfãos (`lib/snapshot.js:70-97`); eventos por cursor em `docs/engineering-control-api.md:64`. Sem retry rows/totais de token/rate-limit | PARCIAL | W6 (UI) / LV2 (`liveness check --json`) |
| C22 | Superfície de status humana (dashboard terminal/web) alimentada só do estado do orquestrador (SPEC 1411-1417, 1488-1494; `status_dashboard.ex`, `live/dashboard_live.ex`) | `tools/state-ui-server` e `tools/usage-dashboard` (Python) existem; W6 traz Code OSS com planejamento/revisão/evidências (`PLAN.md` W6). Nada mostra "ocioso há X / overdue" | PARCIAL | W6; LV pode alimentar |
| C23 | API HTTP: `GET /api/v1/state`, `GET /api/v1/<id>`, `POST /api/v1/refresh` (coalescente) (SPEC 1496-1632) | Control API v1 com tasks/jobs/terminals/events (`docs/engineering-control-api.md:58-64,242-274`), autenticada. Sem endpoint de "refresh/reconcile agora" | PARCIAL | LV2 (`liveness check/watch`); P1 |
| C24 | Logs estruturados com `issue_id`/`issue_identifier`/`session_id`, `key=value`, sink que falha sem derrubar (SPEC 1359-1388; `docs/logging.md`) | Eventos no ledger com `correlation_id`/`causation_id` (`job-worker.js:190-195`); sem convenção de log textual. Hooks fail-open (`workflow.md:97`) | PARCIAL | fora; P2 |
| C25 | Recuperação após restart sem DB: terminal cleanup de workspaces + repolling + redispatch; retry/timers/sessões NÃO sobrevivem (SPEC 1690-1704); TODO persistir retry queue (L2239) | Superior: fila reconstruída do ledger (`jobs.md:57`), crash classificado como `uncertain`, reconcile sem repetir efeito (`jobs.md:26-27,52-56`) | COBERTA (e mais forte) | W4 |
| C26 | Startup terminal workspace cleanup (SPEC 841-849) | `worktree-manager.sh remove` manual (`scripts/governance/worktree-manager.sh:208-220`); sem varredura de worktrees de runs terminais | AUSENTE (automatizado) | fora; P2 |
| C27 | Hot reload do `WORKFLOW.md` (polling de 1 s, último bom, erro visível, re-valida antes de dispatch) (SPEC 560-578, 2070-2072; `workflow_store.ex:13`) | Nada equivalente (`activation-builder.js:158` só limpa cache). Handlers de hook que leem `agent-liveness.yaml` a cada execução teriam efeito equivalente por construção (inferência, não especificado em `liveness.md`) | AUSENTE (explícito) | LV (basta declarar "sem cache"); P0 de uma linha |
| C28 | Validação de preflight por tick: config inválida bloqueia dispatch, mantém reconciliação (SPEC 580-603) | Validador de capabilities e contratos em CI (`validate-capability-graph.js`); sem preflight de runtime periódico | PARCIAL | LV2 (validador do schema do yaml) |
| C29 | Falha de reload não derruba: manter última config válida e expor erro (SPEC 576-578) | LV: fail-open com aviso (`liveness.md:89`); contrato ausente = desligado (`:30`). Não diz "última config válida" | PARCIAL | LV; P0 trivial |

### 2.2 Contrato de repositório, workspace e agente

| # | Capacidade Symphony | HSEOS (evidência) | Status | Quem cobre |
|---|---|---|---|---|
| C30 | `WORKFLOW.md` como contrato do repositório: front matter YAML tipado + template de prompt (SPEC 318-531) | `repository-contract.yaml` (7 linhas: identity + capabilities.manifest); regras em `AGENTS.md`; fluxo em `.hseos/workflows/*/workflow.md`; contrato de tarefa v2 (`docs/engineering-task-contract.md`). `.hseos/config/` hoje só tem `hseos.config.yaml` e `kube-profile.yaml`. `agent-liveness.yaml` (LV) seria o primeiro arquivo de configuração de runtime tipado por capability | PARCIAL | LV (YAML por capability); resto fora |
| C31 | Template estrito: variável ou filtro desconhecido falha a renderização (SPEC 493-516, 1334-1339) | `dispatch_wave` monta prompt por concatenação (`tools/mcp-hseos-swarm/tools/dispatch_wave.js:48`). Não achei template estrito | AUSENTE | fora; P2 |
| C32 | Variável `attempt` e guia de continuação (SPEC 1341-1350; `agent_runner.ex:144-152`, `elixir/WORKFLOW.md:50`) | Nenhuma. A cláusula "no silent idle" da LV1 vai para o prompt de dispatch (`liveness.md:83`) | PARCIAL | LV1 |
| C33 | Workspace por issue em raiz fixa, chave sanitizada com hash anti-colisão, contenção sob a raiz (SPEC 851-948; `workspace.ex:266-280,461`) | Worktrees `.worktrees/<task>` (`worktree-manager.sh:41-45`); workspace de engenharia com `realpath`, `O_NOFOLLOW`, `lstat` (`engineering-workspace.js:44-56,127`); materialização com ID determinístico e intenção no ledger (`jobs.md:48-52`) | COBERTA (mais forte no kernel; squads por convenção) | W1/W4 |
| C34 | Hooks de workspace `after_create`/`before_run`/`after_run`/`before_remove` com timeout de 60 s e semântica de falha (SPEC 420-442, 903-926, 1760-1769) | Sem hooks de ciclo de vida de workspace. Há hooks do harness (`.agents/hooks/registry.yaml`) e `worktree-manager.sh create/validate/commit/merge/remove`. Código do projeto executa isolado por design, sem scripts arbitrários do contrato (`docs/sandbox.md`) | N-A no kernel (isolamento é requisito); PARCIAL nos squads | - |
| C35 | `agent.max_turns`, `read_timeout`, `turn_timeout`, `stall_timeout` configuráveis no contrato (SPEC 451-454, 485-491) | Limites no contrato da tarefa (`max_turns`, `max_tool_calls`, `max_tokens`, `max_duration_ms`); `agent-liveness.yaml` traria `stall_timeout_s` etc. (`liveness.md:28-37`) | PARCIAL | LV |
| C36 | Modelo de aprovação e sandbox documentados; input pendente nunca para a run (SPEC 1065-1140) | Superior: policy lattice, aprovação vinculada à operação/baseline (F05), sandbox com rede negada e ambiente limpo (`docs/sandbox.md:52`), `approvalPolicy 'never'` no provider | COBERTA | W1-W4 |
| C37 | Ferramentas nativas do provider executadas no host com credencial do host; token do tracker removido do ambiente do filho (SPEC 1091-1128, 1748-1758; `app_server.ex:240-253`) | Gateway de tools governado e `ToolRuntime` (F04, `packages/tool-runtime`); segredos fora de prompt/log (F08). Sem conceito de tracker | COBERTA (outro domínio) | W4/W5 |
| C38 | Adapter de tracker: `fetch_issues_by_states` / `fetch_issues_by_ids`, perfil documentado, erros normalizados, rate limit (SPEC 1179-1322) | Não há tracker de issues. Há integração ADO opcional (`docs/ado-ops`, `tools/cli/lib/managed-governance/commands.js`) fora do caminho de dispatch | N-A (HSEOS não é leitor de tracker) | decisão de produto; ver 5 |
| C39 | Extensão SSH worker: pool de hosts, cap por host, afinidade em retry, sem fallback silencioso (SPEC 2252-2312) | W7: "trabalhadores remotos" (`PLAN.md`, linha W7); `packages/delegated-runtime-host/index.js:24,42-47` já modela lease/epoch de worker hospedado | AUSENTE hoje; planejada | W7 |
| C40 | Conformidade testável: matriz de testes core/extensão/integração real, com skip reportado (SPEC 2049-2201) e `specs.check`/`pr_body.check` (`elixir/lib/mix/tasks`) | Gates de cobertura 90/80, matriz Node 22/24, mutantes (`PLAN.md`; `spec.md` NFR04); recibos e "BLOCKED nunca PASS" | COBERTA (e mais forte) | W0+ |
| C41 | CLI: caminho posicional do contrato, falha de startup limpa, exit code (SPEC 2182-2189) | CLI `hseos` com exit code (CRP-C1 em andamento) | COBERTA | CRP |
| C42 | Hardening documentado: filtrar o que chega ao agente, restringir tools/credenciais (SPEC 1771-1797) | Constituição, lattice, autoridade só diminui (NFR01 em `spec.md`) | COBERTA | - |

## 3. Foco: o que a trilha LV deveria incorporar e ainda não incorpora

Fonte: `liveness.md` (118 linhas). Cada item cita o Symphony e diz se é fato ou inferência.

### 3.1 Continuation retry / reconciliação a cada tick contra a fonte de verdade
- Fato: o Symphony nunca confia no agente para dizer que terminou; após cada turno consulta o tracker (SPEC 1970-1987, 664-674) e, após saída normal, re-agenda a checagem (2002-2007). O "DONE" é derivado da fonte de verdade.
- Fato: a LV2 já exige "reconcilia antes de agir, comparando HEAD, pid ou arquivo de status" (`liveness.md:112`). Isso cobre o lado do vigia.
- Lacuna (fato): `DONE` é autodeclarado com `evidence` (`liveness.md:18`), mas a spec não diz quem confere a evidência (hash/caminho/run id existe? o commit está no HEAD?). Um agente pode declarar `DONE` com `evidence` inventada e a LV o aceita como estado legítimo. Não é aceite de tarefa (isso é F09), mas é o buraco que o Symphony fecha por construção.
- Recomendação: `hseos liveness report` resolve a evidência (existe o caminho, o hash bate no HEAD, o run id está no ledger) e registra `evidence_verified: true|false`; `false` vira alerta, não recusa (preserva fail-open).

### 3.2 Stall durante o turno x ocioso depois do turno
- Fato: o Symphony mede inatividade com `last_codex_timestamp` ou `started_at` (SPEC 825-827), ou seja, durante o turno. A LV define `stalled` como fim de turno sem evento novo (`liveness.md:32`) e cobre o meio do turno só por `heartbeat_ttl_s` (`:33`).
- Risco (inferência, `liveness.md` não responde): `foreground_wait_max_s=540` é maior que `heartbeat_ttl_s=300`. Se o heartbeat vem do shim `PostToolUse` (`dev-squad/workflow.md:97,109`), uma espera legítima de 540 s em primeiro plano não emite heartbeat no meio e o lease vence. O resultado seria `overdue` falso em plena espera correta. Mitigações possíveis: `hseos liveness await` renova o heartbeat a cada N segundos enquanto aguarda, ou `heartbeat_ttl_s >= foreground_wait_max_s + folga`. Precisa de decisão e de teste; marquei P0 porque o default atual é inconsistente.

### 3.3 Separação entre retry por falha e por stall
- Fato que corrige a premissa: o Symphony não separa. Stall e falha compartilham contador e backoff (`orchestrator.ex:625-635` usa `next_retry_attempt_from_running`; só o texto de `error` muda) e a spec afirma que `attempt` não distingue continuação de retry (SPEC 1348-1351). `retry_kind` é extensão opcional.
- Portanto não há o que "incorporar" aqui. O que a LV já tem de mais correto: contadores próprios (`max_stop_refusals`, `max_wake_attempts`, `liveness.md:35-36`) separados do limite de 3 rodadas de correção (`:43`). Falta apenas contar `wake` por causa (idle sem estado x waiting vencido x overdue), para que o relatório de métrica não misture causas (ver 3.4).

### 3.4 Terminal reasons tipados
- Fato: o Symphony tem fases distintas (`Stalled`, `TimedOut`, `CanceledByReconciliation`, SPEC 686-692) e categorias de erro (1151-1161). Na LV, `reason` é texto livre (`liveness.md:18`) e o classificador não tem tipo para `failed` nem `blocked`.
- Recomendação P0 (esquema, custo baixo): `reason_code` enumerado no schema de `report`/evento (por exemplo `declared`, `no_state_at_stop`, `background_task_active`, `foreground_cap_exceeded`, `wait_deadline_exceeded`, `wake_exhausted`, `evidence_unverified`, `guard_internal_error`) mais `reason` livre. Habilita as métricas de `liveness.md:85` por causa. O HSEOS já usa códigos estáveis em outras superfícies (`JOB_*`, `ENV_*`), então é padrão da casa.

### 3.5 Estado `blocked` (input/aprovação pendente)
- Fato: o Symphony exige que input ou aprovação pendente nunca deixe a run parada indefinidamente (SPEC 1073-1075), e a implementação trata `blocked` como estado próprio, isento de stall e visível (README; `orchestrator.ex:600-606`). A LV declara `BLOCKED` mas o classificador (`liveness.md:104`) não o nomeia, e só `WAITING_ON` tem `deadline_at` e `wake_via` (`:18`).
- Consequência (inferência): um agente que declara `BLOCKED` e para pode ficar parado sem prazo e sem notificação. Recomendação P0: classes `blocked` e `failed` no classificador; `BLOCKED` não conta como `idle_no_state`, mas gera notificação ao humano na primeira passada e entra no relatório com idade (`blocked_age_s`).

### 3.6 Concorrência máxima por estado
- Fato: existe só global (`scheduler.js:69,210`). A LV não depende disso; o paralelo útil é limitar a tempestade de wakes (risco já listado em IDLE-WATCHDOG 3.4). `max_wake_attempts` é por run; falta um teto por ciclo do watchdog. Recomendação P1: `max_wakes_per_cycle` (valor sugerido 3, a decidir).

### 3.7 Snapshot de estado para restart
- Fato: o Symphony admite que timers e sessões se perdem (SPEC 1699-1700) e deixa persistência como TODO (2239). O HSEOS já reconstrói do ledger. Para a LV a decisão é onde ficam os eventos: `liveness.md:98` os põe no ledger de estado do `mcp-project-state`, o que sobrevive a restart. Sem lacuna. Falta só declarar que o inbox de wake (`.hseos/state/liveness/inbox/`) é reconstruível a partir do ledger, para que a perda do diretório não perca pedidos (P1, uma linha).

### 3.8 Status surface
- Fato: o Symphony expõe `running[]`, `retrying[]`, tokens, rate limits, `blocked[]` no snapshot (SPEC 1390-1409) e na API/dashboard. A LV entrega `liveness check --json` (`liveness.md:57`), que é o equivalente de dados, mas nenhuma superfície humana. `tools/state-ui-server/lib/snapshot.js:70-97` já lista runs e órfãos com `last_heartbeat_at`. Recomendação P1: o snapshot da state-ui passa a ler a classificação da LV (campos `class`, `reason_code`, `idle_for_s`, `wake_attempts`). Dashboard completo é W6.

### 3.9 Token e rate-limit por sessão
- Fato: o kernel já contabiliza (C19, C20). Para squads de harness, `tokens_in/out` só entra "se conhecido" (`dev-squad/workflow.md`, tabela de emissão). A LV poderia registrar `tokens` por run no evento `report` quando o handler de `SubagentStop` os receber (depende do payload real, spike I3). P1, condicionado ao LV0.

### 3.10 Hot reload do contrato
- Fato: o Symphony exige reload sem restart, com último bom e erro visível (SPEC 560-578). Para a LV, `agent-liveness.yaml` é lido por handlers de hook de curta vida e pelo `watch` (potencialmente longo). Hooks relêem naturalmente; `hseos liveness watch` em loop precisa reler a cada ciclo. Recomendação P0 (uma frase em `liveness.md`): "o arquivo é lido a cada execução, sem cache; arquivo inválido mantém a última configuração válida e emite aviso".

### 3.11 Outros achados que a lista do pedido não cobria
- Isenção de `waiting_ok` no stall: igual ao `blocked` do Symphony (`orchestrator.ex:600-606`), a LV já distingue `waiting_ok` de `stalled`. Coerente; sem lacuna.
- O prompt do Symphony diz ao agente "não termine o turno enquanto o item estiver ativo" (`elixir/WORKFLOW.md:50`; `agent_runner.ex:144-152`). Isso é a cláusula "no silent idle" da LV1 (`liveness.md:83`); a diferença é que no Symphony o orquestrador também reabre o turno, aqui só o guard recusa. Sem ação.
- Wake para run cuja tarefa já foi cancelada ou encerrada (inferência): o Symphony para e libera a run quando a fonte de verdade fica terminal (SPEC 833-838). Na LV2, `check` deveria consultar o status do run em `as_agent_runs` e o job no ledger antes de gerar `wake_request`, para não acordar agente cancelado. Verificar se `watch` já faz isso (`liveness.md:112` fala em HEAD/pid/status, não em status do job). P0 barato (um `if` na reconciliação).

## 4. O que o Symphony tem e o HSEOS deixa de fora, fora da liveness

1. Dispatcher autônomo que varre uma fila e inicia trabalho dentro de limites (C02, C13, C14). No HSEOS os jobs são enfileirados e reivindicados por comando; não achei laço que despache. É a maior distância funcional, e depende de decisão: o HSEOS pode preferir manter o humano/Commander como despachante (gates G1-G5 em `dev-squad/workflow.md:64-70`).
2. Timeout de silêncio no stream do provider (C05).
3. Prioridade e concorrência por estado (C13, C14).
4. Varredura inicial de workspaces terminais (C26).
5. Template estrito de prompt com `attempt` (C31, C32).
6. Snapshot de rate limit agregado e visível (C20).
7. Endpoint de "reconcile agora" coalescente (C23, `POST /api/v1/refresh`, SPEC 1609-1622).
8. Convenção de logs `key=value` com identificadores obrigatórios (C24).
9. Pool SSH com afinidade (C39): coberto por W7 em plano.

## 5. O que o HSEOS tem e o Symphony não (para não regredir ao "importar")

Ledger durável e CAS (`expected_version`), fence/lease com "lease vencido não prova morte", estado `uncertain` com reconciliação sem repetir efeito, retry explícito e orçamento acumulado, aceite independente, política/autoridade que só diminui, sandbox com rede negada, evidência com proveniência. O Symphony assume um repositório de confiança (SPEC 1721-1732) e perde estado no restart (1690-1704). Qualquer incorporação deve preservar essas garantias; em especial, não importar kill + retry automático.

## 6. Recomendações por prioridade (sem decidir)

### P0: incorporar na trilha LV agora (mexe em `liveness.md`/contratos, sem custo de código relevante)
1. Resolver a inconsistência `foreground_wait_max_s (540) > heartbeat_ttl_s (300)`: `await` renova heartbeat, ou o TTL sobe, e escrever o teste (3.2).
2. `reason_code` enumerado nos eventos `report`, `idle_violation`, `overdue`, `wake_sent`, `wait_declared` (3.4).
3. Classes `blocked` e `failed` no classificador, com notificação ao humano e `blocked_age_s` (3.5).
4. Reconciliar também contra o status do run/job antes de gerar `wake_request` (3.11).
5. Declarar leitura sem cache e "última configuração válida" para `agent-liveness.yaml` (3.10, C29).
6. `report` verifica a evidência e registra `evidence_verified` (3.1), só como alerta.

### P1: W5 (ou fim da trilha LV, sem novo schema de estado)
1. `max_wakes_per_cycle` (3.6).
2. Declarar o inbox reconstruível a partir do ledger (3.7).
3. State-ui lê a classificação da LV (3.8).
4. `tokens` por run no `report`, se o spike I3 mostrar o dado (3.9).
5. Timeout de silêncio (turn_timeout do Symphony) nos drivers `claude-cli-driver`/`codex-app-server-driver` (C05), como tarefa própria de F01/F18.
6. Snapshot agregado de rate limit/quota dos providers na superfície de estado (C20).
7. `POST` de reconcile coalescente para `liveness check/watch` na control API, se a LV2 optar por expô-lo (C23).

### P2: W6 ou depois
1. Dispatcher autônomo de jobs com tick, `priority` e concorrência por estado (C02, C13, C14), condicionado a decisão de produto sobre tirar o humano do papel de despachante.
2. Dashboard humano de runs ocupadas/ociosas/bloqueadas/overdue (C22; Code OSS, W6).
3. Template de prompt estrito com `attempt` (C31, C32).
4. Varredura de worktrees de runs terminais (C26).
5. Convenção de logs estruturados (C24).
6. Pool de workers remotos com afinidade (C39; W7).

## 7. Fatos x inferências, e limites

Fatos verificados: todas as citações de SPEC.md, as funções do Elixir listadas, e os caminhos:linha do HSEOS acima, lidos nesta sessão.

Inferências (marcadas no texto): o `overdue` falso por TTL < espera em primeiro plano (3.2); a ausência de checagem de status do job no `watch` (3.11); o efeito de reler config a cada hook como "hot reload" (C27); o `BLOCKED` sem prazo (3.5).

Não verificado:
- Se existe, fora dos diretórios varridos, um laço que despache jobs `queued` (C02).
- Conteúdo de `design.md`/`tasks.md` da W5 e dos worktrees `hseos-w5-lv1`/`lv2` além dos títulos e de `liveness.md`.
- Corpo de `workspace.ex`, `app_server.ex` e `status_dashboard.ex` do Symphony.
- Comportamento real do harness para `SubagentStop`/`TeammateIdle` (spike LV0/I3 pendente).
- Linha exata da tabela de emissão de tokens em `dev-squad/workflow.md` (citada por seção, não por linha, em C19).
