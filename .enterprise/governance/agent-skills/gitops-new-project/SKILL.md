---
name: gitops-new-project
description: Scaffolda estrutura GitOps completa para novo projeto no platform-gitops — namespaces, infra, services, overlays dev/hmg/stg/prod, ArgoCD Applications, AppProject e bootstrap script.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# GitOps New Project — Guia Completo

## Quando usar

Carregue esta skill quando o usuário pedir:
- novo projeto no k8s, novo projeto, criar projeto
- bootstrapar projeto, bootstrap k8s, onboarding k8s
- scaffoldar projeto, scaffold projeto
- configurar projeto no cluster, registrar projeto no ArgoCD
- adicionar projeto ao gitops, estrutura k8s para projeto
- iniciar projeto no Kubernetes, subir projeto do zero
- criar estrutura gitops, criar namespace, criar ArgoCD app

---

## PASSO 1 — Coletar informações

1. **Nome do projeto** — kebab-case (ex: `payment-gateway`)
2. **Serviços iniciais** — para cada: nome, imagem, porta, tipo (`http-api`|`worker`|`fpm`)
3. **Infraestrutura** — PostgreSQL | MySQL | Redis | RabbitMQ | NATS | Kafka | Nenhuma
4. **Ambientes** — default: `dev` `hmg` `stg` `prod`
5. **Ingress em dev?** — domínio (ex: `payment-gateway.hideakiservicos.net`)

---

## PASSO 2 — Ler projetos de referência

Antes de criar qualquer arquivo, leia:
- `apps/cambio-real-services-dev.yaml` — template de ArgoCD Application (services)
- `apps/cambio-real-infra-dev.yaml` — template de ArgoCD Application (infra, sem prune)
- `argocd/base/appproject-cambio-real.yaml` — template de AppProject
- `cambio-real/scripts/bootstrap-dev.sh` — template de bootstrap script

---

## PASSO 3 — Criar manifests de services

### `<project>/services/base/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - <service>-deployment.yaml
  - <service>-service.yaml
```

### `<project>/services/overlays/<env>/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: <project>-<env>
resources:
  - ../../base
commonLabels:
  environment: <env>
  tier: services
images:
  - name: ghcr.io/hideakisolutions/<project>/<service>
    newTag: develop
```

Criar deployments e services seguindo o padrão do `cambio-real` (imagePullSecrets, labels, probes).

---

## PASSO 4 — Criar manifests de infra (se solicitado)

### `<project>/infra/base/` — StatefulSets para cada componente
### `<project>/infra/overlays/<env>/kustomization.yaml`
```yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
namespace: <project>-<env>
resources:
  - ../../base
commonLabels:
  environment: <env>
  tier: infra
```

---

## PASSO 5 — Criar ArgoCD Applications

### Services app (`apps/<project>-services-<env>.yaml`) — `prune: true`
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: <project>-services-<env>
  namespace: argocd
spec:
  project: <project>
  source:
    repoURL: git@github.com:HideakiSolutions/platform-gitops.git
    targetRevision: develop
    path: <project>/services/overlays/<env>
  destination:
    server: https://kubernetes.default.svc
    namespace: <project>-<env>
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

### Infra app (`apps/<project>-infra-<env>.yaml`) — SEM `prune` (CRÍTICO)
```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: <project>-infra-<env>
  namespace: argocd
spec:
  project: <project>
  source:
    repoURL: git@github.com:HideakiSolutions/platform-gitops.git
    targetRevision: develop
    path: <project>/infra/overlays/<env>
  destination:
    server: https://kubernetes.default.svc
    namespace: <project>-<env>
  syncPolicy:
    automated:
      selfHeal: true
      # prune: false (omitido intencionalmente — proteção de PVCs e dados stateful)
    syncOptions:
      - CreateNamespace=true
```

---

## PASSO 6 — Criar AppProject

### `argocd/base/appproject-<project>.yaml`
```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: <project>
  namespace: argocd
spec:
  description: Projeto <project> - acesso restrito
  sourceRepos:
    - git@github.com:HideakiSolutions/platform-gitops.git
  destinations:
    - namespace: <project>-*
      server: https://kubernetes.default.svc
  clusterResourceWhitelist:
    - group: '*'
      kind: '*'
  namespaceResourceWhitelist:
    - group: '*'
      kind: '*'
```

---

## PASSO 7 — Criar bootstrap script

`<project>/scripts/bootstrap-dev.sh` — seguir padrão do `cambio-real/scripts/bootstrap-dev.sh`.
Incluir: criar namespace, criar secrets, aplicar ArgoCD apps.

---

## PASSO 8 — Validar

```bash
./scripts/ci/validate_project_kustomize.sh <project>
```

---

## PASSO 9 — Branch e commit

```bash
git checkout -b feat/new-project-<project>
git add <project>/
git add apps/<project>-*.yaml
git add argocd/base/appproject-<project>.yaml
git commit -m "feat(platform): add <project> k8s project manifests"
git push origin feat/new-project-<project>
```

---

## Regra crítica — prune

| Tipo de app | prune | Motivo |
|---|---|---|
| **infra** (databases, queues, caches) | `false` (omitir) | Protege PVCs e dados stateful |
| **services** (deployments, APIs) | `true` | Limpeza automática de recursos obsoletos |
