---
name: ado-sync
tier: quick
version: "1.0.0"
description: "Sync dev-squad run state → ADO: fecha Tasks/Stories completadas, ativa em progresso"
---

# ADO-Sync — Quick Reference

> Best-effort, nunca bloqueia execução.
> Requer: ado.enabled=true + ado-mapping.json existente.

## Quando usar
- Após wave do dev-squad completar
- Quando STATUS.md mudou e ADO está desatualizado
- Antes de abrir PR (garantir Tasks fechadas)

## Fluxo resumido
1. Ler STATUS.md + ado-mapping.json
2. Task success → State: Closed + comment com SHA
3. Task in_progress → State: Active
4. Task failed → comment de erro (mantém Active)
5. Story sem tasks abertas → auto-close Story
6. Salvar sync-result.json

## Batch: max 10 calls/turno
