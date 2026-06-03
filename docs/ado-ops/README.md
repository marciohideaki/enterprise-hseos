# ADO-Ops Module

Azure DevOps integration for HSEOS — desacoplado via feature flag, cobrindo o ciclo
ADO-first completo: planejamento → execução rastreada → fechamento automatizado.

## Pré-requisitos

- `ADO_PAT` — Personal Access Token com escopos: Work Items (Read & Write), Code (Read)
- Node.js + npx (para MCP server `@azure-devops/mcp-server`)
- `yq` (opcional, mas recomendado para manipulação de YAML)
- `jq` (opcional, mas recomendado para manipulação de JSON)

## Instalação

```bash
# 1. Gere um PAT no Azure DevOps
# https://dev.azure.com/{org}/_usersSettings/tokens

# 2. Configure no ambiente (recomendado: salvar no pass)
export ADO_PAT=<seu-pat>
pass insert azure/ado-pat <<< "$ADO_PAT"

# 3. Instale o módulo
bash scripts/ado-install.sh

# 4. Verifique a instalação
bash scripts/ado-doctor.sh

# 5. Configure o projeto ADO (interativo)
# No Claude Code: /atlas setup
```

## Ativação manual (sem script)

Se preferir configurar manualmente, edite `.hseos/config/hseos.config.yaml`:

```yaml
ado:
  enabled: true          # ← mudar de false para true
  org: "sua-org"
  project: "seu-projeto"
  project_id: "uuid-do-projeto"
  repo_url: "https://dev.azure.com/sua-org/seu-projeto/_git/seu-projeto"
  pipeline_id: ""        # preencher após criar pipeline
  auth_env: ADO_PAT
  parallel_max: 10
```

## Fluxo ADO-First

```
1. PLAN aprovado (G2) → /atlas plan → cria Epic/Feature/Story/Task no ADO
2. /dev-squad → agentes executam com ADO Task IDs
3. git commit → hook auto-atualiza Task ADO (Active)
4. gh pr create → hook auto-linka PR à Story ADO
5. PR mergeado → /atlas sync → fecha Tasks/Stories
6. /atlas close → fecha Feature, cria tag, atualiza MASTER-PLAN.md
7. git push --tags → hook emite evento → ATLAS fecha Epic
```

## Comandos ATLAS

| Comando | Ação |
|---------|------|
| `/atlas setup` | Bootstrap completo: criar projeto ADO + iteration paths + pipeline |
| `/atlas plan` | G1-ADO gate: cria hierarquia ADO a partir do PLAN.md |
| `/atlas sync` | Sincroniza estado dev-squad → ADO |
| `/atlas close` | Fecha wave: items + tag + MASTER-PLAN.md |

## Hierarquia ADO ↔ SWARM

| ADO | HSEOS | Granularidade |
|-----|-------|---------------|
| Epic | Phase | Multi-wave, owner: Architect |
| Feature | Wave group / Sprint | 2-4 waves correlatas |
| User Story | Wave única | 1 dev-squad run |
| Task | Worktree agent | ≤4 arquivos, ≤1000 LOC, ≤60% ctx Sonnet |

## Hooks Automáticos

| Hook | Evento | Ação |
|------|--------|------|
| `ado-preflight-gate` | PreToolUse/Agent | Avisa se PLAN.md sem ADO mapping |
| `ado-branch-guard` | PreToolUse/Bash | Bloqueia push direto em trunk |
| `ado-on-plan-write` | PostToolUse/Write | Advisory: PLAN.md sem mapeamento |
| `ado-task-progress` | PostToolUse/Bash | Auto-atualiza Task em git commit |
| `ado-pr-link` | PostToolUse/Bash | Linka PR à Story após gh pr create |
| `ado-tag-close` | PostToolUse/Bash | Emite evento para fechar Feature/Epic |

**Todos os hooks verificam `ado.enabled` como primeira instrução. Quando `false`, saem com `exit 0` silenciosamente.**

## Branch Pattern

```
feature/{epic-slug}-wave-{NNN}-{titulo}   # branch da wave (criada antes do dispatch)
ado-{TASK_ADO_ID}-{slug}                  # branch por worktree agent
```

Exemplo:
```bash
# Commander cria a branch da wave
git checkout -b feature/phase-7-wave-080-agent-core

# Worktree manager cria branches por task
scripts/governance/worktree-manager.sh create ado-1238-agent-factory feature/phase-7-wave-080-agent-core
```

## Diagnóstico

```bash
# Verificar saúde do módulo
bash scripts/ado-doctor.sh

# Verificar invariante de feature flag
bash test/ado-ops/feature-flag-disabled.test.sh

# Verificar sintaxe de todos os hooks
for h in .agents/hooks/handlers/ado-*.sh; do bash -n "$h" && echo "OK: $h"; done
```

## Segredos no `pass`

```bash
# Registrar PAT
pass insert azure/ado-pat

# Registrar credenciais do projeto
pass insert azure/ado-org <<< "hideakisolutions"
pass insert azure/ado-project <<< "meu-projeto"

# Exportar na sessão
export ADO_PAT=$(pass show azure/ado-pat)
export ADO_ORG=$(pass show azure/ado-org)
```

## Restrições Críticas da API ADO

1. **NUNCA criar work item com `State=Closed`** — ADO rejeita.
   Sempre: criar `New` → `wit_update_work_item` separado para `Closed`.

2. **Max 10 chamadas MCP por turno** — rate limiting do ADO.

3. **Idempotência obrigatória** — verificar WIQL antes de criar qualquer item.

## Troubleshooting

**Erro: ADO_PAT não definido**
```bash
export ADO_PAT=$(pass show azure/ado-pat)
```

**MCP server não responde**
```bash
npx @azure-devops/mcp-server --version
# Se falhar: npm install -g @azure-devops/mcp-server
# Reiniciar Claude Code para recarregar o MCP
```

**Hook não está disparando**
```bash
# Verificar se hooks estão em .claude/hooks.json
python3 -c "import json; d=json.load(open('.claude/hooks.json')); print([k for k in d['hooks']])"
# Reiniciar Claude Code
```

**ADO item duplicado (criado 2x)**
O `/atlas plan` tem idempotência via WIQL. Se duplicar, feche o duplicado manualmente no ADO board.
