---
name: ado-plan
tier: quick
version: "1.0.0"
description: "G1-ADO gate: cria hierarquia ADO a partir do PLAN.md antes do dev-squad dispatch"
---

# ADO-Plan — Quick Reference

> Executar ANTES de qualquer dev-squad dispatch quando ado.enabled=true.
> Load SKILL.md para fluxo completo de 6 passos.

## Quando usar
- Antes de qualquer wave do dev-squad (gate G1-ADO)
- Quando PLAN.md não contém `<!-- ado-mapping:` 
- Quando hook `ado-preflight-gate.sh` reporta "sem ADO mapping"

## Fluxo resumido
1. Ler PLAN.md → extrair estrutura wave/task
2. WIQL check (idempotência) para cada item
3. Criar Epic → Feature → Stories → Tasks (max 10 paralelas)
4. Anotar PLAN.md com IDs `<!-- ado-mapping: ... -->`
5. Salvar `.hseos/runs/ado-ops/{ts}/ado-mapping.json`

## Sizing invariante por Task
≤ 4 arquivos | ≤ 1000 LOC | ≤ 60% ctx Sonnet | 1 bounded context

## Branch pattern
`ado-{TASK_ADO_ID}-{slug}` por worktree agent
