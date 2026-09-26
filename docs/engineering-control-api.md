# Controle de engenharia W1

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
{"workspaces":["/tmp/hseos-project-demo/typescript-report"],"bindings":{},"port":0}
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
exige reconciliação; a continuidade operacional de terminais pertence à W2.

## Contrato público

Todas as rotas exigem `Authorization: Bearer ...`. Somente `127.0.0.1`, sem acesso
remoto ou CORS. Pedidos JSON limitados a 2 MiB. IDs de recurso são UUIDs criados pelo
cliente; caminhos privados de estado não são aceitos pela API.

| Método e rota | Resultado |
|---|---|
| POST `/v1/prepare` | Fixa baseline Git, hash do escopo e verificador de uma nova definição v2 |
| POST `/v1/commands` | Executa comando versionado com precondição e recibo |
| GET `/v1/tasks/{resource_id}` | Estado da tarefa ou workflow registrado |
| GET `/v1/tasks/{resource_id}/session` | Projeção da sessão, separada do resultado da tarefa |
| GET `/v1/tasks/{resource_id}/evidence` | Contrato, artefatos e verificação; workflow retorna evidência por etapa |
| GET `/v1/tasks/{resource_id}/review` | Diferenças e hash de revisão de tarefa individual aprovada |
| GET `/v1/tasks/{resource_id}/events?after=0&limit=100` | Eventos do ledger, cursor recuperável (1–1000 eventos por página) |

A rota `tasks` hospeda ambos os tipos de recurso nesta versão. O cursor pertence
ao ledger do recurso; continuar de `next_cursor` após desconexão preserva a ordem.
Clientes podem reduzir `limit` para limitar o tamanho de cada resposta.

```json
{
  "schema_version":1,
  "command_id":"00000000-0000-4000-8000-000000000001",
  "resource_id":"00000000-0000-4000-8000-000000000002",
  "expected_sequence":0,
  "action":"create",
  "input":{"contract":{},"responses":[]}
}
```

Substitua `contract` e `responses` pelos valores preparados. Para inferência real,
use `binding_id` em lugar de `responses`; o ID deve existir na configuração do
servidor e aponta para binding previamente autorizado. Não há seleção automática
nem migração de cobrança. Workflows aceitam definições com respostas determinísticas;
bindings diretos em suas etapas são rejeitados nesta superfície.

| Ação | Input | Precondição |
|---|---|---|
| `create` | contract + responses OU binding_id | recurso novo, sequência 0 |
| `create_workflow` | definition | contratos v2, workspaces permitidos, recurso novo |
| `resume` | vazio ou decisão de reconciliação | sequência atual da tarefa/sessão raiz |
| `reconcile` | vazio | sequência atual; pode retornar perguntas |
| `cancel` | vazio | sequência atual; orçamento e evidências preservados |
| `apply` | review_sha256 | tarefa aprovada, revisão e baseline ainda válidos |

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

`CONTROL_SEQUENCE_CONFLICT`, `CONTROL_IDEMPOTENCY_CONFLICT`,
`CONTROL_WORKSPACE_DENIED` e `CONTROL_BINDING_UNKNOWN` negam o comando.
Erros internos são retornados como `CONTROL_REQUEST_REJECTED`, sem detalhes
sensíveis. Autenticação retorna 401, recurso desconhecido 404, conflitos 409.

## Aceite protegido e aplicação

O contrato v2 referencia raiz do projeto, `baseline_sha` (HEAD) e hash dos arquivos.
Escopos de leitura/escrita e comandos são enumerados antes da execução. Snapshot
é incorporado ao ledger e executado em cópia isolada. Limites iniciais: até 64
caminhos de texto UTF-8, contrato até 1 MiB e até 65.536 caracteres por arquivo
de entrada. Artefatos respeitam o orçamento agregado declarado em bytes. Caminhos ocultos, links e hardlinks são rejeitados.

| Verificador | Critério protegido |
|---|---|
| `verifier://project/node-module-v1` | Retorno JSON de função Node/TypeScript |
| `verifier://project/python-module-v1` | Retorno JSON de função Python |
| `verifier://project/web-content-v1` | Conteúdo textual estático esperado no arquivo |

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

Interrupção/pausa interativa, terminais (W2), integrações certificadas (W3), browser
(W5), IDE (W6) e autorização remota por usuário/projeto (W7) permanecem ondas
separadas. Publicação, merge e ativação operacional exigem decisões próprias.
