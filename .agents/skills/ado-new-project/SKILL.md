---
name: ado-new-project
description: "Bootstrap completo de projeto Azure DevOps: cria org/project, Iteration Paths por Phase, migra repositório Git (com prompt explícito ao usuário), cria azure-pipelines.yml. Configura hseos.config.yaml com coordenadas ADO."
version: 1.0.0
owner: platform-governance
tier: full
source: .enterprise/governance/agent-skills/ado-new-project/SKILL.md
quick: .enterprise/governance/agent-skills/ado-new-project/SKILL-QUICK.md
portable: true
license: Apache-2.0
---

# ADO-New-Project — Bootstrap Completo

## Propósito
Cria toda a infraestrutura ADO necessária para um novo projeto HSEOS:
- Projeto ADO com boards configurados
- Iteration Paths (Phases → Sprints)
- Migração opcional do repositório Git
- Pipeline CI/CD (`azure-pipelines.yml`)
- Atualiza `.hseos/config/hseos.config.yaml` com as coordenadas

## Pré-requisitos
- `ADO_PAT` com permissão de criação de projeto na organização
- `az devops` CLI instalado OU MCP server `azure-devops` ativo
- Projeto git inicializado (`.git/` existe)

## Fluxo interativo (5 etapas)

### Etapa 1 — Pré-flight
```bash
# Verificar CLI ou MCP disponível
az devops --version 2>/dev/null || echo "CLI indisponível — usando MCP"

# Verificar PAT
[[ -n "$ADO_PAT" ]] || { echo "[ADO] ADO_PAT não definido. Execute: export ADO_PAT=<token>"; exit 1; }

# Verificar autenticação
echo "$ADO_PAT" | az devops login --organization "https://dev.azure.com/{org}" 2>/dev/null
```

### Etapa 2 — Criar Org/Project
**PROMPT ao usuário:**
```
Nome da organização ADO (ex: hideakisolutions): ___
Nome do projeto (ex: meu-projeto): ___
Visibilidade [private/public] (default: private): ___
```

Criar projeto:
```bash
az devops project create \
  --name "{project}" \
  --organization "https://dev.azure.com/{org}" \
  --visibility private \
  --process Agile
```

Capturar `id` retornado → salvar em `hseos.config.yaml`.

### Etapa 3 — Iteration Paths
Criar estrutura de phases conforme `ado.iteration_template`:

**PROMPT ao usuário:**
```
Quantas Phases iniciais? (default: 4): ___
Nomes das Phases (ex: "Bootstrap,Walking Skeleton,Security Layer,Automation Core"): ___
```

Para cada Phase:
```bash
az boards iteration create \
  --name "Phase {N} — {nome}" \
  --organization "https://dev.azure.com/{org}" \
  --project "{project}"
```

Criar iteration raiz `{project}\Phase {N} — {nome}` primeiro, depois sub-iterations por sprint se necessário.

### Etapa 4 — Migração do repositório
**PROMPT EXPLÍCITO (obrigatório, não pular):**
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MIGRAÇÃO DE REPOSITÓRIO

Remote atual: {current_remote_url}

Opções:
  [y] Migrar para ADO Git (espelhar todos os branches e tags)
  [N] Manter GitHub/GitLab — criar apenas service connection ADO→atual
  [s] Pular (configurar manualmente depois)

Escolha [y/N/s]: ___
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Se y (migrar):**
Confirmar novamente: `Confirmar migração para ADO Git? Esta ação é irreversível. [yes/no]: ___`
```bash
ADO_GIT_URL="https://dev.azure.com/{org}/{project}/_git/{project}"
git remote add ado "$ADO_GIT_URL"
git push ado --mirror
```
Atualizar `ado.repo_url` em `hseos.config.yaml`.

**Se N (service connection):**
Instruir usuário a criar service connection manualmente em ADO → Project Settings → Service connections.
Registrar `ado.repo_url` como URL do remote atual (GitHub/etc).

**Se s (skip):**
Registrar `ado.repo_url: ""` em `hseos.config.yaml`. Advisory de configuração posterior.

### Etapa 5 — Pipeline CI/CD
Detectar stack do projeto:
```bash
[[ -f "package.json" ]] && STACK="nodejs"
[[ -f "pyproject.toml" ]] && STACK="python"
[[ -f "go.mod" ]] && STACK="go"
[[ -f "*.csproj" || -d "src" ]] && STACK="dotnet"
[[ -f "azure-pipelines.yml" ]] && echo "Pipeline já existe — skip criação"
```

Se `azure-pipelines.yml` não existe → criar baseado em template de 4 stages:
- `Integracao_Continua` (CI: lint, test, build)
- `Build_e_Publicacao` (imagens Docker → registry)
- `Deploy_Dev` (gitops + aprovação manual)
- `Deploy_Hmg` (gitops + aprovação manual + schedule noturno)

```bash
az pipelines create \
  --name "{project}-ci" \
  --organization "https://dev.azure.com/{org}" \
  --project "{project}" \
  --yaml-path azure-pipelines.yml \
  --repository-type github  # ou tfsgit se migrou para ADO
```

Salvar `pipeline_id` retornado em `hseos.config.yaml`.

## Atualização do hseos.config.yaml
Ao final, escrever:
```yaml
ado:
  enabled: true
  org: "{org}"
  project: "{project}"
  project_id: "{uuid-retornado}"
  repo_url: "{ado-git-url-ou-github-url}"
  pipeline_id: "{pipeline-id}"
  auth_env: ADO_PAT
  parallel_max: 10
  iteration_template: "Phase {phase} — {name}"
  granularity:
    epic: phase
    feature: wave_group
    story: wave
    task: worktree
    max_files_per_task: 4
    max_loc_per_task: 1000
    max_context_pct: 60
  enforce:
    preflight_gate: true
    branch_guard: true
    plan_advisory: true
```

## Template azure-pipelines.yml (gerado)
```yaml
trigger:
  branches:
    include: [main, develop]

pr:
  branches:
    include: [main, develop]

pool:
  name: Default

stages:
  - stage: Integracao_Continua
    displayName: "CI — Lint + Test"
    jobs:
      - job: ci
        steps:
          - script: echo "Configure CI steps for your stack"
            displayName: "Run CI"

  - stage: Build_e_Publicacao
    dependsOn: Integracao_Continua
    condition: and(succeeded(), ne(variables['Build.Reason'], 'PullRequest'))
    jobs:
      - job: build
        steps:
          - script: echo "Build and publish images"

  - stage: Deploy_Dev
    dependsOn: Build_e_Publicacao
    condition: and(succeeded(), eq(variables['Build.SourceBranch'], 'refs/heads/develop'))
    jobs:
      - deployment: deploy_dev
        environment: "{project}-dev"
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploy to dev"

  - stage: Deploy_Hmg
    dependsOn: Build_e_Publicacao
    condition: |
      and(
        succeeded(),
        or(
          eq(variables['Build.SourceBranch'], 'refs/heads/main'),
          eq(variables['Build.Reason'], 'Schedule')
        )
      )
    jobs:
      - deployment: deploy_hmg
        environment: "{project}-hmg"
        strategy:
          runOnce:
            deploy:
              steps:
                - script: echo "Deploy to hmg"
```


## Quick Mode

For low-context activation, load `.enterprise/governance/agent-skills/ado-new-project/SKILL-QUICK.md` or `QUICK.md` first. Load this full skill for deep analysis, violation fixing, or formal review gates.

