---
name: ado-new-project
tier: quick
version: "1.0.0"
description: "Bootstrap ADO project: cria org/project, iteration paths, migra repo (com prompt), cria pipeline"
---

# ADO-New-Project — Quick Reference

> Fluxo interativo de 5 etapas. Requer ADO_PAT com permissão de criação.
> Load SKILL.md para templates de pipeline e fluxo completo.

## Quando usar
- Novo projeto HSEOS sem ADO configurado
- `/atlas setup` acionado
- `ado.enabled: false` e usuário quer habilitar

## 5 etapas
1. **Pré-flight** — verificar CLI/MCP + PAT
2. **Org/Project** — prompt nome + criar projeto ADO
3. **Iteration Paths** — Phase N → Sprint estrutura
4. **Repo migration** — PROMPT EXPLÍCITO [y/N/s] — nunca migrar sem confirmação
5. **Pipeline** — detectar stack → gerar azure-pipelines.yml → criar no ADO

## Resultado
`hseos.config.yaml` atualizado com:
- `ado.enabled: true`
- `ado.org`, `ado.project`, `ado.project_id`
- `ado.repo_url`, `ado.pipeline_id`

## Regra de migração de repo
SEMPRE perguntar. NUNCA migrar silenciosamente.
Confirmação dupla para migração efetiva (irreversível).
