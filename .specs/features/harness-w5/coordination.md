# W5 — Trilha CO: coordenação de atividades entre ferramentas

Trilha aditiva da W5, aberta por decisão do owner em 2026-10-12. Escopo completo na W5. O store é plugável e agnóstico: o HSEOS coordena sozinho e cada ferramenta externa (axon, broker de peers ou outra) é opcional. A trilha não altera fluxos existentes, e o contrato ausente significa comportamento atual.

## Problema medido

No mesmo dia, sessões Claude Code (`cambio-real-platforms`) e Codex (`design-system-core`) trabalharam no mesmo core sem saber uma da outra:

- **Versão imutável:** colidiram no número de versão do pacote de contratos. `experimental.4` e `.5` já estavam publicados, outra linha mantinha `.4` a `.8` locais e o `.6` estava reservado pelos dois lados.
- **Arquivos quentes:** os dois lados alteravam os mesmos arquivos (`package.json`, `CHANGELOG.md`, `candidate.json`, `execution.md`, manifestos, `index.tsx`, `styles.css`).
- **Semântica:** divergiram no StepNavigator R2 e no Button.
- **Trabalho invisível:** cerca de 116 worktrees locais não enviadas.

A pesquisa (`/tmp/hseos-w5/research/CROSS-TOOL-COORDINATION.md`) mostra o que falta hoje:

- **Sessões presas ao projeto:** o HSEOS registra só sessões Claude, por projeto (`migrations/003-session-tracking.sql`, `004-session-context.sql`, `registry.yaml:420-436`), sem branch, intenção nem arquivos.
- **Codex invisível:** o Codex não é registrado. Mesmo assim ele roda hooks `UserPromptSubmit`, então o canal de entrega existe.
- **Sem reserva de recurso:** não há reserva de path, versão ou nome. `claimWorktree` não tem chamador fora dos testes.
- **Axon pull e por projeto:** o axon tem handoff e thread, mas no modelo pull e com escopo de projeto.

## Princípios

1. **Agnóstico e independente.** O core coordena com o próprio store e as próprias regras. Integrações (axon, broker de peers do Claude Code, MCPs) são adaptadores opcionais. Se um adaptador estiver ausente, a coordenação continua funcionando. Se um adaptador falhar, o efeito é degradar com aviso, nunca bloquear.
2. **Advisory primeiro.** Registro, reserva e sobreposição avisam. Só bloqueiam onde o projeto ligar explicitamente (`enforce` no contrato). O exemplo é o guard de publish, que recusa número de versão reservado por outro.
3. **Reserva com fence e TTL, no modelo da W4** (`jobs.md:45-48`, `job-claims-implementation.md:37-42`). Lease vencido não prova morte: o vencimento gera `overdue` e escalada, nunca takeover automático.
4. **Entrega sem endereçamento.** Os eventos vão para um inbox em arquivo por sessão, no mesmo formato da trilha LV. Eles são injetados por hook de prompt (Claude e Codex) e, nas demais ferramentas, por instrução no `AGENTS.md` (`hseos activity check` no início). O SendMessage serve só como acelerador opcional para sessões Claude endereçáveis e nunca é o canal único.
5. **Sem daemon obrigatório.** A coordenação funciona com arquivo/SQLite, hooks e CLI. O watchdog (timer `systemd --user`) é opcional e reaproveita o da trilha LV.
6. **Sem dispatcher.** A trilha registra, avisa e reserva. Decidir quem trabalha em quê continua com o humano e o Commander.

## Contrato

Arquivo `.hseos/config/activity-coordination.yaml`, registrado como capability. Se o arquivo estiver ausente ou com `enabled: false`, não há efeito. Ele é relido a cada execução, sem cache, e se estiver inválido vale a última configuração válida, com aviso.

| Campo                      | Padrão                             | Uso                                                                                      |
| -------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `enabled`                  | `false`                            | liga o registro e os avisos                                                              |
| `store.backend`            | `machine`                          | `machine`, `project-aggregate` ou `adapter:<nome>`                                       |
| `store.path`               | `~/.local/state/hseos/activity.db` | store de máquina (SQLite WAL, transações curtas)                                         |
| `store.adapters`           | `[]`                               | adaptadores opcionais, por exemplo `axon`, só quando instalados                          |
| `hot_files`                | `[]`                               | globs do repo que geram aviso de alta severidade se houver sobreposição                  |
| `reservations.kinds`       | `[path, version, name]`            | tipos de reserva aceitos                                                                 |
| `reservations.ttl_s`       | 86400                              | TTL da reserva, renovado por heartbeat da sessão dona                                    |
| `enforce.publish_guard`    | `false`                            | quando `true`, o publish ou bump recusa versão reservada por outra sessão                |
| `overlap.include_git_diff` | `true`                             | soma o `git diff --name-only base...HEAD` dos worktrees registrados aos paths declarados |

Backends do store, atrás de uma interface única (`register`, `heartbeat`, `declare`, `reserve`, `release`, `list_active`, `overlaps`, `events_after(cursor)`):

- **`machine` (padrão):** SQLite próprio do HSEOS, cross-project e cross-tool. É a referência da interface.
- **`project-aggregate`:** lê os stores por projeto já existentes e agrega por leitura. Não tem fence global, então as reservas só valem como aviso. Serve para quem não quer store de máquina.
- **`adapter:<nome>`:** espelha eventos para ferramentas externas, como o axon (`handoff_create` para passar trabalho, `group_impact` como sugestão de paths). É sempre opcional. O adaptador nunca é a fonte de verdade das reservas.

## Eventos

Eventos aditivos, com `reason_code` enumerado no padrão da trilha LV:

- `activity_registered`, `activity_declared`, `activity_heartbeat`, `activity_ended`;
- `claim_acquired`, `claim_released`, `claim_overdue`;
- `overlap_detected`, com severidade `hot_file|declared|diff`;
- `reservation_conflict`, com fonte `claim|published|tag|candidate`.

O inbox reaproveita o diretório e o formato da LV, acrescentando o campo `kind: coordination`.

## Mapa da trilha

| Task   | Escopo                                                                                  | Paralelismo                               | Executor                        |
| ------ | --------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------- |
| W5-CO0 | spike dos hooks do Codex                                                                | antes do CO2-Codex; em paralelo com o CO1 | Sonnet                          |
| W5-CO1 | core: store plugável, registro, reservas, sobreposição, reserva de versão, eventos, CLI | ∥ CO0                                     | Sonnet, worktree `hseos-w5-co1` |
| W5-CO2 | adaptadores: Claude, Codex, AGENTS.md, axon opcional, guard de publish                  | depois do CO1 (interface) e do CO0        | Sonnet, worktree `hseos-w5-co2` |

Dependências com a trilha LV: a CO1 usa o formato do inbox e a convenção de `reason_code` da LV, e se a LV2 ainda não tiver integrado, implementa pelo texto da spec. O watchdog da LV2 ganha a leitura dos eventos de coordenação na integração. Nenhuma das duas trilhas toca `tools/lib/governed-execution/event-registry.js`, que é da W5-04.

Orçamento: a trilha consome as áreas `tools`, `.agents` e `.hseos`, que já estão apertadas. A contagem é medida no fechamento. Se estourar, a trilha para em G3 com o número medido. Nada é removido do pacote para caber.

## W5-CO0 — Spike dos hooks do Codex

- execution_mode: isolated, só leitura no HSEOS; um diretório descartável em `/tmp` para o ensaio
- input_contract: `~/.codex/config.toml` e `~/.codex/hooks.json` (só leitura, sem imprimir segredo), o CLI `codex` instalado e a documentação local em `/workspace/local/references/openai-codex/`
- output_contract: `docs/evolution/w5/evidence/w5-co0/spike.md`
- acceptance_criteria:
  - verificar quais eventos de hook o Codex dispara (`SessionStart`, `UserPromptSubmit`, `Stop` ou equivalentes) em sessão interativa e em `codex exec`;
  - registrar o payload real: id de sessão, cwd e se a saída do hook entra no contexto do modelo;
  - no máximo 2 despachos `codex exec` pela rota de assinatura, num diretório descartável, com um hook de teste que só grava o payload em arquivo, sem alterar o `~/.codex` real (usar `CODEX_HOME` temporário, se o CLI aceitar);
  - não verificado não vira PASS.
- verify_step: payloads JSON reais anexados.

## W5-CO1 — Core da coordenação

- execution_mode: isolated
- input_contract.files: `tools/mcp-project-state/{lib,migrations}/*` (sessões e reservas existentes), `.specs/features/harness-w4/{jobs,job-claims-implementation}.md`, `.specs/features/harness-w5/liveness.md` (inbox e `reason_code`), a CLI `tools/cli/`, `.agents/capabilities/components.yaml`
- output_contract.files:
  - schema e validador de `activity-coordination.yaml`;
  - interface do store e os backends `machine` e `project-aggregate`, com migração própria do store de máquina, sem tocar no store por projeto;
  - registro de atividade (sessão, ferramenta, host, repo remoto normalizado, worktree, branch, base, intenção, `paths_declared`, `identifiers_declared`, heartbeat);
  - reservas tipadas `path:<repo>:<glob>`, `version:<pkg>@<semver>` e `name:<pkg>`, com fence e TTL;
  - detector de sobreposição por paths declarados, `git diff` e `hot_files`;
  - verificação de reserva de versão contra reservas ativas, versões publicadas (`npm view <pkg> versions --json`, com timeout e cache curto; falha de rede degrada com aviso), tags git e `candidate.json` do repo, quando houver;
  - eventos e inbox;
  - CLI `hseos activity register|declare|heartbeat|end|reserve|release|check|overlaps|list`, com `--json`;
  - testes e `docs/evolution/w5/evidence/w5-co1/receipt.json`.
- acceptance_criteria:
  - contrato ausente ou desligado não produz efeito nenhum;
  - funciona sem axon e sem nenhum adaptador;
  - o cenário real reproduzido em teste é detectado como `reservation_conflict` (fontes `published` e `claim`) e `overlap_detected` (`hot_file`): duas sessões de ferramentas diferentes, uma com `version:contracts@x.y.z-experimental.6` reservado e a outra tentando reservar o mesmo; e as duas declarando `packages/design-system-contracts/CHANGELOG.md`;
  - reserva vencida gera `claim_overdue`, sem takeover;
  - o fence impede uma liberação tardia de apagar uma reserva nova;
  - concorrência multiprocesso no SQLite (WAL) testada com 2 processos;
  - `project-aggregate` lê pelo menos 2 stores de projeto e declara que as reservas valem só como aviso.
- verify_step: testes focados com c8 `--include` explícito, 90/80 por arquivo; testes em `test:kernel` e arquivos em `.c8-kernel.json`, só por acréscimo.

## W5-CO2 — Adaptadores e guard

- dependencies: interface do CO1 (implementar pelo texto da spec se o CO1 não tiver integrado) e resultado do CO0 para o Codex
- output_contract.files:
  - **Claude Code:** handlers de `SessionStart`/`UserPromptSubmit`/`Stop` que registram, renovam o heartbeat e encerram a atividade e injetam o inbox de coordenação, registrados em `.agents/hooks/registry.yaml` e gerados no `.claude/hooks.json`. O handler de `session-track` deixa de fixar `--service claude-code` e passa a declarar a ferramenta.
  - **Codex:** template dos hooks equivalentes para `~/.codex/hooks.json`, com o mesmo handler e `--service codex`. A instalação no `~/.codex` real é ativação operacional e fica fora do escopo; o template e as instruções de instalação acompanham.
  - **Outras ferramentas:** seção no `AGENTS.md` e na skill: `hseos activity check` no início, `declare` antes de alterar arquivos quentes e `reserve` antes de fixar versão ou nome.
  - **Adaptador `axon` opcional:** espelha `activity_declared` e `reservation_conflict` como handoff ou thread quando o axon estiver presente. A ausência dele não falha nada.
  - **Guard de publish e bump:** comando `hseos activity guard-publish <pkg>@<versão>`, para CI ou script de release. Com `enforce.publish_guard: true`, recusa versão reservada por outra sessão ou já publicada; com `false`, só avisa.
  - testes e `docs/evolution/w5/evidence/w5-co2/receipt.json`.
- acceptance_criteria:
  - em ensaio com duas sessões simuladas, uma `claude-code` e outra `codex` via payload do CO0, a segunda recebe no prompt o aviso de sobreposição e de reserva da primeira;
  - sem contrato, os handlers saem em 0;
  - erro do adaptador degrada com aviso;
  - o guard de publish recusa o `.6` reservado quando `enforce` está ligado.
- verify_step: igual ao da CO1.

## Gates

Valem G3 (inventário medido) e G6 (merge). Ficam fora do escopo e dependem de decisão própria: instalar hooks no `~/.codex` real, ligar o contrato em projetos e ativar o guard de publish no CI de repositórios consumidores.
