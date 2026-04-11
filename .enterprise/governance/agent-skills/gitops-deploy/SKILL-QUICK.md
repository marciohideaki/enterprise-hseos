---
name: gitops-deploy
tier: quick
version: "1.1.0"
---

# GitOps Deploy — Quick Reference

> Tier 1: use para qualquer pedido de deploy, publicação, bump de tag ou promoção de imagem.
> Carregue SKILL.md (Tier 2) para o fluxo completo passo a passo.
>
> **Modelos suportados:**
> - `centralized` — monorepo (ex: platform-gitops) → ver `SKILL-CENTRALIZED.md`
> - `app-paired` — repo por aplicação (ex: `<app>-gitops`) → ver `SKILL-APP-PAIRED.md`
>
> KUBE detecta o modelo automaticamente via `.hseos/config/kube-profile.yaml` ou estrutura do repo.

---

## Checklist de pré-execução (TODOS devem passar)

- [ ] Projeto identificado (`cambio-real` | `poynt-hub` | `curatex` | `prompt-library` | `ai-engineering-orchestrator` | `srm-asset`)
- [ ] Manifests existem em `<project>/services/overlays/<env>/kustomization.yaml`
  - Se **NÃO existem** → executar `gitops-new-project` ou `gitops-add-service` primeiro
- [ ] Serviço(s) e ambiente(s) confirmados com o usuário
- [ ] Tag da imagem definida (ex: `sha-a1b2c3d`, `develop`, `v1.2.3`)

---

## Fluxo resumido

```
1. Verificar se manifests existem (se não → redirecionar)
2. Atualizar newTag no kustomization.yaml do overlay
3. Validar: ./scripts/ci/validate_project_kustomize.sh <project>
4. Branch: chore/<project>-deploy-<env>-<YYYYMMDD>
5. Commit: chore(<project>): bump <service> image tag to <tag> on <env>
6. Push + instruir PR
```

---

## Regras de governança (NUNCA violar)

- NUNCA commitar em `main`, `develop` ou `master`
- NUNCA adicionar `Co-Authored-By`
- NUNCA mencionar IA na mensagem de commit
- NUNCA commitar com validação falha

---

## Caminhos dos arquivos

```
<project>/services/overlays/dev/kustomization.yaml
<project>/services/overlays/hmg/kustomization.yaml
<project>/services/overlays/stg/kustomization.yaml
<project>/services/overlays/prod/kustomization.yaml
```

## Comando de update de tag

```bash
# Cirúrgico (um serviço):
cd <project>/services/overlays/<env>
kustomize edit set image <image-name>=<image-name>:<new-tag>

# Global (todos os serviços do overlay):
sed -i -E "s#(newTag:\s*).*#\1<new-tag>#" <project>/services/overlays/<env>/kustomization.yaml
```
