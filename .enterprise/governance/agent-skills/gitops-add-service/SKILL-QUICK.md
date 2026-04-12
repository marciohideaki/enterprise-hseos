---
name: gitops-add-service
tier: quick
version: "1.0.0"
description: "Use when adding a new Deployment/Service/ConfigMap to an existing GitOps project"
---

# GitOps Add Service — Quick Reference

> Tier 1: use para adicionar um novo serviço a um projeto existente no platform-gitops.
> Carregue SKILL.md (Tier 2) para o fluxo detalhado com templates de manifests.

---

## Checklist de pré-execução

- [ ] Projeto existente identificado
- [ ] Nome do serviço definido (kebab-case, ex: `payment-worker`)
- [ ] Imagem Docker definida (ex: `ghcr.io/hideakisolutions/<project>/<service>`)
- [ ] Porta do container definida
- [ ] Tipo: `http-api` | `worker` | `fpm` | `custom`
- [ ] Variáveis de ambiente não-sensíveis listadas (para ConfigMap)
- [ ] Secrets identificados (apenas nomes — já devem existir no cluster)

---

## Fluxo resumido

```
1. Ler projeto existente para seguir o mesmo padrão
2. Criar em services/base/:
   - <service>-deployment.yaml
   - <service>-service.yaml       (exceto workers puros)
   - <service>-configmap.yaml     (se tiver env vars)
   - Atualizar kustomization.yaml
3. Adicionar entry images: em cada overlay (dev/hmg/stg/prod)
4. Validar: ./scripts/ci/validate_project_kustomize.sh <project>
5. Branch: feat/<project>-add-<service>
6. Commit: feat(<project>): add <service> k8s manifests
```

---

## Regras de governança

- NUNCA commitar em `main`, `develop` ou `master`
- NUNCA adicionar `Co-Authored-By`
- NUNCA commitar com validação falha
- SEMPRE seguir o padrão dos deployments existentes no projeto (imagePullSecrets, labels, probes)
