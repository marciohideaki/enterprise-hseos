# Enterprise Bootstrap Tooling
**Scope:** Enterprise Overlay Initialization
**Execution:** Manual
**Status:** Controlled

---

## Scripts

| Script | PropÃ³sito |
|---|---|
| `bmad-enterprise-overlay-bootstrap.ps1` | Inicializa a estrutura `.enterprise/` em um repositÃ³rio |
| `install-global.ps1` | Instala a governanÃ§a globalmente no `~/.codex/` |

---

## `bmad-enterprise-overlay-bootstrap.ps1`

Cria a estrutura completa de diretÃ³rios e arquivos placeholder do overlay `.enterprise/` em um repositÃ³rio.

**Onde executar:** Raiz do repositÃ³rio
**Efeito:** Cria diretÃ³rios e arquivos placeholder
**SeguranÃ§a:** Idempotente, cria backups se necessÃ¡rio

```powershell
.\bmad-enterprise-overlay-bootstrap.ps1
.\bmad-enterprise-overlay-bootstrap.ps1 -DryRun
```

---

## `install-global.ps1`

Instala a constituiÃ§Ã£o e os agentes globalmente no `~/.codex/`, tornando a governanÃ§a disponÃ­vel em **qualquer projeto**, independente do diretÃ³rio de trabalho.

### PrÃ©-requisitos

- [Codex CLI](https://platform.openai.com/docs/codex/overview) instalado e configurado
- PowerShell 5.1+ (nativo no Windows) ou PowerShell 7+
- Este repositÃ³rio clonado localmente

### InstalaÃ§Ã£o

```powershell
# Interativo â€” pergunta antes de sobrescrever arquivos existentes
.\.enterprise\tooling\bootstrap\install-global.ps1

# Silencioso â€” sobrescreve tudo sem confirmaÃ§Ã£o
.\.enterprise\tooling\bootstrap\install-global.ps1 -Force

# Preview â€” mostra o que seria feito sem alterar nada
.\.enterprise\tooling\bootstrap\install-global.ps1 -DryRun
```

### O que Ã© instalado

```
C:\Users\<vocÃª>\\.codex\\
â”œâ”€â”€ AGENTS.md                      <- Regras sempre ativas (toda sessÃ£o, ~900 tokens)
â”œâ”€â”€ commands\
â”‚   â”œâ”€â”€ constitution.md            <- /constitution
â”‚   â”œâ”€â”€ setup.md                   <- /setup
â”‚   â”œâ”€â”€ analyst.md                 <- /analyst
â”‚   â”œâ”€â”€ architect.md               <- /architect
â”‚   â”œâ”€â”€ dev.md                     <- /dev
â”‚   â”œâ”€â”€ pm.md                      <- /pm
â”‚   â”œâ”€â”€ sm.md                      <- /sm
â”‚   â”œâ”€â”€ tea.md                     <- /tea
â”‚   â”œâ”€â”€ tech-writer.md             <- /tech-writer
â”‚   â”œâ”€â”€ quick-flow.md              <- /quick-flow
â”‚   â””â”€â”€ ux-designer.md             <- /ux-designer
â””â”€â”€ enterprise\
    â””â”€â”€ .specs\                    <- Biblioteca completa de specs (para /setup)
```

### Atualizar

Sempre que este repositÃ³rio receber uma nova versÃ£o (constituiÃ§Ã£o, agentes, specs), basta re-executar:

```powershell
.\.enterprise\tooling\bootstrap\install-global.ps1 -Force
```

---

## Como funciona

### `AGENTS.md` â€” Sempre ativo

Carregado automaticamente pelo Codex CLI em **toda sessÃ£o**. ContÃ©m apenas o essencial (~900 tokens):

- Non-negotiables (regras inviolÃ¡veis)
- Regras de comportamento do agente (MUST / MUST NOT)
- **Execution Discipline** â€” planejamento, subagentes, verificaÃ§Ã£o, bug fixing autÃ´nomo
- **Core Principles** â€” Simplicity, No Laziness, Minimal Impact, Defensive, Correctness
- Protocolo de resoluÃ§Ã£o de conflitos entre documentos
- Tabela de precedÃªncia de documentos
- Ãndice dos comandos disponÃ­veis

### `commands/` â€” On-demand (zero custo atÃ© ser invocado)

Cada arquivo em `~/.codex/commands/` vira um slash command global. SÃ³ consome tokens quando explicitamente chamado.

---

## Comandos disponÃ­veis

### `/constitution`

**Caso de uso:** Revisar governance, propor mudanÃ§as estruturais, resolver conflitos entre documentos.

Carrega o documento completo `Enterprise-Constitution.md` (v2.0) na sessÃ£o. O Codex confirma ativaÃ§Ã£o e aplica todas as suas regras.

---

### `/setup`

**Caso de uso:** Iniciar trabalho em um projeto novo ou carregar os specs e skills corretos para a stack em uso.

Wizard interativo com 4 perguntas:

1. **Stack** â€” Flutter / ReactNative / CSharp / Java / Go / PHP / C++
2. **Tipo de projeto** â€” Mobile App / Microservice / API / Library / Monolith
3. **Skills** â€” seleÃ§Ã£o guiada por grupos (ver `/skills` abaixo para detalhes)
4. **Modo:**
   - **(A) SessÃ£o** â€” lÃª specs e skills no contexto atual. Nenhum arquivo criado.
   - **(B) Instalar no projeto** â€” cria `.enterprise/` com specs da stack + skills selecionadas.

Sempre carrega: constituiÃ§Ã£o + core + cross-cutting. Carrega **apenas** a stack e skills selecionadas.

---

### `/skills`

**Caso de uso:** Adicionar ou atualizar skills em um projeto jÃ¡ existente, sem refazer o setup completo.

Wizard interativo com 3 perguntas:

1. **Stack** â€” para prÃ©-selecionar skills relevantes (ex: `accessibility` sÃ³ aparece prÃ©-selecionada em Flutter/RN)
2. **SeleÃ§Ã£o de skills** â€” catÃ¡logo completo agrupado com prÃ©-seleÃ§Ãµes inteligentes:

| Grupo | Skills | PadrÃ£o |
|---|---|---|
| **Core** | commit-hygiene, secure-coding, pr-review, naming-conventions, test-coverage | Todos selecionados |
| **Arquitetura** | ddd-boundary-check, breaking-change-detection, adr-compliance, spec-driven, threat-modeling | Nenhum |
| **Qualidade & Ops** | documentation-completeness, dependency-audit, observability-compliance, sanitize-comments, release-control, agent-permissions | Nenhum |
| **Stack-specific** | accessibility (Flutter/RN) | Auto se stack escolhida |
| **Opt-in** | performance-profiling | Nunca â€” requer ADR ativo |

3. **Modo:**
   - **(A) SessÃ£o** â€” ativa skills no contexto atual. Nenhum arquivo criado.
   - **(B) Instalar no projeto** â€” copia as skills selecionadas para `.enterprise/governance/agent-skills/`

> Aceita: `"defaults"` (apenas core), `"all"` (todas, com aviso para performance-profiling), nome de grupo, ou lista de skills individuais.

```
/skills
```

---

### `/analyst`

**Caso de uso:** ElicitaÃ§Ã£o de requisitos, anÃ¡lise de negÃ³cio, descoberta de contexto, validaÃ§Ã£o de completude.

Motor de precisÃ£o de requisitos. Transforma necessidades ambÃ­guas em requisitos explÃ­citos e rastreÃ¡veis. NÃ£o aprova PRDs, nÃ£o define arquitetura, nÃ£o inventa soluÃ§Ãµes tÃ©cnicas.

---

### `/architect`

**Caso de uso:** Documentos de arquitetura, definiÃ§Ã£o de componentes e fronteiras de sistema, detecÃ§Ã£o de inconsistÃªncias, draft de ADRs.

Executor de autoridade tÃ©cnica. Traduz intenÃ§Ã£o de produto em designs tÃ©cnicos robustos. NÃ£o inventa requisitos, nÃ£o simplifica por conveniÃªncia, nÃ£o aprova ADRs.

---

### `/dev`

**Caso de uso:** ImplementaÃ§Ã£o de stories aprovadas, escrita de testes, ciclos red-green-refactor, validaÃ§Ã£o de acceptance criteria.

Motor de execuÃ§Ã£o de precisÃ£o. Implementa exatamente o que estÃ¡ especificado. NÃ£o interpreta intenÃ§Ã£o, nÃ£o modifica escopo, nÃ£o pula testes.

---

### `/pm`

**Caso de uso:** CriaÃ§Ã£o de PRDs, definiÃ§Ã£o de escopo, priorizaÃ§Ã£o de backlog, alinhamento entre objetivos de negÃ³cio e viabilidade tÃ©cnica.

Executor de autoridade de produto. ResponsÃ¡vel pelo *o que* Ã© construÃ­do, nunca pelo *como*. NÃ£o define arquitetura, nÃ£o enfraquece NFRs, nÃ£o troca qualidade por velocidade.

---

### `/sm`

**Caso de uso:** PreparaÃ§Ã£o de stories development-ready, validaÃ§Ã£o de acceptance criteria, planejamento de sprint, orquestraÃ§Ã£o de fluxo.

Orquestrador de fluxo de entrega. Garante clareza de execuÃ§Ã£o sem alterar escopo ou design. NÃ£o implementa cÃ³digo, nÃ£o redefine arquitetura.

---

### `/tea`

**Caso de uso:** EstratÃ©gia de testes, enforcement de quality gates, validaÃ§Ã£o de NFRs de qualidade, draft de ADRs para trade-offs de cobertura.

Test Architect Agent. Define estratÃ©gias baseadas em risco. NÃ£o pula testes, nÃ£o enfraquece quality gates, nÃ£o documenta trade-offs sem justificativa.

---

### `/tech-writer`

**Caso de uso:** ProduÃ§Ã£o de documentaÃ§Ã£o tÃ©cnica, enforcement de padrÃµes de documentaÃ§Ã£o, rastreabilidade entre docs e cÃ³digo.

GuardiÃ£o de integridade documental. NÃ£o remove detalhes por brevidade, nÃ£o inventa conteÃºdo, aplica sharding em docs grandes.

---

### `/quick-flow`

**Caso de uso:** Entrega end-to-end de features bem definidas â€” spec + cÃ³digo + testes + docs em um Ãºnico fluxo, sem handoffs entre agentes.

Motor de alta velocidade. Executa mÃºltiplas fases do ciclo de vida mantendo rigor enterprise. NÃ£o ignora validaÃ§Ã£o de requisitos, nÃ£o bypassa testes, nÃ£o introduz mudanÃ§as arquiteturais sem ADR.

> **Quando usar:** features com escopo claro onde a separaÃ§Ã£o entre agentes adicionaria overhead sem valor.

---

### `/ux-designer`

**Caso de uso:** Design de flows de UX, wireframes, validaÃ§Ã£o de usabilidade, enforcement de acessibilidade (WCAG).

Todos os flows devem ser rastreÃ¡veis ao PRD. Acessibilidade Ã© obrigatÃ³ria. NÃ£o toma decisÃµes de escopo, nÃ£o altera arquitetura.

---

## Custo de tokens por abordagem

| O que | Quando consome tokens | Estimativa |
|---|---|---|
| `AGENTS.md` | Toda sessÃ£o, automaticamente | ~900 tokens |
| `/constitution` | Apenas quando invocado | ~5.000 tokens |
| `/setup` modo sessÃ£o | InvocaÃ§Ã£o + specs + skills carregados | ~2.000â€“10.000 tokens |
| `/setup` modo instalar | Apenas a invocaÃ§Ã£o + wizard | ~800 tokens |
| `/skills` modo sessÃ£o | InvocaÃ§Ã£o + skills carregadas | ~500â€“3.000 tokens |
| `/skills` modo instalar | Apenas a invocaÃ§Ã£o + wizard | ~500 tokens |
| Qualquer agente `/xxx` | Apenas quando invocado | ~500â€“1.500 tokens |

---

## Fluxo recomendado

```
Novo projeto
    â””â”€â”€ /setup           <- stack + skills + instala .enterprise/ no repo

Atualizar skills de projeto existente
    â””â”€â”€ /skills          <- adiciona ou troca skills sem refazer o setup

SessÃ£o de trabalho
    â””â”€â”€ /architect       <- define ou revisa arquitetura
    â””â”€â”€ /pm              <- alinha ou atualiza PRD
    â””â”€â”€ /sm              <- prepara stories
    â””â”€â”€ /dev             <- implementa
    â””â”€â”€ /tea             <- valida cobertura e quality gates

RevisÃ£o de governance
    â””â”€â”€ /constitution    <- carrega constituiÃ§Ã£o completa para anÃ¡lise
```

---

## Regras de execuÃ§Ã£o

- Scripts MUST ser executados conscientemente
- Scripts SHOULD ser revisados antes da execuÃ§Ã£o
- Scripts MUST NOT ser modificados sem incremento de versÃ£o
- Qualquer mudanÃ§a requer atualizaÃ§Ã£o do cabeÃ§alho de versÃ£o

---

**End**



