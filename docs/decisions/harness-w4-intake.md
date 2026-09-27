# Intake v2 — W4: extend

Tipo: intake pré-implementação, 2026-09-27. Owner: owner.platform-architecture /
HSEOS engenharia. Escopo: extensibilidade e controle de engenharia do produto.
Resultado: extend. Constituição §2.6; capability-graph; ADR-0043/0044/0045 Proposed.

## Descoberta exata e semântica

Grafo: .enterprise/governance/capabilities/registry.yaml e fragment
.enterprise/governance/capabilities/fragments/enterprise-hseos.yaml na base
32eaef270f192fcc58056f96a3cad39c265cd455. Consulta determinística por
capability.hseos.project-engineering retornou a capacidade proposed, os contratos
contract.hseos.project-task.v2 e contract.hseos.control.v1, módulos
module.hseos.project-engineering/module.hseos.control e owner.platform-architecture.
O SDK está registrado como package.hseos.control-sdk. Nenhuma promoção de lifecycle
ou alegação de pacote publicado/consumidor adotado deriva deste intake.

Consultas nominais plugin/orchestration/execution no grafo retornaram [];
validate-capability-reference-corpus.js --query scheduler retornou []. Esse escopo
não prova ausência global. hseos capability-check plugin não encontrou candidato;
scheduler encontrou packages/governed-execution/scheduler.js. Inspeção manual do
catálogo existente encontrou plugins-source.js e plugin.js, portanto reutilizá-los.
Descoberta semântica: unavailable; .axon/index.duckdb não encontrado no checkout.

## Candidatos, assinaturas e fronteiras

| Candidato / path                                                            | Assinatura atual                                                                                      | Decisão                                                                |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| packages/governed-execution/scheduler.js                                    | GovernedExecutionScheduler({contracts,port,maxConcurrency,maxQueue}).enqueue(request)                 | Preservar scheduler de efeitos; estender controle com projeção de jobs |
| tools/mcp-project-state/lib/execution-event-ledger.js                       | append(request), appendBatch(requests), readStream(type,id), readGlobal(cursor)                       | Estender agregado/eventos versionados; nenhum store paralelo           |
| tools/cli/lib/engineering-control.js                                        | EngineeringControl.execute(raw), query(id,view), events(id,cursor)                                    | Estender serviço com job commands e worker                             |
| tools/cli/lib/provider-campaign-control.js                                  | ProviderCampaignControl.execute(raw), query(id), admitDispatch(...)                                   | Reutilizar autoridade monetária, reserva e incerteza                   |
| tools/cli/lib/engineering-workflow-runtime.js                               | parseEngineeringWorkflow(value), runEngineeringWorkflow(options), inspectEngineeringWorkflow(options) | Estender v2 e expansão sem reescrever v1                               |
| packages/agent-orchestration                                                | WorkflowEngine.run/cancel, LocalSubagentProvider.spawn/join/cancel, AgentExecutionSupervisor          | Preservar lineage, recursos e drain                                    |
| packages/agent-isolation-attestation/executor.js                            | executeIsolatedCommand({policy,command,timeout_ms,max_output_bytes,signal,host_node})                 | Reutilizar isolamento/conformance; sem require externo no host         |
| tools/cli/installers/lib/core/agent-core-compiler/sources/plugins-source.js | validatePluginRegistryDocument, loadActivePluginManifests, verifyActivePluginConformance              | Estender catálogo v3; conformance de execução não usa host             |
| packages/tool-runtime; packages/model-providers; packages/agent-context     | contratos de ferramenta/modelo/contexto                                                               | Adaptar entrada/saída isolada aos ports existentes                     |
| packages/control-sdk                                                        | ControlClient JS/TS/Python                                                                            | Estender transporte, sem nova autoridade                               |

## Consumidores, riscos e controles

Consumidores candidatos: CLI, API loopback, SDKs JS/TS/Python, job worker e pacotes
externos ferramenta/provider/contexto. Extensão usa os ports e a composição
existentes; não promove novo core nem duplica ledger/política/budget. Registro
canônico de evidências será atualizado no fechamento somente com fatos verificados.

Riscos: import prematuro, TOCTOU de conteúdo, saldo duplicado, efeito incerto repetido,
lease tomado de dono vivo, join sem aceite, rollback incompatível. Controles:
schemas estritos, snapshots pinados, cgroup/bwrap/seccomp, reserva antes de efeito,
CAS/fencing, identidade de processo, reconciliação e testes de falha/compatibilidade.

Produtor global e709368ead6e53ee1fd8e4428bc8913a3a4e8292: governance-discovery,
core/\_INDEX e Constituição lidos. Governance-context explícito resolveu produtor
instalado; resolução não certifica aplicação. AEW inspecionado separadamente:
aew stack resolve falhou sem base configurada. Aplicação/enforcement não verificados.
