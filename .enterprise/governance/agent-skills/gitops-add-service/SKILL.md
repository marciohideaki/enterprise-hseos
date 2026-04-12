---
name: gitops-add-service
description: "Use when adding a new service with full Deployment/Service/ConfigMap manifests, overlay coverage, and GitOps commit governance"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# GitOps Add Service — Guia Completo

## Quando usar

Carregue esta skill quando o usuário pedir:
- adicionar serviço, novo serviço, novo deployment
- novo app no k8s, novo container, criar manifests
- adicionar worker, novo worker, novo microsserviço
- colocar serviço no k8s, novo pod, criar deployment
- subir novo serviço, registrar serviço no cluster

---

## PASSO 1 — Coletar informações

1. **Projeto** — em qual projeto existente?
2. **Nome do serviço** — kebab-case (ex: `payment-worker`, `notification-api`)
3. **Imagem Docker** — sem tag (ex: `ghcr.io/hideakisolutions/cambio-real/payment-worker`)
4. **Porta** — porta que o container expõe
5. **Tipo** — `http-api` | `worker` | `fpm` | `custom`
6. **Variáveis não-sensíveis** — lista `KEY=VALUE` para ConfigMap (ou nenhuma)
7. **Secrets** — nomes dos secrets existentes no cluster (ex: `DB_PASSWORD from mysql-secret`)
8. **Réplicas** — default: `1`

---

## PASSO 2 — Ler o projeto existente

Antes de criar qualquer arquivo, leia:
- `<project>/services/base/kustomization.yaml`
- Um deployment existente do projeto para seguir o mesmo padrão

---

## PASSO 3 — Criar manifests em `<project>/services/base/`

### `<service>-deployment.yaml`

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <service>
  namespace: <project>-dev
  labels:
    app: <service>
spec:
  replicas: 1
  selector:
    matchLabels:
      app: <service>
  template:
    metadata:
      labels:
        app: <service>
    spec:
      imagePullSecrets:
        - name: ghcr-pull-secret
      containers:
        - name: <service>
          image: <image>:develop
          ports:
            - containerPort: <port>
              name: http
          envFrom:
            - configMapRef:
                name: <service>-config   # remover se sem ConfigMap
          readinessProbe:
            httpGet:                      # tcpSocket para fpm; remover para worker
              path: /health
              port: <port>
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
          livenessProbe:
            httpGet:
              path: /health
              port: <port>
            initialDelaySeconds: 30
            periodSeconds: 20
            timeoutSeconds: 5
```

### `<service>-service.yaml` (omitir para workers puros)

```yaml
apiVersion: v1
kind: Service
metadata:
  name: <service>
  namespace: <project>-dev
  labels:
    app: <service>
spec:
  selector:
    app: <service>
  ports:
    - name: http
      port: <port>
      targetPort: <port>
  type: ClusterIP
```

### `<service>-configmap.yaml` (somente se tiver variáveis não-sensíveis)

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: <service>-config
  namespace: <project>-dev
data:
  KEY1: "value1"
```

### Atualizar `kustomization.yaml` do base

Adicionar nas `resources:`:
```yaml
  - <service>-deployment.yaml
  - <service>-service.yaml      # se criado
  - <service>-configmap.yaml    # se criado
```

---

## PASSO 4 — Atualizar overlays (dev/hmg/stg/prod)

Em cada `<project>/services/overlays/<env>/kustomization.yaml`, adicionar:
```yaml
images:
  - name: <image>
    newTag: develop    # ajustar conforme padrão do env no projeto
```

---

## PASSO 5 — Validar

```bash
./scripts/ci/validate_project_kustomize.sh <project>
```

Falha → corrigir antes de commitar.

---

## PASSO 6 — Branch e commit

```bash
git checkout -b feat/<project>-add-<service>
git add <project>/services/base/<service>-*.yaml
git add <project>/services/base/kustomization.yaml
git add <project>/services/overlays/*/kustomization.yaml
git commit -m "feat(<project>): add <service> k8s manifests"
git push origin feat/<project>-add-<service>
```

---

## PASSO 7 — Informar próximos passos

1. PR para `develop`
2. Secrets a criar manualmente no cluster (se houver)
3. Atualizar bootstrap script do projeto para incluir novos secrets
