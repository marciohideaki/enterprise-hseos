---
name: gitops-deploy-app-paired
tier: quick
version: "1.0.0"
model: app-paired
---

# GitOps Deploy — App-Paired (Quick Reference)

> Perfil: **app-paired** — cada aplicação tem seu próprio repo de manifests (ex: `<app>-gitops`) ou pasta `deploy/` no próprio repo.
> Este é o modelo padrão de mercado para times com múltiplos produtos ou fronteiras de propriedade distintas.
> Para o modelo centralizado (monorepo platform-gitops), ver `SKILL-CENTRALIZED.md`.

---

## Estrutura típica — repo de manifests dedicado

```
<app>-gitops/              ← repo separado: <app>-gitops | <app>-k8s | <app>-manifests
  deploy/
    base/
      deployment.yaml
      service.yaml
      kustomization.yaml
    overlays/
      dev/kustomization.yaml
      hmg/kustomization.yaml
      stg/kustomization.yaml
      prod/kustomization.yaml
```

## Estrutura alternativa — pasta deploy/ no próprio repo da app

```
<app-repo>/
  src/
  deploy/
    base/
    overlays/
      dev/
      prod/
```

---

## Checklist de pré-execução

- [ ] Perfil ativo: `app-paired` (verificar `.hseos/config/kube-profile.yaml` ou auto-detectado)
- [ ] App/repo de manifests identificado
- [ ] Manifests existem: `deploy/overlays/<env>/kustomization.yaml` (ou `k8s/overlays/<env>/`)
  - Se **NÃO existem** → criar estrutura `deploy/overlays/<env>/` no repo de manifests primeiro
- [ ] Serviço(s) e ambiente(s) confirmados
- [ ] Tag da imagem definida (ex: `sha-a1b2c3d`, `develop`, `v1.2.3`)

---

## Fluxo resumido

```
0. Exibir perfil ativo antes de qualquer mutação
1. Verificar se manifests existem (se não → criar estrutura)
2. Atualizar newTag no kustomization.yaml do overlay
3. Validar: kustomize build deploy/overlays/<env>
4. Branch: chore/<app>-deploy-<env>-<YYYYMMDD>
5. Commit: chore(<app>): bump <service> image tag to <tag> on <env>
6. Push + criar PR (base: main por padrão)
7. Monitorar ArgoCD: <app>-<env> (ou <app>)
```

---

## Caminhos dos arquivos

```
deploy/overlays/dev/kustomization.yaml
deploy/overlays/hmg/kustomization.yaml
deploy/overlays/stg/kustomization.yaml
deploy/overlays/prod/kustomization.yaml
```

Alternativas aceitas: `k8s/overlays/<env>/` | `overlays/<env>/`

## Comandos de update de tag

```bash
# Cirúrgico (um serviço):
cd deploy/overlays/<env>
kustomize edit set image <image-name>=<image-name>:<new-tag>

# Global (todos os serviços do overlay):
sed -i -E "s#(newTag:\s*).*#\1<new-tag>#" deploy/overlays/<env>/kustomization.yaml
```

## Validação (fallback genérico)

```bash
kustomize build deploy/overlays/<env>
```

---

## ArgoCD Application naming (exemplos)

| Padrão | Exemplo |
|---|---|
| `<app>-<env>` | `payments-prod` |
| `<app>` (env via values) | `payments` |

---

## Regras de governança (NUNCA violar)

- NUNCA commitar em `main` ou branch de release — sempre feature branch
- NUNCA adicionar `Co-Authored-By`
- NUNCA mencionar IA na mensagem de commit
- NUNCA commitar com validação falha

---

## Auto-detecção de perfil por KUBE

KUBE detecta `app-paired` automaticamente quando:
- Existe `deploy/overlays/` na raiz do repo de manifests
- Existe `k8s/overlays/` na raiz do repo de manifests
- Arquivo `.hseos/config/kube-profile.yaml` declara `profile: app-paired`
