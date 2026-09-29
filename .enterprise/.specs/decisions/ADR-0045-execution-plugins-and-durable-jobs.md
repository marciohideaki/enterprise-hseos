# ADR-0045: Plugins de execução e jobs duráveis

## Status

Proposed — 2026-09-27. Implementação candidata autorizada pelo plano W4 na sessão.
Aprovação institucional, merge, publicação e ativação operacional não concedidos.

## Context

O catálogo v2 descreve superfícies de compilação; importar código externo durante
inspeção ou conformance no host violaria a fronteira existente. A fila do scheduler
é volátil, enquanto ledger/claims/campanha já oferecem autoridade persistida.
W4 precisa de jobs pontuais e DAG dinâmico sem criar executor ou orçamento paralelo.

## Decision

Propor catálogo v3 com descritor de execução v1, leitura v2 preservada, seleção por
digest e código executado só no executor isolado existente. Tool/provider/context
adaptam ports próprios e política. Conformance externa também roda isolada.

Acrescentar agregado control_job no ExecutionEventLedger com CAS/fencing, identidade
de dono, prazo fixo na primeira partida e reconciliação conservadora de incerteza.
Fila é projeção; GovernedExecutionScheduler continua autoridade de dispatch de efeitos.
Workflow v2 admite expansão append-only governada, joins verificados e fail-fast com
drain transitivo. ProviderCampaignControl permanece autoridade monetária única.

Preparar estado persistente e sua compatibilidade/backup/restore sem ativar migrations
operacionais. Restrição temporária de ADR-0044 permanece até decisão separada de
ativação; nenhuma evidência em /tmp certifica retenção operacional.

## Alternatives Considered

- Importar plugin no host: rejeitado por efeito antes da admissão e acesso a controles.
- Outro scheduler/ledger/budget: rejeitado por duplicar autoridades e permitir reset.
- Lease expirado como prova de morte: rejeitado; dono vivo pode continuar produzindo efeito.
- Retry automático após crash: rejeitado quando efeito externo é incerto.
- Alterar nós existentes/renovar prazo na expansão: rejeitado por mudar aceite/orçamento.

## Consequences

Há custo de processo/snapshot e retenção de versões. Recuperação pode exigir decisão
humana com evidência. Configurações/provider sem mediação adequada são recusados.
Recibo de consumo desconhecido mantém reserva, reduzindo disponibilidade sem exceder teto.

## Mitigations

Limites finitos, cache só de dados, dependências fixadas, snapshots readonly, protocolos
estritos, cancelamento/cgroup drain, eventos versionados, testes multiprocesso e
fault injection. Rollback fecha admissões, preserva pins/eventos e recusa replay
incompatível. Matriz distingue deterministic/real/activation.

## References

- Constituição §§2.3/2.6/5/7/10 e .enterprise/policies/adr-policy.md.
- ADR-0043/0044; padrões Hexagonal & Clean Architecture, Data Contracts & Schema Evolution e Resilience Patterns.
- .specs/features/harness-w4/{spec,design,tasks}.md.
- docs/evolution/w4/PLAN.md; docs/decisions/harness-w4-intake.md.
