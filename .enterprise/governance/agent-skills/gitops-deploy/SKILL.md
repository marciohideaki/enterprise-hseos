---
name: gitops-deploy
description: "Use when deploying one or more services by updating image tags with full Kustomize validation and GitOps commit standards"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# GitOps Deploy — Guia Completo

## Quando usar

Carregue esta skill quando o usuário pedir:
- deploy, publicar, publique, sobe no k8s, publica
- bump de imagem, bump de tag, atualizar tag
- promover versão, promover para dev/hmg/stg/prod
- lançar versão, lançar release, fazer release
- nova versão no ar, colocar no ar, rollout
- atualizar k8s, mandar pro cluster, mandar pra produção

---

## PASSO 0 — Detectar se os manifests existem (SEMPRE executar primeiro)

Identifique o projeto e verifique:

```bash
ls <project>/services/overlays/dev/kustomization.yaml 2>/dev/null && echo "EXISTS" || echo "NOT_FOUND"
```

**Se `NOT_FOUND`:** Informe o usuário e redirecione:
> "O projeto `<project>` ainda não tem manifests no platform-gitops. Vou criar a estrutura antes."
- Projeto totalmente novo → executar fluxo `gitops-new-project`, depois retomar o deploy
- Só falta um serviço → executar fluxo `gitops-add-service`, depois retomar o deploy

**Se `EXISTS`:** Prosseguir para o Passo 1.

---

## PASSO 1 — Coletar informações

Se não fornecidos via argumento, pergunte:

1. **Projeto** — `cambio-real` | `poynt-hub` | `curatex` | `prompt-library` | `ai-engineering-orchestrator` | `srm-asset`
2. **Serviço(s)** — listar images do `kustomization.yaml` para o usuário escolher
3. **Ambiente(s)** — `dev` | `hmg` | `stg` | `prod`
4. **Tag** — ex: `sha-a1b2c3d`, `develop`, `v1.2.3`, `latest`

---

## PASSO 2 — Ler o kustomization.yaml atual

```
<project>/services/overlays/<env>/kustomization.yaml
```

Mostrar tag atual antes de alterar para confirmação do usuário.

---

## PASSO 3 — Atualizar a tag

**Cirúrgico (um serviço específico):**
```bash
cd <project>/services/overlays/<env>
kustomize edit set image <image-name>=<image-name>:<new-tag>
```

**Global (todos os serviços do overlay):**
```bash
sed -i -E "s#(newTag:\s*).*#\1<new-tag>#" <project>/services/overlays/<env>/kustomization.yaml
```

Mostrar diff para o usuário confirmar antes de prosseguir.

---

## PASSO 4 — Validar

```bash
./scripts/ci/validate_project_kustomize.sh <project>
```

**Falha → não commitar.** Identificar causa, corrigir, revalidar.

---

## PASSO 5 — Branch e commit

```bash
git checkout -b chore/<project>-deploy-<env>-<YYYYMMDD>
git add <project>/services/overlays/<env>/kustomization.yaml
git commit -m "chore(<project>): bump <service> image tag to <tag> on <env>"
```

**Exemplos de mensagem:**
- `chore(cambio-real): bump platform-api image tag to sha-a1b2c3d on dev`
- `chore(curatex): bump all services image tag to sha-ff00112 on dev hmg`
- `chore(ai-engineering-orchestrator): bump orchestrator image tag to v2.1.0 on prod`

---

## PASSO 6 — Push e PR

```bash
git push origin chore/<project>-deploy-<env>-<YYYYMMDD>
```

Informar:
1. Branch criada
2. Base do PR: `develop` para dev/hmg/stg · `main` para prod
3. ArgoCD sincroniza automaticamente após merge (selfHeal=true)

---

## Regras de governança (NUNCA violar)

| Regra | Detalhe |
|---|---|
| Nunca commitar em `main`/`develop`/`master` | Sempre feature branch |
| Nunca `Co-Authored-By` | Remover qualquer trailer deste tipo |
| Nunca mencionar IA no commit | Claude, LLM, Copilot, etc. são proibidos |
| Nunca commitar com validação falha | validate_project_kustomize.sh deve passar |

---

## Referência — image names (GHCR)

```
ghcr.io/hideakisolutions/<project>/<service>:<tag>
ghcr.io/hideakisolutions/<project>:<tag>   # single-service
```
