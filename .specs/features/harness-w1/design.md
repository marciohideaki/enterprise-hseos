# Design W1

Contexto proprietário: engenharia HSEOS. Estender engineering-task-contract,
engineering-tools, engineering-verifier e engineering-task-runtime; manter
EngineeringTaskState/ExecutionEventLedger como autoridade. Nenhum kernel paralelo.

## Contratos e modelo
v2 acrescenta workspace e baseline verificável. Snapshot de entrada é incorporado
no evento created e não é relido silenciosamente na retomada. Verificadores de
projeto declaram runtime, entrada, casos e expectativas pinados por SHA-256 junto
aos critérios. Registry identifica implementações versionadas; comparações ficam
no controlador, execução de fontes somente no sandbox. v1 continua reconhecida.

## Controle público
Serviço de controle delega criação/inspeção às funções existentes. IDs opacos
resolvem estados registrados pelo servidor. Comandos versionados usam recibos
persistentes de intenção/resultado, precondição de sequência e chave idempotente;
intenção sem recibo exige reconciliação. HTTP loopback autenticado transporta esse
contrato; clientes JS/TS/Python e CLI compartilham métodos. Eventos cursorados são
projeções do ledger. Segredos de ambiente não entram em payloads ou recibos.

## Workspace e segurança
Somente arquivos explicitamente listados, texto UTF-8 limitado; rejeitar links,
travessia e troca de identidade. Snapshot separa execução da árvore original.
Review identifica baseline, alterações e verificações. Aplicação explícita por
Git exige baseline e estado atuais; falhas preservam evidência e não autorizam
retry cego. Verificadores não importam código do projeto no controlador.

## Observabilidade, migração e rollback
Resultados distinguem sessão terminada/tarefa aprovada. Erros tipados sem valores
sensíveis; evidências de isolamento e orçamento permanecem no ledger. Leitores v1
continuam funcionais; downgrade não retoma tarefas v2. Não alterar W0 nem recibos
históricos. Referências: ADR-0043, Constituição §§2.6/5/7, padrões Data Contracts &
Schema Evolution, Hexagonal & Clean Architecture, políticas automated-validation
e capability-graph. Mudanças de implementação que alterem este contrato serão
registradas antes de executar os respectivos testes.

## Projeções adicionais do controle
Status mantém resultado da tarefa separado do encerramento da sessão. A view
`session` projeta o replay da sessão registrada, sem aceitar IDs de sessão externos
ou permitir mutações fora da autoridade da tarefa/workflow. Workflows expõem
evidências por etapa e recebem decisões de reconciliação indexadas pelo ID da
etapa. Aplicação continua exclusiva de tarefa individual; composição de patches
concorrentes de workflow não é autorizada por uma aprovação agregada.

Git do projeto: leitura de configuração sem valores e negação de filtros de
conversão antes de comandos; hooks/fsmonitor desativados, diff/textconv externos
desativados e raiz de trabalho validada/fixada. Isso impede executar extensões
locais do Git no controlador durante revisão e aplicação.
