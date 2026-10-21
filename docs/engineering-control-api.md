# Controle de engenharia W1 e terminais W2

API local v1, contrato de projeto v2. Implementação candidata Linux; não constitui
ativação operacional do schema, certificação de provedores ou distribuição publicada.
Consulte também [contrato anterior](engineering-task-contract.md) e
[SDK](../packages/control-sdk/README.md). O ledger de execução permanece canônico.

## Preparação e execução

Requer Node oficial 22/24 com suporte a remoção de tipos, Git, Python 3 e os
pré-requisitos do executor isolado (bubblewrap, seccomp, cgroup v2 delegado).
`hseos sandbox engineering-check --json` diagnostica o ambiente. Dependências do projeto
não são baixadas automaticamente nem há shell arbitrário. Arquivos de dependências
só ficam disponíveis quando explicitamente incorporados ao escopo permitido.

Para uma demonstração reproduzível instalada fora do checkout:

```sh
mkdir /tmp/hseos-project-demo
node node_modules/hseos/tools/examples/project-task.js typescript-report /tmp/hseos-project-demo --correction
```

`python-inventory` é a segunda opção, em outro diretório vazio. O gerador cria um
projeto Git com cinco arquivos e um `project-example.json` contendo contrato e
respostas determinísticas. Os testes exercitam primeiro a rejeição, depois o
diagnóstico, a correção e o aceite. Essas respostas não representam validação com
modelo real. Os exemplos nunca substituem diretórios existentes.

Crie configuração de servidor com caminhos absolutos canônicos:

```json
{ "workspaces": ["/tmp/hseos-project-demo/typescript-report"], "bindings": {}, "port": 0 }
```

Injete `HSEOS_CONTROL_CREDENTIAL` (pelo menos 32 caracteres) a partir do gerenciador
de segredos do operador; não a coloque no workspace nem em argumentos da CLI.

```sh
hseos control serve --config /caminho/control-config.json
```

O servidor imprime URL loopback, diretório de estado e `operational:false`.
Reabra esse estado com `--state` após reinício. O armazenamento usa a infraestrutura
candidata temporária existente: preserva histórico enquanto o diretório existir,
mas não oferece durabilidade de produção nem migra o banco operacional. Fechar o
cliente HTTP não cancela a tarefa. Encerrar o processo servidor durante um efeito
exige reconciliação. Terminais W2 são drenados após morte do controlador;
recuperação conserva o histórico e não reinicia processos.

## Contrato público

Todas as rotas exigem `Authorization: Bearer ...`. Somente `127.0.0.1`, sem acesso
remoto ou CORS. Pedidos JSON limitados a 2 MiB. IDs de recurso são UUIDs criados pelo
cliente; caminhos privados de estado não são aceitos pela API.

| Método e rota                                          | Resultado                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| POST `/v1/prepare`                                     | Fixa baseline Git, hash do escopo e verificador de uma nova definição v2 |
| POST `/v1/commands`                                    | Executa comando versionado com precondição e recibo                      |
| GET `/v1/tasks/{resource_id}`                          | Estado da tarefa ou workflow registrado                                  |
| GET `/v1/tasks/{resource_id}/session`                  | Projeção da sessão, separada do resultado da tarefa                      |
| GET `/v1/tasks/{resource_id}/evidence`                 | Contrato, artefatos e verificação; workflow retorna evidência por etapa  |
| GET `/v1/tasks/{resource_id}/review`                   | Diferenças e hash de revisão de tarefa individual aprovada               |
| GET `/v1/tasks/{resource_id}/events?after=0&limit=100` | Eventos do ledger, cursor recuperável (1–1000 eventos por página)        |

A rota `tasks` hospeda ambos os tipos de recurso nesta versão. O cursor pertence
ao ledger do recurso; continuar de `next_cursor` após desconexão preserva a ordem.
Para recursos materializados por job (tarefa ou workflow), o servidor lê apenas os streams
do recurso, pelo índice de stream do ledger (custo proporcional aos eventos do recurso, não ao
tamanho do ledger compartilhado): página vazia significa
"sem eventos novos" e `next_cursor` só avança até o último evento entregue (sem eventos,
devolve o `after` recebido). `GET .../evidence` de workflow criado por job traz
`evidence[]` por etapa (`id`, `contract`, `artifacts`, `verification`), igual ao workflow
criado diretamente; `status` não traz `evidence`.

### Autoridade, proveniência e sinais do executor (W5-10, campos aditivos)

`GET /v1/tasks/{id}/evidence` (e `hseos control query --view evidence`, `query(id, 'evidence')`,
`ControlClient.query(id, "evidence")`) ganha, sem alterar nenhum campo v1:

- `context_provenance` (`schema_version:1`): `context_contract` (`v1` ou `v2`), `source_refs`
  (linhagem do último `context.assembled`) e `sources[]` com `source_ref`, `authority`, `origin`,
  `digest` e `trust`. Nunca carrega conteúdo. Sessões v1 devolvem `sources: []`; nenhuma
  autoridade é inventada para fontes que não a declararam.
  O runtime de engenharia declara `authority` e `provenance` das próprias fontes (constituição e
  projeto: `directive`, `config`, `trusted`; critérios protegidos: `data`, `config`, `untrusted`),
  então tasks reais emitem `context.assembled` v2 com `sources[]` preenchido. Fontes de extensão
  seguem sem declaração (autoridade derivada da camada).
- `executor_signals` (`schema_version:1`): `pids_peak`, `memory_peak_bytes`, `init` e `rate_limit`.
  Um sinal sem fonte persistida vale `null` e aparece em `unknown_signals`; `init` e `rate_limit`
  ainda não têm fonte no recibo do executor e são sempre declarados desconhecidos.

`GET .../events` acrescenta `provenance[]` (mesmos campos de `sources[]`) aos eventos
`context.assembled` v2; as demais linhas, e todo o histórico v1, mantêm o formato exato.
`provenance(id)` (JS/TS) e `provenance(resource_id)` (Python) devolvem `context_provenance` e
`executor_signals`; contra um servidor v1 devolvem valores explícitos de "nenhum".

As respostas HTTP removem valores função e campos de código (`executable_code`, `inline_code`,
`source_code`, `script_source`) em qualquer profundidade: nenhum código executável trafega por HTTP. A lista é uma denylist defensiva; a garantia primária é
o contrato recusar código inline antes de criar o job.
Clientes podem reduzir `limit` para limitar o tamanho de cada resposta.

```json
{
  "schema_version": 1,
  "command_id": "00000000-0000-4000-8000-000000000001",
  "resource_id": "00000000-0000-4000-8000-000000000002",
  "expected_sequence": 0,
  "action": "create",
  "input": { "contract": {}, "responses": [] }
}
```

Substitua `contract` e `responses` pelos valores preparados. Para inferência real,
use `binding_id` em lugar de `responses`; o ID deve existir na configuração do
servidor e aponta para binding previamente autorizado. Não há seleção automática
nem migração de cobrança. Workflows aceitam definições com respostas determinísticas;
bindings diretos em suas etapas são rejeitados nesta superfície.

| Ação              | Input                              | Precondição                                         |
| ----------------- | ---------------------------------- | --------------------------------------------------- |
| `create`          | contract + responses OU binding_id | recurso novo, sequência 0                           |
| `create_workflow` | definition                         | contratos v2, workspaces permitidos, recurso novo   |
| `resume`          | vazio ou decisão de reconciliação  | sequência atual da tarefa/sessão raiz               |
| `reconcile`       | vazio                              | sequência atual; pode retornar perguntas            |
| `cancel`          | vazio                              | sequência atual; orçamento e evidências preservados |
| `apply`           | review_sha256                      | tarefa aprovada, revisão e baseline ainda válidos   |

Retente exatamente o mesmo comando e `command_id` após falha de conexão. Com recibo,
o resultado é retornado sem repetir o efeito. Com intenção sem recibo, retorna
`CONTROL_OUTCOME_UNCERTAIN`; não gere outra chave para contornar essa condição.
Consulte estado/eventos e use reconciliação explícita. Uma intenção de criação sem
registro de recurso exige investigação do ledger candidato; não há descoberta ou
adoção automática de diretório órfão.

Decisão de tarefa: `reconciliation_decision` com `report_sha256`,
`decision:"continue-from-observed-state"` e `answer`. Para workflow, use
`reconciliation_decisions:{"id-da-etapa":{...}}`. O hash deve corresponder ao
relatório atual; uma resposta não amplia política, escopo ou orçamento.

### Saída de campanha como resposta da tarefa

Uma dispatch concluída de campanha de provider retém o texto do modelo (até
65536 bytes) como artefato content-addressed em `<estado>/campaign-evidence/<sha256>`;
o recibo ganha `evidence_ref` opcional (`schema_version:1`, `kind:"model_output"`,
`sha256`, `bytes`). Recibos anteriores sem `evidence_ref` continuam legíveis e
respondem `CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE`. Saída acima do limite ou com
formato de credencial não é retida (o recibo é inválido se o adapter a declarar).
O texto nunca aparece em `/events`.

Leitura governada: `GET /v1/provider-campaigns/{id}/evidence?command_id=<dispatch>`,
`hseos control campaign-evidence --resource <id> --command <dispatch>`,
`campaignEvidence(id, commandId)` (JS/TS) e `campaign_evidence(id, command_id)`
(Python). O controle recalcula o SHA-256 contra o recibo aceito antes de devolver
`{resource_id, command_id, task_id, binding_id, binding_sha256, receipt_sha256,
evidence_sha256, bytes, text}`. Erros (409): `CONTROL_CAMPAIGN_NOT_COMPLETED`
(dispatch em andamento), `CONTROL_CAMPAIGN_EVIDENCE_REJECTED` (incerta, reconciliada
ou não concluída), `CONTROL_CAMPAIGN_EVIDENCE_UNAVAILABLE`,
`CONTROL_CAMPAIGN_EVIDENCE_CORRUPT` (hash/tamanho divergente).

Compatibilidade de tipos (SDK TypeScript): `ControlCommand` passou de interface a
união de `TaskCreateCommand` (com `input: TaskCreateInput`, que tipa `responses_from`)
e comandos genéricos com `action` diferente de `create`. Código que declarava
`ControlCommand` com `action:'create'` e `input` livre agora precisa respeitar
`TaskCreateInput` (`contract` obrigatório); `BaseControlCommand` preserva o formato
antigo. Recriação após falha: o mesmo `task_id` e digest de contrato podem reconsumir
a saída sob novo recurso enquanto o consumidor anterior não foi registrado; depois
disso, ou com outro contrato, vale `CONTROL_CAMPAIGN_EVIDENCE_CONSUMED`.

Saída acima do limite ou com formato de credencial é descartada (nunca
redigida) e o recibo declara `evidence_withheld` (`too_large`, `credential_pattern`
ou `integrity_mismatch`): a dispatch continua válida e a leitura responde
`CONTROL_CAMPAIGN_EVIDENCE_WITHHELD`. A gravação é atômica (arquivo temporário
exclusivo, fsync e rename); um artefato truncado no endereço do hash é substituído e
registrado como `evidence_repaired` no ledger da campanha. Um artefato gravado cujo
recibo não chegou a ser confirmado (falha entre gravação e transação) é órfão
inofensivo, sem referência. O envelope do worker aceita o pior caso de escape JSON
de 64 KB.

`create` aceita `responses_from:{ref,binding_sha256}` no lugar de `responses`,
`binding_id` e `plugin_model` (exclusivos). `ref` é
`campaign://<campaign_id>/<command_id>`, onde `command_id` identifica a dispatch e
seu recibo. O texto deve ser o mesmo array `[{name,input}]` das respostas
roteirizadas (opcionalmente em bloco ```json). O controle valida campanha, binding
(`CONTROL_CAMPAIGN_BINDING_MISMATCH`), recibo aceito e hash antes de criar a tarefa;
`CONTROL_CAMPAIGN_EVIDENCE_INVALID` se o texto não for um plano válido. A dispatch deve
pertencer à tarefa (`task_id`da campanha igual ao`task_id`do contrato,`CONTROL_CAMPAIGN_TASK_MISMATCH`) e cada saída alimenta um único recurso
(`CONTROL_CAMPAIGN_EVIDENCE_CONSUMED`; o replay do mesmo comando é idempotente); o
consumo fica no agregado `control_campaign_evidence`, sem alterar a sequência da campanha. A
proveniência (`ref`, `resource_id`, `command_id`, `binding_id`, `binding_sha256`,
`receipt_sha256`, `evidence_sha256`, `bytes`) fica em `response_source`na evidência
da tarefa. Consumir a saída não reserva orçamento nem dispara nova dispatch; jobs
não aceitam`responses_from` (`JOB_RESPONSES_SOURCE_DENIED`).

`CONTROL_SEQUENCE_CONFLICT`, `CONTROL_IDEMPOTENCY_CONFLICT`,
`CONTROL_WORKSPACE_DENIED` e `CONTROL_BINDING_UNKNOWN` negam o comando.
Erros internos são retornados como `CONTROL_REQUEST_REJECTED`; a categoria é estável
e, quando a causa é conhecida e segura, a resposta traz `detail: {code, message?, path?, field?}`
(SDK JS/TS: `error.detail`; Python: `error.detail`; ambos mantêm `error.code`). Códigos de
`detail.code` em `prepare`, `review` e `apply`: `PROJECT_FILE_UNSAFE` (symlink, hardlink,
não regular ou diretório no caminho; `path` é o item de `scope.read`),
`PROJECT_FILE_TOO_LARGE`, `PROJECT_FILE_NOT_UTF8`, `PROJECT_FILE_UNREADABLE`,
`PROJECT_PATH_INVALID`, `PROJECT_SCOPE_CONFLICT` e `PROJECT_SCOPE_INVALID` (contrato v2 recusado em `prepare`; `field` aponta o campo, p.ex. `scope.read[1]`, sem ecoar o valor), `PROJECT_GIT_FILTERS_UNSUPPORTED`, `PROJECT_GIT_ROOT_MISMATCH`,
`PROJECT_WORKSPACE_UNSAFE`, `PROJECT_IDENTITY_CHANGED`, `PROJECT_CHANGED_DURING_SNAPSHOT`,
`PROJECT_BASELINE_CHANGED`, `PROJECT_RESULT_NOT_APPROVED` (review/apply de tarefa não
aprovada), `PROJECT_CANDIDATE_CHANGED`, `PROJECT_APPROVAL_STALE` (baseline vencido ou
`review_sha256` divergente), `PROJECT_CHANGED_BEFORE_APPLY`, `PROJECT_PATCH_READ_ONLY_PATH`;
falhas de sistema de arquivos não curadas expõem apenas o errno (`ENOENT`, ...). Toda
recusa por regra cruzada do contrato de tarefa na criação (`create` e `create_workflow`)
traz `detail.code` próprio com prefixo `ENGINEERING_` (mensagem curada, sem eco de valores):
`ENGINEERING_ACCEPTANCE_WEAK` (aceite sem verificador executável), `ENGINEERING_COMMAND_ARG_INVALID`
(arg fora do alfabeto conservador), `ENGINEERING_PROTECTED_CONFIG_MISSING` (arquivo de configuração
conhecido fora de `protected_paths`) e, só como rótulo das regras que já existiam,
`ENGINEERING_CONTRACT_SCHEMA_INVALID`, `ENGINEERING_CONTRACT_TOO_LARGE`, `ENGINEERING_STORE_MOUNT_CONFLICT`,
`ENGINEERING_DUPLICATE_ID`, `ENGINEERING_SCOPE_INVALID`, `ENGINEERING_INITIAL_FILES_INVALID`,
`ENGINEERING_SOURCE_DIGEST_MISMATCH`, `ENGINEERING_TRACEABILITY_BROKEN`, `ENGINEERING_ACCEPTANCE_MISMATCH`,
`ENGINEERING_COMMAND_ENTRYPOINT_UNREADABLE`, `ENGINEERING_LIMITS_INVALID`, `ENGINEERING_CHECK_PATH_UNREADABLE`,
`ENGINEERING_PROTECTED_PATH_INVALID`, `ENGINEERING_COMMAND_CHECK_UNKNOWN`,
`ENGINEERING_COMMAND_ENTRYPOINT_UNPROTECTED`, `ENGINEERING_COMMAND_ARG_OUTSIDE_ROOT`,
`ENGINEERING_COMMAND_ARG_WRITABLE` e `ENGINEERING_WORKSPACE_DIGEST_MISMATCH`; `error.code` segue
`CONTROL_REQUEST_REJECTED`. As regras de aceite endurecido valem só para novas admissões; contratos já
admitidos continuam legíveis (`docs/engineering-task-contract.md`). Quem
tratava `CONTROL_REQUEST_REJECTED` continua funcionando. Negação de escopo nas ferramentas
de engenharia (caminho fora de `scope.read`/`scope.write`) agora falha com
`ENGINEERING_SCOPE_DENIED` (antes `EXECUTION_INPUT_INVALID`), mantendo fail-closed; os
demais erros de schema continuam `EXECUTION_INPUT_INVALID`. Sem detalhes
sensíveis. Autenticação retorna 401, recurso desconhecido 404 (tarefa, job, terminal, campanha
e vínculo de provider, em consulta e em `/events`), consulta ou cursor malformado 400
(`CONTROL_QUERY_INVALID`, validado antes da existência do recurso), conflitos 409.
Recurso identificado na URL e desconhecido (consulta, `/events` ou comando POST
para campanha ou terminal inexistente) retorna 404; antes retornava 409 para
terminal e campanha (mudança 409 para 404). Referência desconhecida no corpo de
um POST (`CONTROL_PROVIDER_BINDING_UNKNOWN`, `CONTROL_BINDING_UNKNOWN`) continua 409.

### Motivo (`reason`) quando a sessão não conclui

Se a sessão do modelo não chega a `completed`, a tarefa fica `failed` e o `reason`
vem do evento terminal da sessão, não de um valor genérico:

| `reason`                  | Quando                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `session-budget-exceeded` | A sessão terminou com `error_code: budget_exceeded` (orçamento de tokens, turnos ou chamadas) |
| `session-failed:<code>`   | Qualquer outra falha terminal da sessão (`<code>` é o `error_code`)                           |
| `session-not-completed`   | A sessão não tem evento terminal de falha (sem terminal ou cancelada)                         |

Nos dois primeiros casos, a evidência (`evidence` na ação `evidence`) traz
`session_failure: { error_code, message }` e `token_accounting`. Em
`budget_exceeded` por projeção, a mensagem informa projetado, máximo, usado,
request e reserva (`max_output_tokens`). Uma sessão que termina com `stop` não
falha por estimativa de tokens; o limite só impede abrir um novo passo.
Cancelamento e reconciliação mantêm `cancelled` e `reconciliation-required`.

## Aceite protegido e aplicação

O contrato v2 referencia raiz do projeto, `baseline_sha` (HEAD) e hash dos arquivos.
Escopos de leitura/escrita e comandos são enumerados antes da execução. Snapshot
é incorporado ao ledger e executado em cópia isolada. Limites iniciais: até 64
caminhos de texto UTF-8, contrato até 1 MiB e até 65.536 caracteres por arquivo
de entrada. Artefatos respeitam o orçamento agregado declarado em bytes. Caminhos ocultos, links e hardlinks são rejeitados.

| Verificador                           | Critério protegido                            |
| ------------------------------------- | --------------------------------------------- |
| `verifier://project/node-module-v1`   | Retorno JSON de função Node/TypeScript        |
| `verifier://project/python-module-v1` | Retorno JSON de função Python                 |
| `verifier://project/web-content-v1`   | Conteúdo textual estático esperado no arquivo |

Implementação, executável de runtime, fontes, requisitos, aceite e casos são
pinados. Código do projeto roda somente no sandbox; expectativas permanecem no
controlador. TypeScript usa remoção de tipos do Node, **não** uma checagem completa
com `tsc`. O verificador web **não** demonstra renderização, navegação ou browser.
Essas capacidades não são anunciadas como concluídas.

Ferramentas v2 acrescentam busca literal, patch com hash e ocorrência única, e diff.
Comandos executam somente entradas autorizadas. Após rejeição, alteração exige
diagnóstico atual; tentativas e orçamento acumulado são finitos. Reconciliar patch
interrompido exige evidência atual e nunca o reaplica automaticamente.

A revisão vincula resultado verificado, sequência, baseline e diferenças. `apply`
revalida arquivos da candidata e do projeto, exige índice/árvore limpos no escopo,
e aplica via Git ao índice e à árvore de trabalho. A raiz Git deve coincidir com
a raiz declarada. Filtros Git de conversão configurados são rejeitados nesta
versão; hooks, fsmonitor, diff externo e textconv não são executados pelo fluxo. Não cria commit. Edição
concorrente invalida a aprovação. Resultado incerto requer inspeção; rollback
não sobrescreve alterações concorrentes automaticamente. Workflows não têm
aplicação agregada de patches nesta versão.

## Migração e rollback

Leitores v1 e verificadores anteriores permanecem intactos. Novas semânticas usam
v2; não reescrever eventos antigos. Alteração do runtime/verificador invalida seu
pin e exige nova definição preparada e nova execução. Um downgrade não deve
retomar tarefas v2: preserve o diretório, drene/reconcilie efeitos e consulte com a
versão compatível. Desativar a interface não apaga ledger nem evidências.

Terminais e controles interativos candidatos W2 estão descritos abaixo.
Integrações certificadas (W3), browser (W5), IDE (W6) e autorização remota por
usuário/projeto (W7) permanecem ondas separadas. Publicação, merge e ativação
operacional exigem decisões próprias.

## W2 — terminais e jobs candidatos

A superfície Linux compartilha o servidor autenticado, ledger e autoridade da tarefa.
`POST /v1/terminals/commands` recebe o envelope de comandos v1 (`command_id`,
`resource_id`, `expected_sequence`, `action`, `input`). `resource_id` identifica o
terminal; `open` usa sequência zero e input `{task_id, command_id, mode, rows, cols}`.
O `command_id` interno seleciona um comando já declarado no contrato da tarefa;
o externo é a chave idempotente da operação. `mode` é `pty` ou `job`; rows/cols
opcionais iniciam em 24/80, máximo 500. Nenhum argumento, PID, ambiente ou caminho
arbitrário é aceito pelo cliente.

Ações: `input` (`data` base64 canônico, até 4096 bytes), `resize` (`rows`, `cols`),
`pause`, `continue`, `interrupt`, `eof`, `terminate`, `recover`, `reconcile`.
Reconciliação exige `report_sha256` atual e `answer` explícita. Outras ações usam
input vazio. Há teto de 1024 intenções por terminal para controles comuns; controles
de recuperação/encerramento continuam disponíveis. Pausa mantém deadline correndo.

`GET /v1/terminals/:id` retorna sequência, estado, prova de descendentes terminados
e incertezas. `/events?after=0&limit=100` retorna eventos do terminal, cursor por
sequência (diferente do cursor global de tarefas), limite máximo 1000. Saída é base64
para não perder bytes/fragmentos UTF-8. Cliente só avança cursor após consumir bytes;
reconexão com cursor não repete efeitos. Duplicação de visualização por cursor antigo
é responsabilidade do cliente. Nenhum retry mutante é automático.

`hseos control terminal-command --request command.json --url ...` executa comandos;
`terminal-query` e `terminal-events` consultam `--resource ID`. `terminal-attach`
anexa stdio explicitamente, aceita `--after`, propaga redimensionamento e restaura
raw mode ao sair. Ctrl-] desanexa sem matar o processo; Ctrl-C interrompe; Ctrl-D
envia EOF. A anexação interativa renderiza saída não confiável; clientes de interface
devem tratar sequências ANSI como dados até decisão explícita de renderização.

SDK JS/TS: `terminal`, `terminalQuery`, `terminalEvents`. SDK Python: `terminal`,
`terminal_query`, `terminal_events`. Todos usam a mesma identidade/autenticação.

Terminais são admitidos antes do início da execução do modelo. Cada open reserva
uma chamada do orçamento da tarefa; o runtime soma essas reservas ao consumo de
ferramentas. Parent resume/apply exigem terminais encerrados e reconciliados.
Cancelamento da tarefa fecha admissões e drena seus terminais. Chamadas diretas ao
runtime também verificam reservas e não podem declarar cancelamento de árvore viva.
Reservas conservadoras sem registro de controle após crash são liquidadas somente
pelo cancelamento explícito da tarefa, permanecendo gastas/incertas.

Cliente desconectado: processo continua no controlador. Controlador morto: broker
observa EOF, termina o cgroup e descendentes; recuperação remove grupo residual.
`recover` nunca relança processos. Mesmo um receipt de open não prova o resultado
final após crash. Falha entre efeito e receipt preserva intenção e bloqueia novas
mutações, exceto encerramento/recuperação/reconciliação. Reconciliar não cria recibo
fictício nem transforma retry de comando antigo em nova execução.

A candidata reutiliza schema 11 e não migra o operacional v4. Workspace permanece
readonly, rede negada e ambiente do host oculto. Terminais não aprovam entregas;
a verificação protegida da tarefa continua sendo necessária. Estado em fixture
temporário não promete retenção após reboot/limpeza. W1 e seus recibos são históricos.
