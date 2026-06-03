---
name: ado-close-wave
tier: quick
version: "1.0.0"
description: "Fecha Feature/Epic ADO após PR merged, cria tag git, atualiza MASTER-PLAN.md"
---

# ADO-Close-Wave — Quick Reference

> Executar após PR mergeado + CI verde.
> Requer: ado.enabled=true + ado-mapping.json.

## Quando usar
- Após `/atlas sync` confirmar todas Tasks fechadas
- Após PR da wave mergeado
- Para criar tag e fechar Feature no ADO

## Fluxo resumido
1. Verificar PR mergeado (`gh pr view --json state`)
2. Verificar Stories todas fechadas (WIQL query)
3. Fechar Feature (State: Closed + comment com PR + tag)
4. Verificar Epic: se todas Features fechadas → fechar Epic
5. `git tag {wave|version} && git push origin {tag}`
6. Atualizar MASTER-PLAN.md (🟢 Done + tag)
7. Comment no Epic com link da tag

## Tag patterns
- Wave intermediária: `wave-w{NNN}-closed`
- Release: `v{X.Y.Z}`
