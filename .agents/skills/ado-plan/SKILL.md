---
trigger: an approved dev-squad PLAN.md needs ADO work items (gate G1-ADO); user asks to create Epic/Feature/Stories/Tasks in Azure DevOps from a plan
skip: ado.enabled is false (all ADO skills exit silently); no approved PLAN.md yet; work tracking does not use Azure DevOps
name: ado-plan
description: "G1-ADO gate: cria hierarquia Epic/Feature/Story/Task no Azure DevOps a partir do PLAN.md antes de qualquer execução dev-squad. Implementa o fluxo ADO-first obrigatório."
version: 1.0.0
owner: platform-governance
tier: full
source: .enterprise/governance/agent-skills/ado-plan/SKILL.md
quick: .enterprise/governance/agent-skills/ado-plan/SKILL-QUICK.md
portable: true
license: Apache-2.0
---

# ADO-Plan — G1-ADO Gate

## Propósito
Gate obrigatório antes de qualquer dev-squad dispatch quando `ado.enabled: true`.
Cria a hierarquia ADO completa a partir do PLAN.md aprovado.
Output: ADO IDs anotados de volta no PLAN.md + arquivo `.hseos/runs/ado-ops/<timestamp>/ado-mapping.json`.

## Pré-requisitos
- `ado.enabled: true` em `.hseos/config/hseos.config.yaml`
- `ADO_PAT` presente no env
- PLAN.md aprovado (G2 gate já passado)
- MCP server `azure-devops` ativo

## Fluxo de execução (6 passos)

### Passo 1 — Ler PLAN.md
Localizar seção `## ADO Mapping` no PLAN.md.
Se não existir: criar a seção com template baseado nas waves do plano.
Parsear: epic, features, stories por wave, tasks por story.

### Passo 2 — Idempotência (WIQL check)
Para cada item a criar, verificar se já existe:
```
SELECT [System.Id] FROM WorkItems
WHERE [System.TeamProject] = '{project}'
AND [System.Title] CONTAINS '{titulo_unico}'
```
Se encontrar ID existente → reutilizar (não criar duplicata).

### Passo 3 — Criar Epic (se novo)
```
wit_create_work_item(
  type="Epic",
  title="[EPIC-NNN] {titulo}",
  description=<template HTML do ado-ops skill>,
  iterationPath="{project}\\Phase N — {nome}"
)
```
→ Salvar ID retornado.

### Passo 4 — Criar Feature (wave group)
```
wit_add_child_work_items(
  parentId=epic_id,
  items=[{type:"Feature", title:"[F-NNN-NN] {titulo}", ...}]
)
```
→ Batch de até 10 por vez. Salvar IDs.

### Passo 5 — Criar Stories + Tasks (por wave)
Para cada wave no plano:
```
wit_add_child_work_items(
  parentId=feature_id,
  items=[
    {type:"User Story", title:"US-NNN-NN-A — {titulo}", ...},
    ...
  ]
)
```
Para cada story, adicionar tasks filhas:
```
wit_add_child_work_items(
  parentId=story_id,
  items=[
    {type:"Task", title:"[IMPL] {componente}", ...},
    {type:"Task", title:"[TEST] {componente} — unit + integration", ...}
  ]
)
```

### Passo 6 — Anotar PLAN.md com IDs
Adicionar ao final do PLAN.md:
```markdown
<!-- ado-mapping:
  epic: 1234
  features:
    wave-group-1: 1235
  stories:
    wave-w80: 1236
    wave-w81: 1237
  tasks:
    T1: 1238
    T2: 1239
-->
```
Também salvar em `.hseos/runs/ado-ops/{timestamp}/ado-mapping.json`.

## Sizing de Tasks para agentes
Cada Task ADO deve respeitar:
- ≤ 4 arquivos core modificados
- ≤ 1 bounded context
- ≤ ~1.000 LOC delta
- ≤ 60% janela de contexto Sonnet
- Testes = Task separada [TEST]
- Migrations = Task separada (sequencial antes das tasks de app)

Se uma task estimada excede esses limites → splittar antes do G2.

## Branch pattern por Task ADO
```
feature/{epic-slug}-wave-{NNN}-{titulo}   # branch da wave
ado-{TASK_ADO_ID}-{slug}                  # branch por task (worktree agent)
```

## Output esperado
```
[ADO-PLAN] Epic #1234 criado: [EPIC-080] Phase 7 — Agent Library
[ADO-PLAN] Feature #1235 criada: [F-080-01] Wave W80 Agent Core
[ADO-PLAN] Story #1236 criada: US-080-01-A — [IMPL] Agent Core
[ADO-PLAN] Task #1238 criada: [IMPL] agent_factory.py
[ADO-PLAN] Task #1239 criada: [TEST] agent_factory — unit + integration
[ADO-PLAN] PLAN.md anotado com ADO IDs.
[ADO-PLAN] ado-mapping.json salvo em .hseos/runs/ado-ops/{timestamp}/
```

## Modo skip (ado.enabled=false)
Se `ado.enabled: false`: logar `[ADO-PLAN] ADO desabilitado — skip.` e retornar sem criar nada.

## HSEOS Integration
Skill chamada pelo agente ATLAS (`.hseos/agents/atlas.agent.yaml`) via menu `PLAN`.
Hook `ado-preflight-gate.sh` verifica que esta skill foi executada antes de despachar dev-squad.
Verificação: PLAN.md contém `<!-- ado-mapping:` ou seção `## ADO Mapping` com IDs.


## Quick Mode

For low-context activation, load `.enterprise/governance/agent-skills/ado-plan/SKILL-QUICK.md` or `QUICK.md` first. Load this full skill for deep analysis, violation fixing, or formal review gates.

