# Evidência de execução de F19 e F20 no projeto ativado — 2026-10-31

Decisão A6 do owner (2026-10-30): ler o `project.db` real do `enterprise-hseos`, somente em leitura, para buscar a terceira
prova da revalidação (`operational-revalidation-2026-10-30.md`): caminho real de produção exercido no projeto ativado. Critério
da D4: datas posteriores à ativação (2026-10-22), volume não trivial e origem não-teste; na dúvida, `not_authorized`.

## Método e prova de leitura pura

- O processo de leitura **nunca abriu** o `project.db` original. O banco tem WAL vivo, gravado continuamente por hooks do
  projeto; abrir com `immutable=1` ignoraria o WAL e qualquer abertura normal poderia fazer checkpoint. Por isso foi feita uma
  cópia instantânea com `cp -p` de `project.db`, `project.db-wal` e `project.db-shm` para um diretório de scratch em `$TMPDIR`
  (o `cp` só lê a origem). A origem foi apenas listada (`ls`), sem abertura por SQLite.
- Horário da cópia: 2026-10-31T02:09:22Z (2026-10-30 23:09:22 -03).
- A cópia passou em `PRAGMA integrity_check` (`ok`) na primeira tentativa. A leitura usou `better-sqlite3` com
  `{ readonly: true, fileMustExist: true }` sobre a cópia, com scripts fora do repo (não commitados).
- sha256 da cópia: `project.db` `48b0e296…d5fc`, `project.db-wal` `21b065ee…561f`, `project.db-shm` `74545afa…f393`. O sha do
  original não é comparável antes/depois porque os hooks do projeto o alteram; a prova é a ausência de abertura do original.
- A cópia foi removida ao fim. Nenhum dado pessoal ou conteúdo de evento entrou no repo: só contagens, tipos, períodos e nomes
  de campos. O `mcp-legacy-usage.db` não foi lido (a autorização cobre o `project.db`).

## Resultados (contagens)

Ledger de execução (`execution_events`, schema v17 ativado em 2026-10-22):

| Medida                                   | Valor                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Eventos / execuções (agregados)          | 10428 / 3476 (3 eventos por execução, ciclo completo)                                                     |
| Período (`recorded_at`)                  | 2026-10-23T01:17Z a 2026-10-31T02:08Z (cerca de 8 dias, 193 h corridas; 7 dias e 144 horas com atividade) |
| Eventos anteriores à ativação            | 0                                                                                                         |
| `event_type`                             | `ExecutionAuthorized`, `ExecutionStarted`, `ExecutionSucceeded`: 3476 cada                                |
| Estado final das execuções (projeção)    | 3476 `succeeded`, 0 outros                                                                                |
| Checkpoint da projeção `execution-runs`  | geração 1 ativa, `last_position` 10428 (cabeça), sem erro                                                 |
| Registro de schemas de evento            | 51                                                                                                        |
| Ator                                     | 1 ator, `type=system`, nos 10428 eventos                                                                  |
| Capacidade / ferramenta                  | `mcp.project_state` / `scheduler_sweep_orphans`: 3476/3476                                                |
| Escopos de projeto                       | 8 projetos distintos do workspace, todos com `server=project_state`                                       |
| `input_digest` distintos                 | 1                                                                                                         |
| Cadência                                 | 252 eventos por hora em regime (varredura periódica)                                                      |
| `execution_approvals` / `_approval_uses` | 0 / 0                                                                                                     |

Tabelas operacionais legadas do `as_*`: 16 eventos (`start`/`complete`/`gate`) entre 2026-10-01 e 2026-10-09, anteriores à
ativação, e 5 `as_agent_runs` ainda `running`; não são evidência pós-ativação.

Busca por sinais de MCP: nenhum evento com `tools/call`, ator de cliente ou ferramenta de governança; a única ocorrência de
"mcp" é a capacidade `mcp.project_state` da varredura de órfãos.

Ressalva: a ausência de eventos de cliente no ledger não prova ausência de uso do MCP fora do ledger; apenas não há prova de
uso real nesta fonte.

## Veredito por família

**F19 — Estado/observabilidade: permanece `not_authorized`.** O caminho real do ledger existe e está saudável: 10428 eventos
reais, pós-ativação, com projeção em dia. Mas a origem é uma única rotina de sistema, periódica e uniforme (uma ferramenta, um
`input_digest`, um ator), que prova a gravação e a projeção do ledger, não o que a família promete. O requisito F19-R1 exige
estado e evidências expostos por CLI/API/SDK/IDE com as mesmas identidades, consultando tarefa e orçamento por interfaces
distintas; não há aprovações (0), nem sinal de consulta por mais de uma interface, e o `gap` da família segue dizendo "IDE e
ativação operacional pendentes". Na dúvida, não promove. Um recorte estreito (só "ledger e projeção") poderia ser decidido
pelo owner, mas isso redefiniria o escopo da família e não foi feito.

**F20 — MCP: permanece `not_authorized`.** Não há `tools/call` de cliente, recusa registrada nem ferramenta do servidor
`hseos-governance` (a implementação da família) no ledger. O único tráfego com "mcp" é a varredura interna de órfãos do
`project-state`, de origem sistema. O `tools/call` do Codex continua `NOT_EXERCISED`; o gap "consumidores reais" persiste.

## Efeito nos arquivos

`requirements.json` não foi alterado. Para reverter o veredito basta nova evidência: eventos do ledger com ator de cliente MCP
real (`tools/call` do Codex contra `hseos-governance`) para F20, e consulta de tarefa/orçamento por duas interfaces no projeto
ativado para F19.
