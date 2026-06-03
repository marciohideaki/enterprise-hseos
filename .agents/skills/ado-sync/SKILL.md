---
name: ado-sync
description: Sincronização contínua de estado entre dev-squad runs e Azure DevOps. Atualiza Tasks/Stories ADO conforme tasks completam. Não bloqueia execução.
version: 1.0.0
owner: platform-governance
tier: full
source: .enterprise/governance/agent-skills/ado-sync/SKILL.md
quick: .enterprise/governance/agent-skills/ado-sync/SKILL-QUICK.md
portable: true
license: Apache-2.0
---

# ADO-Sync — Estado Contínuo

## Propósito
Sincroniza o estado de execução do dev-squad com o board ADO em tempo real.
Chamada: após cada task completar E sob demanda via `/atlas sync`.
Nunca bloqueia execução — falhas são silenciosas (best-effort).

## Pré-requisitos
- `ado.enabled: true` em `.hseos/config/hseos.config.yaml`
- Arquivo `ado-mapping.json` em `.hseos/runs/ado-ops/{timestamp}/`
- MCP server `azure-devops` ativo

## Fluxo de sincronização

### 1. Carregar estado atual
Ler `.hseos/runs/dev-squad/{run-id}/STATUS.md` para estado de cada task.
Ler `.hseos/runs/ado-ops/{timestamp}/ado-mapping.json` para IDs ADO.

### 2. Para cada task com status `success`
```
wit_update_work_item(
  id=task_ado_id,
  operations=[
    {"op": "add", "path": "/fields/System.State", "value": "Closed"},
    {"op": "add", "path": "/fields/System.History",
     "value": "Completed by squad agent. Commit: {sha}. Wave: {wave_id}."}
  ]
)
```

### 3. Para cada task com status `in_progress`
```
wit_update_work_item(
  id=task_ado_id,
  operations=[
    {"op": "add", "path": "/fields/System.State", "value": "Active"},
    {"op": "add", "path": "/fields/System.History",
     "value": "Em execução — wave {wave_id}, worktree {worktree_id}."}
  ]
)
```

### 4. Para cada task com status `failed`
Adicionar comment com erro. Estado permanece Active (não fechar — aguarda retry ou investigação).

### 5. Story auto-close
Se TODOS os Tasks de uma Story estão Closed (verificar via WIQL):
```
SELECT [System.Id] FROM WorkItems
WHERE [System.Parent] = {story_id}
AND [System.State] <> 'Closed'
```
Se count = 0: fechar a Story.

### 6. Batch
Max 10 chamadas MCP por turno. Para runs com >10 tasks, processar em lotes.

### 7. Salvar resultado
Atualizar `.hseos/runs/ado-ops/{timestamp}/sync-result.json`:
```json
{
  "synced_at": "ISO8601",
  "tasks_closed": [1238, 1239],
  "tasks_active": [1240],
  "tasks_failed": [],
  "stories_auto_closed": [1236]
}
```

## Modo skip
Se `ado.enabled: false`: exit silencioso.
Se `ado-mapping.json` não existe: logar advisory e exit 0.

## Invocação pelo hook `ado-task-progress.sh`
O hook chama ADO REST API diretamente (não MCP) para adicionar comment em commit.
Esta skill faz a sincronização completa de estado via MCP.


## Quick Mode

For low-context activation, load `.enterprise/governance/agent-skills/ado-sync/SKILL-QUICK.md` or `QUICK.md` first. Load this full skill for deep analysis, violation fixing, or formal review gates.

