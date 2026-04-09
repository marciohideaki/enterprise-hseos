---
name: gitops-new-project
tier: quick
version: "1.0.0"
---

# GitOps New Project — Quick Reference

> Tier 1: use para criar toda a estrutura GitOps de um novo projeto no platform-gitops.
> Carregue SKILL.md (Tier 2) para templates completos de todos os arquivos.

---

## Checklist de pré-execução

- [ ] Nome do projeto definido (kebab-case, ex: `payment-gateway`)
- [ ] Serviços iniciais identificados (nome, imagem, porta, tipo)
- [ ] Infraestrutura necessária definida (PostgreSQL / MySQL / Redis / RabbitMQ / NATS / Kafka / nenhuma)
- [ ] Ambientes confirmados (default: `dev` `hmg` `stg` `prod`)

---

## Fluxo resumido

```
1. Ler projetos existentes para seguir padrão (cambio-real, curatex)
2. Criar estrutura:
   <project>/
   ├── infra/base/ + overlays/dev|hmg|stg|prod   (se tiver infra)
   ├── services/base/ + overlays/dev|hmg|stg|prod
   └── scripts/bootstrap-dev.sh
3. Criar apps/ (ArgoCD Applications):
   - <project>-infra-<env>.yaml   → prune: false (proteção de dados)
   - <project>-services-<env>.yaml → prune: true
4. Criar argocd/base/appproject-<project>.yaml
5. Validar: ./scripts/ci/validate_project_kustomize.sh <project>
6. Branch: feat/new-project-<project>
7. Commit: feat(platform): add <project> k8s project manifests
```

---

## Regra crítica de infra

> Apps de **infra**: `prune: false` (omitido) — NUNCA deletar PVCs e dados stateful
> Apps de **services**: `prune: true` — limpeza automática de recursos obsoletos

---

## Regras de governança

- NUNCA commitar em `main`, `develop` ou `master`
- NUNCA adicionar `Co-Authored-By`
- NUNCA commitar com validação falha
- AppProject: destinations deve ser `<project>-*` (namespaces restritos)
