# W4-04a2b — revisão e limites

Base `6bba910d`, task `hseos-w4-workflow-revision-engine`. FR04/05/06; contrato
`workflow-revision-engine-implementation.md`; intake v2 de reservas estendido.

O engine usa somente definições presentes na cadeia durável. Releitura em cada
fronteira de fase acrescenta fases sem alterar trabalho iniciado; checkpoints
retêm o digest que descrevia a fase. Checkpoint/release vencidos por uma revisão
fazem CAS, releitura e continuação. O release `completed` exige checkpoint de
todas as fases correntes e recusa cancelamento durável.

Revisor cético isolado, somente leitura, encontrou uma corrida alta: cancelamento
inserido após o último checkpoint podia ser seguido por release `completed`.
Correção recusa sucesso ao observar `cancellation_request`; se o cancelamento
vence o CAS, relê e encerra como `cancelled`. Teste negativo intercepta o append
de release. Segunda passagem confirmou o fechamento desse achado sem bloqueio
residual no caminho analisado. O revisor não executou testes.

Os 31 testes focados passaram em Node 22/24, sem skip. Cobertura integral do
kernel: workflow-engine.js 93,2% linhas/81,99% branches; event-contracts.js
94,15%/81,81%; replay.js 91,52%/90,76%, iguais nas duas versões. Dezoito
mutantes dirigidos foram rejeitados em cada versão. A primeira rodada Node 24
do harness de mutação teve falha de expectativa: o mutante da definição corrente
produziu `WORKFLOW_DEFINITION_CONFLICT`, que é a falha de contrato esperada, mas
o harness exigia texto `ERR_ASSERTION`. A expectativa foi corrigida; a falha
inicial e as rodadas verdes estão preservadas no recibo.

Uma rodada Node 24 do gate expôs uma corrida preexistente no cancelamento de
workflow: se o pedido chegava antes do primeiro `send`, o filho não iniciado era
classificado como `blocked` e a reserva terminava como `failed`; o job ficava
`uncertain`. O teste existente reproduziu a falha em 1 de 10 execuções
isoladas, e a instrumentação mostrou o filho sem início e o pai cancelado.
O runtime agora registra `not_executed: cancelled` nesse caso; o engine relê o
cancelamento durável antes de liberar a reserva. O mesmo teste passou em 20
execuções consecutivas. O mutante de release remove as duas proteções e foi
rejeitado. A segunda revisão cética confirmou que não há regressão demonstrável
no caminho normal. Identificou uma lacuna preexistente para W4-04b: `#spawn`
registra o filho somente após validar o recibo; uma falha após o fork durável e
antes do recibo pode deixá-lo fora de `active.children`, que é a fonte usada
pela drenagem. W4-04b deve injetar essa falha e reconciliar os filhos do stream
do pai antes de declarar a árvore terminal. Essa revisão foi somente leitura.

Gate integral Node 22 oficial passou sem falhas/avisos. O binário Node 22 do
sistema foi compilado sem TypeScript e produziu `ERR_NO_TYPESCRIPT` em testes
de projeto; por isso a certificação usa Node 22.22.1 oficial com
`better-sqlite3` recompilado para esse binário. Tentativas diagnósticas que
falharam por módulo nativo incompatível, npm do sistema e symlink de módulo
estão preservadas no recibo. Gate e validação governada Node 24 passaram,
com um aviso preexistente de placeholders em template. Cobertura final
Node 22/24: workflow-engine.js 93,23% linhas e 82,07%/81,99% branches;
event-contracts.js 94,15%/81,81%; replay.js 91,52%/90,76%.
Hook de commit e integração à feature permanecem pendentes.

Lint passou. `npm run format:check` global aponta 113 arquivos preexistentes fora
da task; Prettier em todos os arquivos modificados e `git diff --check` passaram.

Pendente para W4-04b: `cancel()` ainda grava `workflow.released: cancelled`
antes de drenar todos os filhos. Esta task não certifica término transitivo,
expansão running no JobControl, orçamento composto ou superfícies públicas.
Nenhuma chamada paga, publicação, ativação ou merge na foundation.
