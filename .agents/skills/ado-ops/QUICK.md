---
name: ado-ops
tier: quick
version: "1.0.0"
description: "ADO operations via MCP — criar/fechar Epic/Feature/Story/Task, batch close, idempotência via WIQL"
---

# ADO-Ops — Quick Reference

> Tier 1: carregado quando qualquer operação ADO é mencionada.
> Load SKILL.md (Tier 2) para templates HTML e regras completas.
> Requer: ado.enabled=true + ADO_PAT no env.

## Hierarquia
Epic(Phase) → Feature(Wave group) → Story(Wave) → Task(worktree ≤60% ctx)

## Ferramentas MCP
- `wit_create_work_item` — criar (sempre State: New)
- `wit_add_child_work_items` — batch filhos
- `wit_update_work_item` — atualizar / fechar (State: Closed)
- `wit_works_items_link` — linkar predecessor→successor
- `wit_query_by_wiql` — idempotência check
- `work_create_iterations` — criar iteration/sprint

## Regras críticas
1. NUNCA State=Closed na criação — criar New → update separado
2. Max 10 calls paralelas por turno
3. WIQL check de idempotência antes de criar
4. Branch pattern: ado-{TASK_ID}-{slug}
