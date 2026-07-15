---
trigger: a wave completed and its ADO Tasks/Stories/Feature must be closed with the git tag; user says the wave is done or asks to close a wave
skip: ado.enabled is false; the wave is not fully merged yet; the work items were already closed
name: ado-close-wave
description: "Fechamento formal de wave ADO: fecha Feature e Epic (quando completo), cria tag git semântica, atualiza MASTER-PLAN.md. Chamado após PR merged + CI verde."
version: 1.0.0
owner: platform-governance
tier: full
source: .enterprise/governance/agent-skills/ado-close-wave/SKILL.md
quick: .enterprise/governance/agent-skills/ado-close-wave/SKILL-QUICK.md
portable: true
license: Apache-2.0
---

# ADO-Close-Wave — Fechamento Formal

## Propósito
Fecha formalmente uma wave no ADO após PR mergeado e CI verde.
Transiciona Feature → Closed, verifica Epic (fecha se todas Features completas).
Cria tag git, atualiza MASTER-PLAN.md.

## Pré-requisitos
- `ado.enabled: true`
- PR da wave mergeado (verificar via `gh pr view --state merged`)
- CI verde no branch merge
- `ado-mapping.json` com IDs da wave

## Fluxo de fechamento (7 passos)

### 1. Verificar PR mergeado
```bash
gh pr view {pr_number} --json state,mergedAt | jq '.state'
```
Se não "MERGED": abortar com erro claro.

### 2. Verificar todas Stories da wave fechadas
```
SELECT [System.Id] FROM WorkItems
WHERE [System.Parent] = {feature_id}
AND [System.WorkItemType] = 'User Story'
AND [System.State] <> 'Closed'
```
Se count > 0: executar `/atlas sync` primeiro.

### 3. Fechar Feature
```
wit_update_work_item(
  id=feature_id,
  operations=[
    {"op": "add", "path": "/fields/System.State", "value": "Closed"},
    {"op": "add", "path": "/fields/System.History",
     "value": "Wave {wave_id} completa. PR #{pr_number} mergeado. Tag: {tag}."}
  ]
)
```

### 4. Verificar Epic (fechar se todas Features completas)
```
SELECT [System.Id] FROM WorkItems
WHERE [System.Parent] = {epic_id}
AND [System.WorkItemType] = 'Feature'
AND [System.State] <> 'Closed'
```
Se count = 0: fechar Epic com mesmo padrão.

### 5. Criar tag git
```bash
git tag {tag_name}  # ex: wave-w80-closed ou v0.7.0
git push origin {tag_name}
```
Tag pattern: `wave-w{NNN}-closed` para waves intermediárias; `v{X.Y.Z}` para releases.

### 6. Atualizar MASTER-PLAN.md
Marcar wave como fechada:
```
W{NNN} | {titulo} | 🟢 Done | {tag} | ADO Feature #{feature_id}
```

### 7. Comment no Epic com link da tag
```
wit_update_work_item(
  id=epic_id,
  operations=[{
    "op": "add",
    "path": "/fields/System.History",
    "value": "Wave {wave_id} fechada. Tag: {tag}. Ver MASTER-PLAN.md."
  }]
)
```

## Modo skip
Se `ado.enabled: false`: skip silencioso.


## Quick Mode

For low-context activation, load `.enterprise/governance/agent-skills/ado-close-wave/SKILL-QUICK.md` or `QUICK.md` first. Load this full skill for deep analysis, violation fixing, or formal review gates.

