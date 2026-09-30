# W4-04a1 — revisões de workflow antes do claim

Escopo: primeira subdivisão de W4-04a, dependente de W4-03d integrada. A worktree
pode preparar este contrato enquanto W4-03d valida; código só após incorporar a feature
com W4-03d. FR04/05/06, workflow.md, intake v2 e ADR-0045 Proposed continuam autoridades.
Esta unidade não certifica expansão running nem fechamento da W4.

## Contrato

Workflow v1 permanece aceito sem alteração de forma/hash. Workflow v2 acrescenta
revision (inteiro >=1), previous_definition_sha256 (null na revisão 1, hash nas
seguintes). Create aceita somente revision=1 e previous_definition_sha256=null; demais revisões nascem
exclusivamente de expand. O hash inclui a definição completa normalizada, inclusive
metadados de revisão. O recibo original de create permanece imutável.

O caminho workflow atual não admite binding/modelo/plugin/extensões por nó. W4-04a1
continua recusando esses campos; a seleção pinada de workflow prevista em workflow.md
permanece pendente, sem alegação de integração nesta unidade. Identidade, limites, paralelismo e contratos de
nós existentes permanecem imutáveis entre revisões.

O comando expand usa envelope existente (command_id, resource_id, expected_sequence),
definition_sha256 atual e lista não vazia de novos nós. Somente job workflow queued,
v2, sem claim/preparação/execução pode aceitar nesta unidade. Running é recusado até
W4-04a2 integrar engine/reserva incremental. Cancelamento e claim concorrem pela mesma
sequência do agregado; apenas o vencedor avança. Repetição idêntica retorna recibo
original; command_id reutilizado com conteúdo diferente falha.

Admitir definição candidata completa pelos parsers e autoridade existentes. Todos
os nós anteriores devem permanecer byte-equivalentes após normalização. Novos nós
não podem repetir IDs; dependências/ciclos e soma de reservas usam todos os nós,
incluindo resultados já aceitos quando W4-04a2 estiver disponível. O teto de 16 tarefas, o paralelismo máximo de 8,
limites originais e prazo absoluto não aumentam. A expansão não executa trabalho.

Evento novo JobWorkflowExpanded v1, migração 016 aditiva candidata, sem ampliar
JobCommandRecorded v1 (create/cancel). Revisão persiste no ledger, não em arquivo
mutável independente. Replay valida a cadeia de hashes/revisões, recibos e admissão. Expand atualiza definição e admissão/digest
atomicamente após reler sequência/status depois da admissão assíncrona. Claim fixa
a revisão corrente; materialização posterior usa essa revisão imutável e mantém
seu plano. Não reescrever planos existentes. Nenhum saldo novo e nenhuma reserva monetária na expansão queued.

## Implementação e verificação

Reusar parseEngineeringWorkflow, parseCreationInput/admitCreation, JobControl e ledger.
Reusar projectWorkspaceSnapshot, já consumido pelo worker, para conferir baseline e
arquivos de todos os nós após admissão e antes do append. Essa leitura não executa o job.
Outputs: engineering-workflow-runtime.js, job-contract.js, job-control.js;
test/test-workflow-expansion.js; scripts de suíte/cobertura quando necessários;
migração 016 e consumidores da versão candidata;
test/helpers/job-expansion-process.js para disputa real entre processos; mutantes
dirigidos em test/test-kernel-mutations.js e test/fixtures/kernel-mutation-loader.cjs;
evidência docs/evolution/w4/evidence/workflow-revisions. Não editar migrações históricas.
Nenhuma atualização de threshold está implicitamente autorizada.

Cenários: leitura e replay v1; v2 com revisão inicial inválida; expansão válida e encadeada; hash ou
sequência obsoletos; duplicação/reuso command_id; dois controladores; cancel/claim
concorrente; IDs/deps/ciclo; extrapolação de cada limite; alteração de nó/limites
originais; reinício; definição expandida materializada e despachada uma única vez; running negado.
Comando focal: node --test --test-concurrency=1 test/test-workflow-expansion.js
 test/test-job-control.js test/test-job-materialization.js. Executar em Node 22 e 24 sequenciais,
cobertura por arquivo crítico de 90% de linhas e 80% de branches, revisão isolada, gate antes de commit.

## Continuidade W4-04a2

Engine hoje fixa definition_digest na reserva e checkpoints. Não trocar workflow_id
para contornar isso. Nova revisão precisa estender reserva original e preservar gasto,
aceites e IDs. Fases numéricas não podem renumerar checkpoints já aceitos. Preparar
somente filhos novos, com IDs duráveis e deadline limitado ao pai; dispatcher e
settlement precisam observar a mesma revisão. W4-04b conserva joins/drift/drain e retries
explícitos, sem repetir nós aceitos.
