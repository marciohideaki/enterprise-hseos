# Granularidade ADO-Ops — Mapeamento SWARM ↔ ADO

## Hierarquia Completa

```
ADO Epic
  └── ADO Feature
        └── ADO User Story
              └── ADO Task [IMPL]
              └── ADO Task [TEST]
```

```
HSEOS Phase (multi-wave)
  └── HSEOS Wave Group / Sprint
        └── HSEOS Wave (1 dev-squad run)
              └── Squad Agent Worktree [IMPL]
              └── Squad Agent Worktree [TEST]
```

## Tabela de Mapeamento

| Nível ADO | Equivalente HSEOS | Owner | Granularidade | Exemplo |
|-----------|------------------|-------|---------------|---------|
| **Epic** | Phase / cluster multi-wave | Architect/PO | Multi-semanas | `[EPIC-007] Phase 7 — Agent Library` |
| **Feature** | Wave group (2-4 waves correlatas) | Tech Lead | 1-2 semanas | `[F-007-01] Wave Group W80-W82: Agent Core` |
| **User Story** | Wave única (1 dev-squad run) | SWARM Commander | 1-3 dias | `US-007-01-A — Wave W80: Agent Factory` |
| **Task** | Worktree agent | Squad Agent (Sonnet) | Horas | `[IMPL] agent_factory.py` |

## Constraints por Task (invariantes de sizing)

| Constraint | Limite | Motivo |
|------------|--------|--------|
| Arquivos core modificados | ≤ 4 | Evita conflitos em merge, mantém foco |
| LOC delta (inserções + deleções) | ≤ 1.000 | Fit em contexto do revisor humano |
| Bounded contexts cruzados | ≤ 1 | Evita merge conflicts entre worktrees |
| Contexto Sonnet usado | ≤ 60% | Margem de segurança para resposta e tools |
| Duração estimada | ≤ 4h | Granularidade acionável por turno |

## Tipos de Task

| Tipo | Prefixo | Conteúdo | Dependência |
|------|---------|----------|-------------|
| Implementação | `[IMPL]` | Código fonte, configs | Nenhuma (geralmente) |
| Testes | `[TEST]` | Unit + integration tests | Após `[IMPL]` correspondente |
| Migration | `[MIGRATE]` | DB schema changes | Antes das tasks de app que dependem |
| Docs | `[DOCS]` | ADR, README, CHANGELOG | Independente (paralelo) |
| Infra | `[INFRA]` | K8s manifests, pipelines | Antes de deploy tasks |

## Branch por Task

```
Pattern: ado-{TASK_ADO_ID}-{slug}

Exemplos:
  ado-1238-agent-factory-impl
  ado-1239-agent-factory-tests
  ado-1240-agent-registry-migration
```

## Exemplo Completo: Wave W80

```yaml
# ado-mapping.json gerado pelo /atlas plan
{
  "epic": 1234,          # [EPIC-007] Phase 7 — Agent Library
  "features": {
    "wave-group-w80-w82": 1235  # [F-007-01] Wave Group W80-W82
  },
  "stories": {
    "wave-w80": 1236    # US-007-01-A — Wave W80: Agent Core
  },
  "tasks": {
    "T1": 1238,  # [IMPL] agent_factory.py (ado-1238-agent-factory-impl)
    "T2": 1239,  # [IMPL] agent_registry.py (ado-1239-agent-registry-impl)
    "T3": 1240,  # [TEST] agent_factory + registry tests (ado-1240-agent-tests)
    "T4": 1241   # [DOCS] ADR-0012 agent-factory-pattern (ado-1241-adr-docs)
  }
}
```

## Sizing Heurísticas

### Quando splittar uma Task
- Mudança toca > 4 arquivos → splittar por área funcional
- Mudança cruza 2+ bounded contexts → 1 task por contexto
- LOC estimado > 1.000 → dividir em fase de dados e fase de lógica
- Há dependência temporal (migration antes do app) → tasks sequenciais explícitas

### Quando NÃO splittar
- Testes unitários do mesmo módulo podem ficar na mesma task `[IMPL]`
- Configurações triviais (Dockerfile, .env.example) podem acompanhar o `[IMPL]`
- Docs inline (comentários, docstrings) não precisam de task separada

## Iteration Paths Recomendados

```
{project}
  ├── Phase 0 — Bootstrap         (W1-W6)
  ├── Phase 1 — Walking Skeleton  (W7-W21)   → tag v0.1.0
  ├── Phase 2 — Security Layer    (W22-W27)   → tag v0.2.0
  ├── Phase N — {nome}
  │     ├── Sprint A              (W{inicio}-W{fim})
  │     └── Sprint B              (W{fim+1}-W{fim+N})
  └── Backlog                     (não estimado)
```

Criar iteration paths via `/atlas setup` (etapa 3) ou manualmente:
```bash
az boards iteration create \
  --name "Phase N — Nome" \
  --organization "https://dev.azure.com/{org}" \
  --project "{project}"
```
