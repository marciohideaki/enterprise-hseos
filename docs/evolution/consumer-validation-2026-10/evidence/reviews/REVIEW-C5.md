# Revisão cética C5 (workflow surfaces) — base e079409c, diff staged em crp-c5-workflow-surfaces

Veredito: APROVAR COM RESSALVAS (1 defeito funcional, 1 risco de desempenho, 2 lacunas de cobertura). Nenhum vazamento de caminho do host.

## Achados
1. MÉDIO (defeito) — `PROJECT_FILE_NOT_UTF8` nunca chega ao cliente. `rejectionDetail` (engineering-control-http.js) valida `error.reason` com `/^PROJECT_[A-Z_]+$/`, que não aceita o dígito de "UTF8". Repro: arquivo binário (bytes ff fe fd) em scope.read, POST /v1/prepare -> 409 `{"error":"CONTROL_REQUEST_REJECTED"}` sem `detail`. A mensagem `Project file is not valid UTF-8` é gerada (visto via control.prepare) mas descartada; o código está documentado em docs/engineering-control-api.md. Correção: `/^PROJECT_[A-Z0-9_]+$/`. Sem teste cobrindo.
2. MÉDIO (desempenho) — `events()` varre o ledger global síncrono a cada chamada e, para recurso ocioso, `next_cursor` devolve o `after` recebido, então cada poll reescaneia do mesmo ponto até o fim do ledger, para sempre, bloqueando o event loop (sqlite síncrono). Medido: 50k linhas pequenas = 132 ms (~2,6 ms/1000); extrapola ~2,6 s/poll com 1M linhas (payloads reais com plano/contrato são maiores). Sem teto de varredura, sem índice por aggregate_id. Mitigação: o cursor poder avançar até a posição global varrida (retornando `scanned_to` à parte), ou filtrar por `aggregate_id IN (...)` em SQL, ou teto de linhas por página. Superfície é loopback + credencial, daí MÉDIO e não ALTO.
3. BAIXO (lacuna) — erros de contrato continuam opacos: ENOTDIR (`index.js/x`) e path inválido (`../x`) retornam `ENGINEERING_TASK_CONTRACT_INVALID` (não casa CONTROL_/JOB_), que cai em CONTROL_REQUEST_REJECTED sem detail, porque o contrato é validado antes de workspaceSnapshot. Logo `PROJECT_PATH_INVALID` e o mapeamento ENOTDIR->UNSAFE são inalcançáveis via /v1/prepare. O defeito A4 (erro opaco) persiste para esses casos.
4. BAIXO — `error instanceof TypeError -> PROJECT_FILE_NOT_UTF8` rotula qualquer TypeError (bug interno) como arquivo não-UTF8; classificar pelo `error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA'`.
5. INFO — ordem dos checks mudou: arquivo grande não-regular agora reporta TOO_LARGE antes de UNSAFE (inofensivo).

## Passagem cega — sem defeito
- Cursor: varredura em ordem de position, sem await; não perde nem duplica em eventos intercalados (positions são atribuídas sob transação única de escrita). Teste de paginação com limit 3 cobre.
- Compatibilidade: consumidores de next_cursor (campaign-runner, terminal-attach, jornadas core-journey, test-job-surfaces) usam recursos com cursor próprio (stream_sequence) ou o laço "pare em página vazia"; nenhum assume o fim da janela global. Nenhum código no repo trata EXECUTION_INPUT_INVALID além dos testes/doc.
- `hseos_code`: só é lido de `parsed.error`, objeto retornado por safeParse; entrada não confiável não consegue definir propriedade nele. Só classifyScopeDenial o define (bundles nativos); regex fechada ^[A-Z][A-Z0-9_]{2,63}$. Não forjável.
- Vazamento em `detail`: 8 casos sondados (symlink, hardlink, diretório, grande, sem permissão EACCES, UTF-8, ENOTDIR, ../): nenhuma resposta contém o root do host; `path` é sempre o item de scope.read enviado pelo cliente; fora do caso PROJECT_ só `code` errno (/^E[A-Z0-9]{2,15}$/), nunca message.
- Paridade Python: executado contra serve real (SDK Python -I): `RuntimeError` com `.code=CONTROL_REQUEST_REJECTED` e `.detail={'code':'PROJECT_FILE_UNSAFE','message':...,'path':'dir'}`; idêntico ao JS.

## Confronto das alegações
- events() varre até limit/fim; página vazia = sem novos; next_cursor = último entregue: CONFIRMADA (código + teste), com a ressalva do achado 2.
- workflowEvidence compartilhado com evidence[] por etapa; status sem evidence: CONFIRMADA (teste job-materialization; diff).
- CONTROL_REQUEST_REJECTED com detail curado sem caminhos: CONFIRMADA parcialmente — sem vazamento, mas PROJECT_FILE_NOT_UTF8 (achado 1) e PROJECT_PATH_INVALID (achado 3) não chegam.
- Códigos PROJECT_FILE_UNSAFE/TOO_LARGE/UNREADABLE, PROJECT_RESULT_NOT_APPROVED: CONFIRMADOS (UNSAFE para symlink/hardlink/dir, TOO_LARGE, UNREADABLE para EACCES observados; RESULT_NOT_APPROVED pelo teste).
- ENGINEERING_SCOPE_DENIED via gancho, fail-closed: CONFIRMADA (ainda lança ExecutionContractError).
- SDKs/index.d.ts/CLI expõem detail: CONFIRMADA (JS testado; Python executado).
- RED de B1/B2 contra a base (git archive origin/master + testes staged): PROVADO. Os 3 testes falham na base: boundaries (TypeError: classifyScopeDenial não é função — RED por import ausente, fraco, não por asserção comportamental), "rejected preparation..." e "review of a non-approved task..." (TypeError: detail undefined — RED genuíno). Passam no branch.
- Python só sintaxe: agora há prova de execução (acima).
