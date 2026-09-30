# Intake v2 — harness-w1-engineering

schema_version: 2; intake_id: harness-w1-engineering-20260925; outcome: extend.
Owner: enterprise-hseos. Necessidade/escopo: contrato v2, verificadores, workspace
e controle público para consumidores CLI/API/SDK; especificação em
.specs/features/harness-w1/spec.md.

Evidência exata: registry.yaml e fragment enterprise-hseos.yaml (schema1) enumeram
governança de capabilities, sem nó de engenharia/control API. Consulta
`node scripts/governance/validate-capability-reference-corpus.js --query engineering`
retornou `[]`; isso não prova ausência de implementação. Descoberta semântica:
unavailable (Axon sem índice utilizável). AEW aplicação/enforcement não verificados.

Candidatos existentes: runEngineeringTask/inspectEngineeringTask (task-runtime),
parseEngineeringTask (task-contract), createEngineeringTools (tools),
verifyEngineeringTask (verifier), EngineeringTaskState, RelationalSessionEventStore,
ExecutionEventLedger, executeIsolatedCommand. Consumir runtime/ledger/executor;
estender contratos e composição. Assinaturas e localização foram inspecionadas no
worktree W1. Não promover código a outros projetos nem registrar adoção fictícia.

Consumidores: CLI agent, serviço HTTP local, SDK JS/TS e Python. Novos módulos de
workspace/registry/control são fronteiras do produto HSEOS e delegam autoridade
às capacidades acima. Controles: parsing estrito, pinning, escopo, budget,
seq/idempotência e recuperação fail-closed. Conformance: tasks T1–T6. Graph update:
reconciliar o fragmento do produto com referências testadas antes de fechamento;
não usar ausência de nó como autorização para duplicar kernel.

Reconciliação do grafo: proposta de capability.hseos.project-engineering, contratos
v2/v1, módulos, SDK source-only e testes no fragmento schema1 do HSEOS. Lifecycle
`proposed` mantém a decisão de publicação/ativação separada. Mirror compilado por
syncCapabilityCatalog; sem arestas de adoção/publicação ou promoção semântica.

Core-drift: os novos consumidores usam ExecutionEventLedger,
RelationalSessionEventStore, runtimes e executor existentes. Não há cópia de
persistência, política ou orçamento. Não foi estabelecido consumo por outro
projeto nem maturidade de produção: §4 da skill core-drift exclui promoção de
implementação experimental. A projeção de catálogo permanece no HSEOS; registros
de outros cores/vault não são alterados pelo trabalho desta onda.
