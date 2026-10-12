# Re-revisão C5 (rodada 2) — staged em crp-c5-workflow-surfaces (cópia exata em /tmp/hseos-crp/rev/new via checkout-index)

| # | Achado | Estado | Evidência |
|---|---|---|---|
| 1 | NOT_UTF8 sem detail | FECHADO | regex `[A-Z0-9_]`; sonda HTTP: `detail.code=PROJECT_FILE_NOT_UTF8,path=bin.dat`; teste em test-engineering-control.js:220 |
| 2 | Desempenho da varredura | FECHADO (ver ressalva) | `readAggregates` por índice de stream (UNIQUE(aggregate_type,aggregate_id,stream_sequence) + idx_execution_events_stream); custo proporcional às linhas do recurso; mescla por position e `slice(limit)` correta |
| 3 | Erros de contrato opacos | FECHADO (1 lacuna menor) | diagnoseScope espelha o parser (1-64, 240, regex, conflito pai/arquivo, write ⊆ read). Sondas: `../SECRETVALUE` -> PROJECT_PATH_INVALID field `scope.read[1]`; `index.js/x` -> PROJECT_SCOPE_CONFLICT field `scope`; write fora de read -> SCOPE_INVALID `scope.write`; read vazio -> SCOPE_INVALID. `field` só nome+índice, nenhum valor ecoado (SECRETVALUE/SECRETW ausentes das respostas). Lacuna: paths duplicados em read ficam sem detail |
| 4 | TypeError rotulado NOT_UTF8 | FECHADO | agora `error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'` |
| 5 | RED fraco do boundaries | NÃO REVERIFICADO nesta rodada (fora do escopo pedido) |

## Foco: lista fixa de agregados (control_job, control_task, engineering_task, agent_session)
Veredito: nada perdido com os fluxos existentes; risco latente, não perda observada.
- Escritores de `aggregate_type` no repo (grep): control_job, control_task, engineering_task, control_terminal, terminal_budget, control_campaign(aggregate var), execution (id = operation_id gerado pelo kernel), delegated_runtime (id = session_id, só nos runtimes delegados the other delegated providers, que não são usados por tarefas engineering), agent_session, import_batch/organization (outro domínio/ledger).
- Comparação empírica antiga x nova (preload em cópia exata do staged; para cada chamada de `events()` de recurso job-criado reexecuta a varredura global antiga e compara positions): test-job-materialization 13 chamadas job, 0 divergências; tipos vistos sob ids do recurso: control_job 17, control_task 24, engineering_task 8, agent_session 5 (nenhum outro). test-engineering-control (recurso direto, caminho inalterado) e test-job-faults/workflow-expansion (dispatch real em processos filhos): tipos gravados no ledger = só control_job, engineering_task, agent_session, control_task; nenhum 'execution'/'delegated_runtime'/'control_terminal' sob ids de tarefa job-criada. Ressalva da prova: nesses testes `events()` de job-criado só é chamado nos de materialização; os de dispatch foram usados só para provar quais tipos são gravados.
- Residual: se algum dia um tipo fora da lista gravar com id de tarefa/sessão (ex.: delegated_runtime usa session_id), a nova versão o omite em silêncio (a antiga o incluía). Recomendação BAIXA: teste-guarda que percorre um ledger de dispatch e falha se existir linha cujo aggregate_id esteja no conjunto do recurso e tipo fora de OWNED_AGGREGATE_TYPES.

Veredito: APROVAR. Nenhum achado ALTO.
