# W4-04a2a — revisões da reserva de sessão

Unidade isolada da W4-04a2, dependente de W4-04a1 integrada. Esta worktree pode
preparar contrato enquanto04a1 valida; código somente após fast-forward da feature.
Base inicial de preparação:991e721d. FR04/05/06, workflow.md e ADR-0045 Proposed.
Não certifica expansão running integrada nem altera a ativação operacional.

## Contrato e reuso

Estender SessionEventSchema e replaySessionEvents com evento aditivo
workflow.revised. O envelope existente AgentSessionEventRecorded v1 comporta o novo
tipo interno; não editar migrações históricas nem adicionar store/balanço/evento
SQL sem necessidade. WorkflowDefinitionSchema v1 e eventos antigos mantêm forma e
interpretação quando não há revisões. Não acrescentar campos vazios aos replays antigos.
Compatibilidade significa novos leitores lendo streams antigos; leitores antigos
continuam recusando o tipo workflow.revised desconhecido, sem rollback silencioso.

Payload estrito: workflow_id, claim_ref, revision (inteiro seguro >=2),
previous_definition e definition, ambas pelo WorkflowDefinitionSchema atual.
Digest é derivado da definição normalizada com a autoridade existente de canonicalJson.
O digest anterior deve ser o da reserva atual; revision começa2 e cresce exatamente1.
A definição anterior deve reproduzir IDs/quantidade da reserva e, após primeira revisão,
a definição corrente persistida. Uma revisão acrescenta fases completas ao final;
fases, nós, mensagens, contratos e identidades anteriores permanecem idênticos.
Identidade de workflow/provider e max_parallelism permanecem iguais. Join timeout pode
mudar para atender novos nós, mas revalida o pior caso completo sob duração original;
o engine só consumirá a nova definição em fronteira segura na unidade seguinte.

A reserva deve existir, estar ativa e possuir exatamente claim_ref atual. Recusar
cancelamento pendente ou sessão terminal. Revisão NÃO renova claim_expires_at,
claim_id, claim_ref, deadline de sessão nem limites. Exigir claim corrente, não lease temporalmente vigente: expiração sozinha não cria
novo dono nem invalida o dono que continua ativo. Esta unidade não implementa
recuperação de processos e nunca altera os campos temporais do claim.

Somar todos os steps da definição nova (inclusive já concluídos) e demais reservas;
respeitar max_workflow_steps e max_children do pai. A contagem de filhos usa união
de anexados e reservados (mesmo ainda não anexados), incluindo reservas anteriores.
Recusar identidade de filho pertencente a outro workflow. Cada child mantém parent_session_id,
authority_ref e policy_ref do pai e não amplia qualquer limite individual. A soma de
max_tokens/max_tool_calls/max_turns de todos os steps desta definição respeita os
tetos originais; orçamento monetário continua em ProviderCampaignControl, fora deste
reducer. Nesta unidade, revisão exige pai controlador sem turns/modelo/tool invocations
próprios e sem reservas/filhos fora do workflow corrente. Se existir consumo próprio
ou orçamento de outra reserva/filho (v1 não registra os seus limites), recusar com
AGENT_SESSION_WORKFLOW_BUDGET_UNKNOWN; não assumir saldo livre nem inventar limites
a partir de digests. Os consumidores de engenharia atuais usam esse pai controlador.
Composição de orçamento para outros contextos fica para W4-05. A soma de limites dos
filhos atuais inclui todos os concluídos; não somar novamente o gasto desses filhos
às suas reservas integrais. Todos os IDs continuam únicos pelos schemas existentes. Não remover steps,
filhos reservados, reservas anteriores, gasto ou resultados aceitos.

Persistir histórico da definição apenas nas reservas revisadas. Atualizar o digest
corrente em reservation.definition_digest e, se presente, state.workflows[id].definition_digest;
claim_ref e digests dentro dos checkpoints históricos nunca mudam. Na primeira
revisão, validar TODOS os checkpoints já existentes contra previous_definition
(digest, fase, modo, steps e filhos), recusando evidência incompatível sem a reescrever.
Checkpoints antigos
permanecem intactos com seu digest original. Depois de uma revisão, aceitar checkpoint
apenas se seu digest pertence à cadeia e sua fase/modo/steps/filhos correspondem
exatamente à definição daquela revisão. Cada phase_id continua checkpointado no
máximo uma vez. Release/reclaim continuam exigindo digest corrente e claim correto.
O replay v1 sem revisões conserva seu comportamento anterior.

CAS e idempotência reutilizam RelationalSessionEventStore.append; revisão concorrente
com append/checkpoint/cancelamento não substitui dados nem ganha autoridade. Evento
malformado falha antes do append. Queries/replay não executam children ou providers.

## Limite desta entrega

Contrato/reducer, testes e um guard explícito de consumo. WorkflowEngine.run deve
recusar reserva persistida com revision>1 (WORKFLOW_REVISION_NOT_SUPPORTED) no caminho
comum, antes de provider.manifest, reclaim ou qualquer efeito. Não usar revisão enviada
pelo caller. Isso cobre inclusive a reserva sem checkpoints com claim expirado, que
o engine estático atual poderia retomar com a definição corrente. W4-04a2b substituirá
esse guard pela integração de revisões, checkpoints e reserva original. Não expor
comando novo no CLI/API nem habilitar JobControl.expand para running nesta unidade.
A preparação dos filhos e materialização por revisão virão em W4-04a2c; nenhuma
reescrita de planos/arquivos existentes é autorizada por esta task.

## Arquivos e verificação

- packages/agent-runtime-contracts/event-contracts.js: evento novo com schemas existentes.
- packages/agent-session-store/replay.js: validação, reserva incremental e checkpoints.
- packages/agent-orchestration/workflow-engine.js: guard de consumo prematuro, sem alterar v1.
- test/test-workflow-reservations.js: contrato/replay/reabertura/CAS negativos e positivos.
- package.json: teste nas suítes de sessão/kernel; sem ampliar superfície empacotada.
- docs/decisions/harness-w4-workflow-reservations-intake.md: intake extend.
- docs/evolution/w4/evidence/workflow-reservations/* e STATUS.md.

Cenários: revisão inicial/encadeada, reserva semântica preservada, v1 intocado,
hashes/IDs/claims/revisões falsos, checkpoint anterior incompatível, orçamento desconhecido,
filhos anexados ou reservados fora do workflow, remoção/alteração retroativa, teto agregado e individual,
identidade/política errada, prazo de claim inalterado, cancelamento/terminal, checkpoint
antigo legítimo e falso, release/reclaim com digest obsoleto, replay integral/incremental,
duas conexões CAS e comando duplicado, rollback sem alterar a reserva; engine recusa
reserva revisada sem checkpoints e com claim expirado, sem provider/evento/reclaim,
enquanto o caso v1 legítimo permanece funcional.

Comando focal: node --test --test-concurrency=1 test/test-workflow-reservations.js
 test/test-agent-session-store.js test/test-agent-runtime-contracts.js test/test-agent-orchestration.js.
Node22/24 sequenciais; cobertura90%linhas/80%branches por arquivo crítico incluindo
arquivos não executados; mutantes de teto/claim/revisão; revisor isolado e gate antes
 de commit. Toda falha preservada e corrigida sem reduzir thresholds.

## Continuidade de integração

Job materialization atual calcula deadline de cada filho como mínimo entre prazo do
pai e first_started_at + duração do filho. A integração04a2c precisa ensaiar o filho
adicionado tardiamente, estabelecendo sua janela uma única vez e limitando-a ao prazo
original do pai, sem renovar nenhum nó já iniciado. Não presumir que a regra atual
satisfaz esse cenário só porque o workflow curto de04a1 passou.
