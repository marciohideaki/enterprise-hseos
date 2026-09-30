# Intake v2 — reserva de workflow revisável

Resultado: extend. Escopo04a2a, FR04/05/06; ADR-0045 Proposed. Complementa intake W4.
Preparado antes de código na branch task/hseos-w4-workflow-reservations, base991e721d;
implementação depende da integração04a1 e atualização da base.

Grafo consultado: .enterprise/governance/capabilities/fragments/enterprise-hseos.yaml,
capability.hseos.project-engineering, contract.hseos.project-task.v2,
module.hseos.project-engineering, module.hseos.control e owner.platform-architecture.
Lifecycle proposed preservado; nenhum novo registro ou promoção inferida.

hseos capability-check WorkflowDefinitionSchema não encontrou candidato pelo índice
nominal. Isso não prova ausência: inspeção escopada encontrou o schema em
packages/agent-runtime-contracts/orchestration-contracts.js. Descoberta semântica
unavailable: índice Axon ausente no checkout, conforme evidência anterior da W4.

| Candidato | Assinatura | Decisão |
| --- | --- | --- |
| WorkflowDefinitionSchema | schema estrito de fases/steps/filhos únicos | consume para ambas as definições |
| SessionEventSchema | union tipada de eventos de sessão v1 | extend com workflow.revised |
| replaySessionEvents | reducer puro e canonicalJson/digest existentes | extend reserva corrente, sem novo saldo |
| RelationalSessionEventStore | append, replay, appendBatch e CAS | consume atomicidade, reabertura e recibos |
| WorkflowEngine | run/cancel, reserva e checkpoints | consumo posterior em04a2b, não duplicar engine |

Consumidores: engine de workflows, dispatcher de jobs e composição de engenharia.
Riscos: perder checkpoint, ampliar limites, renovar claim, ressuscitar terminal,
reescrever v1. Controles: cadeia/digest, append-only, CAS, tetos cumulativos,
campos de ownership preservados, compatibilidade e testes negativos.

Não há helper/store/autoridade financeira paralela. Dados antigos não recebem campos
ou eventos novos retroativamente. Aplicação/enforcement AEW continuam NOT VERIFIED.

Limite explícito04a2a: pai controlador sem consumo próprio e sem outro workflow/filho
com orçamento desconhecido. As reservas v1 não contêm limites financeiros/de recursos
de outros workflows; tal contexto é recusado, não tratado como saldo disponível.
Composição mais ampla permanece em W4-05; não criar contador alternativo.
