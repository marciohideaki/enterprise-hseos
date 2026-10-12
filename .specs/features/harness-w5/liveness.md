# W5 — Trilha LV: liveness de agentes ("no silent idle")

Trilha aditiva da W5, aberta por decisão do owner em 2026-10-12: P0 e P1 em paralelo, com o HSEOS liderando e o Helix (`cambio-real-platforms`) como consumidor. A trilha não altera fluxos existentes. Se o contrato não existir no projeto, o comportamento continua o atual.

## Problema medido

Os teammates despachados pela ferramenta Agent encerram o turno dizendo "aguardando" quando o comando passa do limite de 600 s do Bash em primeiro plano. O aviso de término (task-notification ou Monitor) chega ao transcript do teammate como `queued_command`, mas não o acorda. Ele só volta quando recebe um SendMessage. O orquestrador também não tinha vigia.

Linha de base retroativa (W5-B1, 2026-10-12): cerca de 15 h ociosas somando os dois executores. O pior caso foi a W5-02b, parada de 06:05Z a 16:45Z (10h39m), com o aviso na fila desde 06:06Z. O Helix registrou o mesmo padrão: um squad parado 3 vezes e outro por cerca de 24 h.

Pesquisa: `/tmp/hseos-w5/research/IDLE-WATCHDOG.md`, copiada para `docs/evolution/w5/evidence/w5-lv/IDLE-WATCHDOG.md` pela W5-LV1.

## Contrato "no silent idle"

Todo agente despachado encerra o turno com uma linha final estruturada, validada contra um schema:

```
LIVENESS: {"state":"DONE"|"BLOCKED"|"FAILED"|"WAITING_ON", "reason":"...", "evidence":"<hash|caminho|run id>", "waiting_on":{"condition":"...", "wake_via":"commander"|"human", "deadline_at":"<ISO-8601>"}}
```

- `waiting_on` é obrigatório se o estado for `WAITING_ON` e proibido nos demais.
- `deadline_at` fica limitado a `stall_timeout_s` a partir de agora.
- `wake_via: self` não existe. Avisos de tarefa em segundo plano não acordam o teammate (I1), então esperar um processo próprio é feito em primeiro plano, em blocos de até `foreground_wait_max_s`, e nunca serve de justificativa para encerrar o turno.
- O estado é declarado e validado. Não há inferência por regex sobre a prosa; uma regex sobre "aguard|waiting|em segundo plano" no máximo emite um alerta.

Configuração canônica: `.hseos/config/agent-liveness.yaml`, registrada como capability. O schema `repository-contract/v1` não ganha chave nova enquanto o validador não provar que aceita. Campos e padrões:

| Campo                   | Padrão                                | Uso                                                                                     |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| `enabled`               | `false` (arquivo ausente = desligado) | ativa guard e watchdog                                                                  |
| `foreground_wait_max_s` | 540                                   | bloco máximo de espera em primeiro plano, abaixo do limite de 600 s do Bash             |
| `stall_timeout_s`       | 900                                   | fim de turno sem evento novo além disso = `stalled`                                     |
| `heartbeat_ttl_s`       | 300                                   | lease de heartbeat, no mesmo modelo de `delegated.worker.heartbeat`                     |
| `watch_interval_s`      | 120                                   | ciclo do watchdog                                                                       |
| `max_stop_refusals`     | 2                                     | quantas vezes o guard recusa o fim de turno antes de deixar passar e registrar violação |
| `max_wake_attempts`     | 3                                     | acordares por run antes de escalar ao humano, com backoff exponencial de até 5 min      |
| `escalate_to`           | `human`                               | destino da escalada                                                                     |

Invariantes:

- Lease vencido não prova morte: o vencimento gera `overdue` e escalada, nunca takeover nem kill automático (`.specs/features/harness-w4/job-claims-implementation.md:39-41`).
- `turn_end` deixa de valer como heartbeat: o fim de turno é registrado como evento próprio, e `state-list --orphans` mantém a compatibilidade por campo novo.
- O limite de 3 rodadas de correção (§3h) não se confunde com os limites de recusa e de acordar desta trilha.
- O pre-commit não é afrouxado. A solução é esperar melhor, não rodar um gate mais leve.

## Mapa da trilha

| Task   | Fase                                                         | Paralelismo                               | Executor                                                |
| ------ | ------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------- |
| W5-LV0 | spike I1–I3                                                  | antes da LV1-hook e em paralelo com a LV2 | sessão Helix (consumidor), evidência devolvida ao HSEOS |
| W5-LV1 | P0: adaptador Claude Code, processo e métrica                | ∥ W5-LV2                                  | Sonnet, worktree `hseos-w5-lv1`                         |
| W5-LV2 | P1: contrato, ledger, classificador, CLI, watchdog, paridade | ∥ W5-LV1                                  | Sonnet, worktree `hseos-w5-lv2`                         |

Interface entre LV1 e LV2, fixada aqui para que as duas rodem em paralelo:

- CLI `hseos liveness report --session <id> --agent <id> --json <linha LIVENESS>`, que valida e grava o evento.
- CLI `hseos liveness check --json`, com saída `{runs:[{session,agent,state,last_event_at,overdue,violation}], wake_requests:[...]}`.
- Diretório `.hseos/state/liveness/inbox/` com um arquivo `<session>-<agent>-<seq>.json` por pedido: `{session, agent, reason, created_at, attempt}`.

Enquanto a LV2 não integra, a LV1 testa com um stub que implementa o mesmo contrato.

Orçamento: arquivos novos no pacote contam contra as áreas `tools` (393), `.agents` (193, com cerca de 7 de folga e os plugins W5 ainda por vir), `.hseos` (62) e `scripts` (21). Um script de métrica retroativa que não precisa ir para o runtime fica fora do pacote por mérito, não para escapar da contagem. Se a medição estourar, a trilha para em G3 com o número.

## W5-LV0 — Spike I1–I3

- execution_mode: isolated, sessão Helix, só leitura no HSEOS
- input_contract: `/tmp/hseos-w5/research/IDLE-WATCHDOG.md` §2
- output_contract: `docs/evolution/w5/evidence/w5-lv0/spike.md`, entregue ao Commander HSEOS
- acceptance_criteria, com evidência de transcript ou payload de hook para cada item:
  - **I1:** um teammate que lança `sleep 30` em segundo plano e encerra o turno não acorda com o aviso de término.
  - **I2:** um CronCreate da sessão líder acorda o líder, e um teammate não é acordado por ele.
  - **I3:** registrar o payload real de `SubagentStop` e `TeammateIdle` (e se disparam para teammates do Agent tool), com `agent_id`, `last_assistant_message`, `background_tasks` e `stop_hook_active`, e a semântica de `decision: block`, de `additionalContext` e do exit 2.
- verify_step: os payloads JSON reais anexados; um item não comprovado fica como NÃO VERIFICADO, nunca PASS.

## W5-LV1 — P0: guard do fim de turno, processo e métrica retroativa

- execution_mode: isolated
- dependencies: os itens de hook dependem do resultado da LV0 (I3); processo e métrica não dependem
- input_contract.files: `.agents/hooks/registry.yaml`, `.agents/hooks/handlers/*`, o gerador de `.claude/hooks.json` e do espelho `.codex`, `.hseos/workflows/dev-squad/workflow.md`, `.enterprise/governance/agent-skills/dev-squad/SKILL.md` e o seu espelho compilado
- output_contract.files:
  - handler `liveness-stop-guard` (Stop, SubagentStop e TeammateIdle quando o harness disparar), registrado no `registry.yaml` e gerado no `.claude/hooks.json`;
  - handler `liveness-wake-inbox` (UserPromptSubmit), que injeta os pedidos de acordar pendentes no prompt do orquestrador;
  - cláusula aditiva "no silent idle" no workflow e na skill dev-squad (prompt de dispatch: linha LIVENESS obrigatória, espera em primeiro plano em blocos de até 540 s, proibição de encerrar o turno "aguardando");
  - script de métrica retroativa sobre transcripts (`queued_command` × próximo turno), com relatório `reaction_latency` / `idle_gap` / `violations`;
  - testes e `docs/evolution/w5/evidence/w5-lv1/receipt.json`.
- acceptance_criteria:
  - sem `.hseos/config/agent-liveness.yaml`, ou com `enabled: false`, os handlers saem em 0 sem efeito (sem mudança de fluxo);
  - com o contrato ligado, um fim de turno sem linha LIVENESS válida, ou com `background_tasks` ativo e estado diferente de WAITING_ON com `wake_via` válido, é recusado com uma instrução acionável, até `max_stop_refusals`; depois disso passa e registra `idle_violation`;
  - respeita `stop_hook_active`; erro interno faz fail-open com aviso (coerente com o shim de `workflow.md:97`), nunca trava a sessão;
  - linha LIVENESS válida é gravada via `hseos liveness report` (stub até a LV2);
  - a métrica retroativa reproduz 10h39m para a W5-02b a partir do transcript real;
  - ensaio sintético: teammate que lança uma tarefa em segundo plano e tenta encerrar é recusado.
- verify_step: testes focados com c8 `--include` explícito dos arquivos novos e alterados, 90/80 por arquivo; geração dos hooks sem diff inesperado; `node scripts/governance/validate-capability-graph.js` sem achados.

## W5-LV2 — P1: contrato, ledger, classificador, CLI, watchdog e paridade

- execution_mode: isolated
- dependencies: nenhuma além do contrato; não toca `tools/lib/governed-execution/event-registry.js` (é da W5-04): os eventos de liveness ficam no ledger de estado do `mcp-project-state`
- input_contract.files: `tools/mcp-project-state/lib/{agent-state-dal,stale-detector,scheduler}.js`, `.agents/hooks/registry.yaml:456` (heartbeat no fim do turno), `packages/delegated-runtime-host/index.js` (modelo de lease), `.specs/features/harness-w4/{jobs,job-claims-implementation}.md`, `docs/engineering-control-api.md`, a CLI `tools/cli/`, `.agents/capabilities/components.yaml`, `AGENTS.md`
- output_contract.files:
  - `.hseos/config/agent-liveness.yaml` (exemplo desligado) e o schema com validador;
  - eventos aditivos `turn_end`, `wait_declared`, `report`, `wake_sent`, `idle_violation`, `overdue`, com migração compatível do state;
  - classificador `running` / `waiting_ok` / `waiting_overdue` / `stalled` / `idle_no_state` / `done`;
  - CLI `hseos liveness report|check|watch|await`: `await --pid|--file|--cmd-status --max 540` devolve "ainda rodando, chame de novo" para manter o turno vivo; `watch` faz um ciclo ou roda em loop, grava os pedidos de acordar no inbox, aplica backoff e `max_wake_attempts`, e escala ao humano por notificação;
  - template de timer `systemd --user` para `hseos liveness watch --once`, para que o watchdog não dependa da sessão;
  - paridade com Codex e outros harnesses: seção no `AGENTS.md` e na skill com o protocolo (linha LIVENESS, `await` em primeiro plano, watchdog externo), declarando a lacuna do Stop hook no Codex;
  - testes e `docs/evolution/w5/evidence/w5-lv2/receipt.json`.
- acceptance_criteria:
  - o contrato ausente ou desligado não muda nenhum comportamento existente;
  - `state-list --orphans` continua compatível;
  - lease vencido gera `overdue` e escalada, nunca kill nem takeover;
  - o watchdog reconcilia antes de agir, comparando com a fonte de verdade (HEAD do worktree, pid ou arquivo de status);
  - `turn_end` não renova o heartbeat;
  - `await` nunca passa de `foreground_wait_max_s`;
  - ensaio: run sintético sem estado vira `idle_no_state` e gera um pedido de acordar em até 1 ciclo; WAITING_ON vencido vira `waiting_overdue` e escala depois de `max_wake_attempts`.
- verify_step: testes focados com c8 `--include` explícito, 90/80 por arquivo; os testes novos entram em `test:kernel` e os arquivos em `.c8-kernel.json`, só por acréscimo.

## Gates

Nenhum gate novo. Valem G3 (inventário medido) e G6 (merge da W5). A ativação operacional da trilha no ambiente do owner (timer systemd instalado, contrato ligado em projetos) fica fora do escopo, com decisão própria.

## Adendo 1 — lacunas contra o Symphony (2026-10-12)

Fonte: análise de lacunas Symphony × HSEOS (`/tmp/hseos-w5/research/SYMPHONY-GAP.md`, copiada pela W5-LV2 para `docs/evolution/w5/evidence/w5-lv/SYMPHONY-GAP.md`).

A diferença estrutural vale como invariante: o Symphony é dono do loop do agente e por isso pode matar e reiniciar o worker. O HSEOS não é dono do loop dos teammates do harness, e o core recusa por desenho a reexecução automática (`jobs.md:56`, `max_attempts: 1`). A trilha transplanta a reconciliação contra a fonte de verdade e a classificação tipada. Não transplanta kill nem retry automático.

Incorporado à trilha (P0, obrigatório para a LV1 e a LV2):

1. **Heartbeat durante a espera.** Enquanto aguarda, `hseos liveness await` renova o heartbeat a cada 60 s. Sem isso, `foreground_wait_max_s` (540) maior que `heartbeat_ttl_s` (300) gera `overdue` falso durante uma espera correta. O TTL não sobe. É obrigatório um teste de espera de 540 s sem `overdue`.
2. **`reason_code` enumerado** nos eventos `report`, `wait_declared`, `idle_violation`, `overdue` e `wake_sent`, junto do `reason` livre. Códigos: `declared`, `no_state_at_stop`, `invalid_liveness_line`, `background_task_active`, `foreground_cap_exceeded`, `wait_deadline_exceeded`, `wake_exhausted`, `evidence_unverified`, `blocked_pending`, `guard_internal_error`. As métricas e os acordares são contados por código.
3. **Classes `blocked` e `failed` no classificador.** O conjunto completo passa a ser `running`, `waiting_ok`, `waiting_overdue`, `stalled`, `idle_no_state`, `blocked`, `failed`, `done`.
   - `blocked` não conta como `idle_no_state`.
   - `blocked` notifica o humano na primeira passada e entra no relatório com `blocked_age_s`.
   - Um `blocked` nunca fica parado sem aparecer.
4. **Reconciliação também contra o status do run e do job** (`as_agent_runs` e ledger) antes de qualquer `wake_request`. Run cancelado, encerrado ou concluído não é acordado.
5. **Configuração relida a cada execução, sem cache.** Se o `agent-liveness.yaml` estiver inválido, vale a última configuração válida e sai um aviso visível. O `watch` em loop relê a cada ciclo.
6. **`report` verifica a evidência.** Confere se o caminho existe, se o hash está no HEAD do worktree e se o run id está no ledger, e grava `evidence_verified: true|false`. O valor `false` só gera alerta (`evidence_unverified`), não recusa.

Incorporado à W5-LV2 (P1 da trilha, por decisão do owner de rodar P0 e P1 em paralelo):

7. **`max_wakes_per_cycle`**, padrão 3, como teto global por ciclo do watchdog, contra tempestade de acordares.
8. **Inbox reconstruível.** `.hseos/state/liveness/inbox/` pode ser recriado a partir do ledger, e perder o diretório não perde pedidos.
9. **Snapshot da state-ui** (`tools/state-ui-server/lib/snapshot.js`) passa a ler a classificação da LV: `class`, `reason_code`, `idle_for_s`, `wake_attempts`.
10. **`tokens` por run no `report`**, se o payload real de `SubagentStop` (spike LV0/I3) trouxer o dado. Se não trouxer, registrar como NÃO VERIFICADO.

Fora da trilha, registrado em `docs/evolution/w5/STATUS.md` para decisão do owner:

- **W5 ou tasks próprias:** timeout de silêncio no stream dos drivers `claude-cli-driver`/`codex-app-server-driver` (F01/F18); snapshot agregado de rate limit e quota; `POST` coalescente de reconcile na control API.
- **W6 ou depois:**
  - dispatcher autônomo com tick, `priority` e concorrência por estado (decisão de produto: tirar o humano do papel de despachante);
  - dashboard humano de runs ocupadas, ociosas, bloqueadas e com prazo vencido;
  - template estrito de prompt com `attempt`;
  - varredura de worktrees terminais;
  - logs `key=value`;
  - pool SSH (W7).

## Adendo 2 — regras de processo do squad (2026-10-12)

Aprovadas pelo owner depois de inconsistências observadas na execução da própria trilha. A W5-LV2 fez reset e squash duas vezes durante a revisão, chegando a mudar a árvore. Uma revisão da W5-LV1 rodou sobre um commit superado. Um executor congelado declarou `BLOCKED`. Estas regras são de processo: entram na cláusula "no silent idle" do workflow e da skill dev-squad, e no classificador da LV2 só onde indicado.

1. **Revisão presa a um SHA.**
   - Toda revisão cética nomeia o commit revisado (SHA) e o hash da árvore (`git rev-parse <sha>^{tree}`).
   - Enquanto a revisão estiver em curso, o executor fica congelado: sem commit, amend, reset ou squash no branch.
   - Qualquer mudança no HEAD durante a revisão a invalida. O revisor reporta `REVIEW_TARGET_MOVED` e não emite veredito sobre a árvore nova.
   - Correções vão juntas numa rodada só, aberta pelo Commander depois do veredito. Squash para cumprir "1 task = 1 commit" só é feito fora de revisão ou com árvore idêntica comprovada.
   - Uma revisão que termina com o HEAD diferente do SHA revisado não vale como aprovação.
2. **Aguardar decisão não é bloqueio.**
   - Um agente que espera uma decisão do Commander ou do humano (resultado de revisão, congelamento, aprovação) declara `WAITING_ON`, com a condição explícita, `wake_via: commander` ou `human` e `deadline_at`.
   - `BLOCKED` fica reservado para impedimento que o agente não consegue resolver e que exige mudança de escopo, de capacidade ou de decisão ainda não pedida, sempre com a causa.
   - O classificador da LV2 trata como `waiting_ok` ou `waiting_overdue` quem declarou `WAITING_ON`, e só conta como `blocked` quem declarou `BLOCKED`. As métricas por `reason_code` não misturam os dois.
