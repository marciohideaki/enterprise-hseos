# Primeiros Passos

> Guia do primeiro dia para engenheiros que ingressam em um projeto que usa HSEOS.

---

## Pré-requisitos

- Node.js ≥ 18
- Git configurado com sua identidade
- Claude Code CLI instalado (`npm install -g @anthropic-ai/claude-code`)
- Acesso ao repositório do projeto

---

## Passo 1 — Instale o HSEOS no seu projeto

A partir da raiz do seu projeto:

```bash
npx hseos install
```

Isso configura:
- `.claude/commands/` — todos os 14 comandos de agente (ativados como slash commands do Claude Code)
- `.enterprise/` — specs de governança, arquivos de autoridade dos agentes, biblioteca de skills
- `.hseos/` — configurações de agentes, definições de workflow, config local
- Git hooks — quality gates de pré-commit (lint, validação de schema, higiene de commits)

### Selecione quais ferramentas de IA configurar

Por padrão, `hseos install` configura Claude Code e Cursor. Para personalizar:

```bash
npx hseos install --tools claude-code,codex,gemini
npx hseos install --tools claude-code          # somente Claude Code
npx hseos install --tools none                 # pular setup de IDE, somente arquivos de governança
```

Ferramentas suportadas: `claude-code`, `cursor`, `windsurf`, `gemini`, `codex`, `antigravity`, `github-copilot`, `cline` e outras.

---

## Passo 2 — Leia a fundação de governança

Após a instalação, leia nesta ordem:

1. **`CLAUDE.md`** — As Sete Leis e o roster de agentes (5 min)
2. **`.enterprise/.specs/constitution/Enterprise-Constitution.md`** — Regras inegociáveis (10 min)
3. **`docs/agents/`** — Navegue pelos agentes relevantes para o seu papel (veja o guia de papéis abaixo)

> Você não precisa ler todos os `.specs/` no primeiro dia. Leia os padrões específicos do stack (`.enterprise/.specs/stack/<seu-stack>/`) quando começar a trabalhar nessa área.

---

## Passo 3 — Entenda o contexto do seu papel

### Se você é engenheiro de funcionalidades (entrega do dia a dia)

Os agentes com os quais você mais vai interagir:

| Agente | Quando usar |
|---|---|
| **RAZOR** | Iniciando uma sprint — preparação de histórias e planejamento de sprint |
| **GHOST** | Implementando uma história — execução com TDD |
| **GLITCH** | Validando cobertura e qualidade antes do PR |
| **QUILL** | Escrevendo ou atualizando documentação |

Fluxo diário típico:
```
RAZOR (preparar história) → GHOST (implementar) → GLITCH (validar) → QUILL (documentar) → PR
```

### Se você é tech lead ou arquiteto

| Agente | Quando usar |
|---|---|
| **NYX** | Pesquisa, análise de domínio, elicitação de requisitos |
| **VECTOR** | Autoria de PRD e epics |
| **CIPHER** | Design de arquitetura, rascunho de ADR, verificação de fronteiras |
| **ORBIT** | Iniciando uma entrega orquestrada de epic |
| **SWARM** | Entregando um lote heterogêneo (3+ tarefas independentes) em ondas paralelas com isolamento por worktree |

### Se você é engenheiro de plataforma/DevOps

| Agente | Quando usar |
|---|---|
| **FORGE** | Publicação de artefatos de release, promoção de build |
| **KUBE** | Atualizações de manifesto GitOps, deploys no ArgoCD |
| **SABLE** | Verificação de runtime pós-deploy, smoke tests |

---

## Passo 4 — Configure seu perfil de deploy (se trabalhar com Kubernetes)

Se seu projeto faz deploy no Kubernetes, verifique se `.hseos/config/kube-profile.yaml` existe:

```bash
cat .hseos/config/kube-profile.yaml
```

Se ausente, KUBE detecta automaticamente o modelo GitOps a partir da estrutura do seu repositório. Veja [agents/kube.md](../agents/kube.md) para detalhes.

---

## Passo 5 — Execute seu primeiro agente

Abra o Claude Code no seu projeto e tente:

```
/razor
```

Digite `SP` para Sprint Planning. RAZOR vai guiar você pelo checklist de prontidão da sprint.

---

## Regras de workflow Git

O HSEOS aplica estas regras automaticamente via git hooks:

| Regra | O que significa |
|---|---|
| Sem commits diretos em `main`/`master` | Trabalhe sempre em um branch de feature |
| Sem force push em branches protegidos | Use PRs |
| Sem atribuição de ferramentas de IA em mensagens de commit | `Co-authored-by: Claude` será rejeitado |
| Formato de conventional commit obrigatório | `feat:`, `fix:`, `chore:`, `docs:`, etc. |

Se um commit for rejeitado, leia a mensagem de erro — ela vai indicar exatamente qual regra foi violada e como corrigir.

---

## Quality gates (pré-commit)

Cada commit aciona:

1. **Branch guard** — bloqueia commits diretamente em main/master
2. **Lint** — linter do projeto (específico do stack)
3. **Testes de schema de agente** — valida arquivos YAML dos agentes
4. **Testes de instalação** — verifica integridade do framework
5. **Scan de segurança** — detecta secrets hardcoded
6. **Higiene de commit** — verificações de formato e atribuição

Se um gate falhar, o commit é rejeitado com a mensagem de falha específica. Corrija o problema e faça o commit novamente — não use `--no-verify`.

---

## Obtendo ajuda

| Dúvida | Onde procurar |
|---|---|
| O que o agente X faz? | `docs/agents/<nome>.md` |
| Como o workflow Y funciona? | `docs/workflows.md` |
| O que a skill Z aplica? | `docs/skills.md` |
| Quais são as regras de arquitetura? | `.enterprise/.specs/constitution/` |
| Quais decisões foram tomadas? | `.enterprise/agents/<código>/authority.md` |
| Como adicionar uma nova skill? | `.enterprise/governance/agent-skills/README.md` |
| Como adotar padrões externos? | `.enterprise/governance/skills-adoption-guide.md` |
