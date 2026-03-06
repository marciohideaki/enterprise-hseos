# Enterprise Bootstrap Tooling
**Scope:** Enterprise Overlay Initialization
**Execution:** Manual
**Status:** Controlled

---

## Scripts

| Script | Propósito |
|---|---|
| `bmad-enterprise-overlay-bootstrap.ps1` | Inicializa a estrutura `.enterprise/` em um repositório |
| `install-global.ps1` | Instala a governança globalmente no `~/.codex/` |

---

## `bmad-enterprise-overlay-bootstrap.ps1`

Cria a estrutura completa de diretórios e arquivos placeholder do overlay `.enterprise/` em um repositório.

**Onde executar:** Raiz do repositório
**Efeito:** Cria diretórios e arquivos placeholder
**Segurança:** Idempotente, cria backups se necessário

```powershell
.\bmad-enterprise-overlay-bootstrap.ps1
.\bmad-enterprise-overlay-bootstrap.ps1 -DryRun
```

---

## `install-global.ps1`

Instala a constituição e os agentes globalmente no `~/.codex/`, tornando a governança disponível em **qualquer projeto**, independente do diretório de trabalho.

### Pré-requisitos

- [Codex CLI](https://platform.openai.com/docs/codex/overview) instalado e configurado
- PowerShell 5.1+ (nativo no Windows) ou PowerShell 7+
- Este repositório clonado localmente

### Instalação

```powershell
# Interativo — pergunta antes de sobrescrever arquivos existentes
.\.enterprise\tooling\bootstrap\install-global.ps1

# Silencioso — sobrescreve tudo sem confirmação
.\.enterprise\tooling\bootstrap\install-global.ps1 -Force

# Preview — mostra o que seria feito sem alterar nada
.\.enterprise\tooling\bootstrap\install-global.ps1 -DryRun
```

### O que é instalado

```
C:\Users\<você>\.codex\
├── AGENTS.md                      <- Regras sempre ativas (toda sessão, ~900 tokens)
├── commands\
│   ├── constitution.md            <- /constitution
│   ├── setup.md                   <- /setup
│   ├── analyst.md                 <- /analyst
│   ├── architect.md               <- /architect
│   ├── dev.md                     <- /dev
│   ├── pm.md                      <- /pm
│   ├── sm.md                      <- /sm
│   ├── tea.md                     <- /tea
│   ├── tech-writer.md             <- /tech-writer
│   ├── quick-flow.md              <- /quick-flow
│   └── ux-designer.md             <- /ux-designer
└── enterprise\
    └── .specs\                    <- Biblioteca completa de specs (para /setup)
```

### Atualizar

Sempre que este repositório receber uma nova versão (constituição, agentes, specs), basta re-executar:

```powershell
.\.enterprise\tooling\bootstrap\install-global.ps1 -Force
```

---

## Como funciona

### `AGENTS.md` — Sempre ativo

Carregado automaticamente pelo Codex CLI em **toda sessão**. Contém apenas o essencial (~900 tokens):

- Non-negotiables (regras invioláveis)
- Regras de comportamento do agente (MUST / MUST NOT)
- **Execution Discipline** — planejamento, subagentes, verificação, bug fixing autônomo
- **Core Principles** — Simplicity, No Laziness, Minimal Impact, Defensive, Correctness
- Protocolo de resolução de conflitos entre documentos
- Tabela de precedência de documentos
- Índice dos comandos disponíveis

### `commands/` — On-demand (zero custo até ser invocado)

Cada arquivo em `~/.codex/commands/` vira um slash command global. Só consome tokens quando explicitamente chamado.

---

## Comandos disponíveis

### `/constitution`

**Caso de uso:** Revisar governance, propor mudanças estruturais, resolver conflitos entre documentos.

Carrega o documento completo `Enterprise-Constitution.md` (v2.0) na sessão. O Codex confirma ativação e aplica todas as suas regras.

---

### `/setup`

**Caso de uso:** Iniciar trabalho em um projeto novo ou carregar os specs e skills corretos para a stack em uso.

Wizard interativo com 4 perguntas:

1. **Stack** — Flutter / ReactNative / CSharp / Java / Go / PHP / C++
2. **Tipo de projeto** — Mobile App / Microservice / API / Library / Monolith
3. **Skills** — seleção guiada por grupos (ver `/skills` abaixo para detalhes)
4. **Modo:**
   - **(A) Sessão** — lê specs e skills no contexto atual. Nenhum arquivo criado.
   - **(B) Instalar no projeto** — cria `.enterprise/` com specs da stack + skills selecionadas.

Sempre carrega: constituição + core + cross-cutting. Carrega **apenas** a stack e skills selecionadas.

---

### `/skills`

**Caso de uso:** Adicionar ou atualizar skills em um projeto já existente, sem refazer o setup completo.

Wizard interativo com 3 perguntas:

1. **Stack** — para pré-selecionar skills relevantes (ex: `accessibility` só aparece pré-selecionada em Flutter/RN)
2. **Seleção de skills** — catálogo completo agrupado com pré-seleções inteligentes:

| Grupo | Skills | Padrão |
|---|---|---|
| **Core** | commit-hygiene, secure-coding, pr-review, naming-conventions, test-coverage | Todos selecionados |
| **Arquitetura** | ddd-boundary-check, breaking-change-detection, adr-compliance, spec-driven, threat-modeling | Nenhum |
| **Qualidade & Ops** | documentation-completeness, dependency-audit, observability-compliance, sanitize-comments, release-control, agent-permissions | Nenhum |
| **Stack-specific** | accessibility (Flutter/RN) | Auto se stack escolhida |
| **Opt-in** | performance-profiling | Nunca — requer ADR ativo |

3. **Modo:**
   - **(A) Sessão** — ativa skills no contexto atual. Nenhum arquivo criado.
   - **(B) Instalar no projeto** — copia as skills selecionadas para `.enterprise/governance/agent-skills/`

> Aceita: `"defaults"` (apenas core), `"all"` (todas, com aviso para performance-profiling), nome de grupo, ou lista de skills individuais.

```
/skills
```

---

### `/analyst`

**Caso de uso:** Elicitação de requisitos, análise de negócio, descoberta de contexto, validação de completude.

Motor de precisão de requisitos. Transforma necessidades ambíguas em requisitos explícitos e rastreáveis. Não aprova PRDs, não define arquitetura, não inventa soluções técnicas.

---

### `/architect`

**Caso de uso:** Documentos de arquitetura, definição de componentes e fronteiras de sistema, detecção de inconsistências, draft de ADRs.

Executor de autoridade técnica. Traduz intenção de produto em designs técnicos robustos. Não inventa requisitos, não simplifica por conveniência, não aprova ADRs.

---

### `/dev`

**Caso de uso:** Implementação de stories aprovadas, escrita de testes, ciclos red-green-refactor, validação de acceptance criteria.

Motor de execução de precisão. Implementa exatamente o que está especificado. Não interpreta intenção, não modifica escopo, não pula testes.

---

### `/pm`

**Caso de uso:** Criação de PRDs, definição de escopo, priorização de backlog, alinhamento entre objetivos de negócio e viabilidade técnica.

Executor de autoridade de produto. Responsável pelo *o que* é construído, nunca pelo *como*. Não define arquitetura, não enfraquece NFRs, não troca qualidade por velocidade.

---

### `/sm`

**Caso de uso:** Preparação de stories development-ready, validação de acceptance criteria, planejamento de sprint, orquestração de fluxo.

Orquestrador de fluxo de entrega. Garante clareza de execução sem alterar escopo ou design. Não implementa código, não redefine arquitetura.

---

### `/tea`

**Caso de uso:** Estratégia de testes, enforcement de quality gates, validação de NFRs de qualidade, draft de ADRs para trade-offs de cobertura.

Test Architect Agent. Define estratégias baseadas em risco. Não pula testes, não enfraquece quality gates, não documenta trade-offs sem justificativa.

---

### `/tech-writer`

**Caso de uso:** Produção de documentação técnica, enforcement de padrões de documentação, rastreabilidade entre docs e código.

Guardião de integridade documental. Não remove detalhes por brevidade, não inventa conteúdo, aplica sharding em docs grandes.

---

### `/quick-flow`

**Caso de uso:** Entrega end-to-end de features bem definidas — spec + código + testes + docs em um único fluxo, sem handoffs entre agentes.

Motor de alta velocidade. Executa múltiplas fases do ciclo de vida mantendo rigor enterprise. Não ignora validação de requisitos, não bypassa testes, não introduz mudanças arquiteturais sem ADR.

> **Quando usar:** features com escopo claro onde a separação entre agentes adicionaria overhead sem valor.

---

### `/ux-designer`

**Caso de uso:** Design de flows de UX, wireframes, validação de usabilidade, enforcement de acessibilidade (WCAG).

Todos os flows devem ser rastreáveis ao PRD. Acessibilidade é obrigatória. Não toma decisões de escopo, não altera arquitetura.

---

## Custo de tokens por abordagem

| O que | Quando consome tokens | Estimativa |
|---|---|---|
| `AGENTS.md` | Toda sessão, automaticamente | ~900 tokens |
| `/constitution` | Apenas quando invocado | ~5.000 tokens |
| `/setup` modo sessão | Invocação + specs + skills carregados | ~2.000–10.000 tokens |
| `/setup` modo instalar | Apenas a invocação + wizard | ~800 tokens |
| `/skills` modo sessão | Invocação + skills carregadas | ~500–3.000 tokens |
| `/skills` modo instalar | Apenas a invocação + wizard | ~500 tokens |
| Qualquer agente `/xxx` | Apenas quando invocado | ~500–1.500 tokens |

---

## Fluxo recomendado

```
Novo projeto
    └── /setup           <- stack + skills + instala .enterprise/ no repo

Atualizar skills de projeto existente
    └── /skills          <- adiciona ou troca skills sem refazer o setup

Sessão de trabalho
    └── /architect       <- define ou revisa arquitetura
    └── /pm              <- alinha ou atualiza PRD
    └── /sm              <- prepara stories
    └── /dev             <- implementa
    └── /tea             <- valida cobertura e quality gates

Revisão de governance
    └── /constitution    <- carrega constituição completa para análise
```

---

## Regras de execução

- Scripts MUST ser executados conscientemente
- Scripts SHOULD ser revisados antes da execução
- Scripts MUST NOT ser modificados sem incremento de versão
- Qualquer mudança requer atualização do cabeçalho de versão

---

**End**
