---
name: gitops-deploy-centralized
tier: quick
version: "1.0.0"
model: centralized
---

# GitOps Deploy — Centralized Monorepo (Quick Reference)

> Perfil: **centralized** — um único repo GitOps (ex: `platform-gitops`) contém manifests de todos os projetos.
> Este é o modelo ativo no ambiente Hideaki Solutions.
> Para o modelo app-paired (repo por aplicação), ver `SKILL-APP-PAIRED.md`.

---

## Estrutura de diretórios

```
<gitops-repo>/
  <project>/
    services/
      base/
        <service>/
          deployment.yaml
          kustomization.yaml
      overlays/
        dev/kustomization.yaml
        hmg/kustomization.yaml
        stg/kustomization.yaml
        prod/kustomization.yaml
    infra/
      ...
```

---

## Checklist de pré-execução

- [ ] Perfil ativo: `centralized` (verificar `.hseos/config/kube-profile.yaml`)
- [ ] Projeto identificado (ex: `cambio-real`, `poynt-hub`, `curatex`)
- [ ] Manifests existem: `<project>/services/overlays/<env>/kustomization.yaml`
  - Se **NÃO existem** → executar `gitops-new-project` ou `gitops-add-service` primeiro
- [ ] Serviço(s) e ambiente(s) confirmados
- [ ] Tag da imagem definida (ex: `sha-a1b2c3d`, `develop`, `v1.2.3`)

---

## Fluxo resumido

```
0. Exibir perfil ativo antes de qualquer mutação
1. Verificar se manifests existem (se não → redirecionar)
2. Atualizar newTag no kustomization.yaml do overlay
3. Validar: ./scripts/ci/validate_project_kustomize.sh <project>
4. Branch: chore/<project>-deploy-<env>-<YYYYMMDD>
5. Commit: chore(<project>): bump <service> image tag to <tag> on <env>
6. Push + criar PR (base: develop para dev/hmg/stg | main para prod)
7. Monitorar ArgoCD: <project>-services-<env>
```

---

## Caminhos dos arquivos

```
<project>/services/overlays/dev/kustomization.yaml
<project>/services/overlays/hmg/kustomization.yaml
<project>/services/overlays/stg/kustomization.yaml
<project>/services/overlays/prod/kustomization.yaml
```

## Comandos de update de tag

```bash
# Cirúrgico (um serviço):
cd <project>/services/overlays/<env>
kustomize edit set image <image-name>=<image-name>:<new-tag>

# Global (todos os serviços do overlay):
sed -i -E "s#(newTag:\s*).*#\1<new-tag>#" <project>/services/overlays/<env>/kustomization.yaml
```

## Validação

```bash
./scripts/ci/validate_project_kustomize.sh <project>
```

---

## Regras de governança (NUNCA violar)

- NUNCA commitar em `main`, `develop` ou `master`
- NUNCA adicionar `Co-Authored-By`
- NUNCA mencionar IA na mensagem de commit
- NUNCA commitar com validação falha
