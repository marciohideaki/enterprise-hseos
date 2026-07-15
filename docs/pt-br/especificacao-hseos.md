# HSEOS — Especificação de Sistema e Catálogo de Capacidades

> **Versão do runtime:** 2.0.0 · **Branch de referência:** `feature/capability-packaging-v1` · **Data:** 2026-07-08
> Documento gerado por análise exaustiva do repositório (`.enterprise/`, `.agents/`, `.hseos/`, `.claude/`, `.codex/`, `.github/`, `.husky/`, `src/`, `packages/`, `scripts/`, `tools/`, `test/`, `docs/`).
> Cada seção descreve **o que existe**, **como funciona** e **por que existe** (racional).

---

## 1. Visão geral

O HSEOS (Hideaki Software Engineering Operating System) é um framework institucional de engenharia assistida por IA, **spec-driven e governance-first**. Este repositório **é** o runtime do HSEOS — não um projeto que o consome. A premissa central: agentes de IA não são apenas ferramenta de produtividade; são extensão de um sistema de governança que precisa preservar rigor. O lema operacional aparece em toda a stack: **"Agents execute. Humans decide."**

Números do sistema (estado atual):

| Dimensão | Quantidade |
|---|---|
| Agentes registrados no manifest | 16 (14 roster + ATLAS + HSEOS-MASTER) |
| Skills governadas | 49 |
| Hooks no registry neutro | 28 (26 ativos, 2 inativos opt-in) — fonte canônica em `.enterprise/governance/hooks/` desde o ciclo 02 |
| Handlers portáveis de hook | 22 scripts `.sh` (incl. `_ado-lib.sh` e o swarm-gate canônico) + README — 23 arquivos hash-pinned no manifest |
| Workflows | 38 `workflow.md` em `.hseos/workflows/` (7 registrados com contrato completo em `registry.yaml`) |
| Comandos CLI `hseos` | ~21 (auto-discovery em `tools/cli/commands/`) |
| Servidores MCP nativos | 4 (+ 5 market-standard + 5 enterprise via bundles) |
| Adapters de IDE/plataforma | 19 no installer; 3 com spec declarativa completa (claude-code, codex, goose) |
| Perfis de capability | 7 (`minimal`→`full`) · 4 hook profiles · 18 componentes + sintéticos `skill:*` |
| ADRs | 16 (14 Accepted; 0004/0005 são templates "Proposed" — ratificação em lote 2026-07-08) |
| Standards normativos | 13 core + 16 cross-cutting + 7 stacks × 10 docs |
| Políticas | 12 |
| Testes | 32 arquivos JS + 5 shell — todos encadeados no `npm test` desde o ciclo 01 (zero órfãos de CI) |

---

## 2. Arquitetura de fontes de verdade

### 2.1 O fluxo canônico (ADR-0006)

```
.enterprise/  ──(fonte de governança)──►  compiler  ──►  .agents/  ──(artefatos compilados,
 constituição, ADRs,                     (agent-core)     portáveis, hash-pinned)
 políticas, skills canônicas                                  │
                                                              ▼
                                    adapters derivados: .claude/  .codex/  .goose/ ...
                                                              │
                                    runtime + estado:    .hseos/  (agents, workflows,
                                                                   config, runs, SQLite)
```

- **`.enterprise/`** — fonte institucional. Só aqui se edita governança.
- **`.agents/`** — saída do compiler: vendor-neutral, portável, com hashes SHA-256 pinados em `manifest.yaml`. *Read-only para humanos.*
- **`.claude/`, `.codex/`, …** — adapters por ferramenta, derivados de `.agents/`. Nunca são fonte.
- **`.hseos/`** — runtime: definições de agente executáveis, workflows, configuração (`hseos.config.yaml`), estado (SQLite) e runs.

**Por que existe:** o v1.x tinha 3 dependências load-bearing na máquina host (`~/.claude/`, Axon global, vault local), quebrando a promessa de "clone limpo funciona em qualquer lugar". O ADR-0006 formalizou 7 invariantes (P1 Single Source of Truth, P2 Adapters derivados, P3 Integridade hash-pinned, P4 Paridade entre vendors, P5 **Zero global path**, P6 **Graceful degradation**, P7 Tier policy machine-readable). P5 e P6 são enforçados por CI real (`standalone-smoke.yaml` roda em container limpo, verifica ausência de `~/.claude` e testa que tudo degrada graciosamente sem o vault).

### 2.2 Cascata de instruções (precedência)

De `.agents/instructions/PROJECT.md`: (1) Constituição → (2) regras neutras (`PROJECT.md` + `manifest.yaml`) → (3) adapter da ferramenta (`AGENTS.md`/`CLAUDE.md`) → (4) autoridade do agente (`.enterprise/agents/<code>/authority.md`) → (5) skill acionada → (6) instrução do usuário na conversa. **Conflito entre instruções = parar e pedir decisão humana. Nunca tirar média de standards.**

**Por que existe:** sem ordem explícita de precedência, agentes "resolvem" conflitos escolhendo o caminho mais fácil ou inventando um meio-termo — os dois comportamentos corroem standards silenciosamente.

---

## 3. Regras e Diretivas

### 3.1 Constituição (`.enterprise/.specs/constitution/Enterprise-Constitution.md`, v2.0)

14 seções; as 5 **non-negotiables** (§2):

1. **GitHub é a única fonte de verdade** — chat e memória de agente não são autoritativos (proteção contra alucinação e contexto stale; reforçado por `output.chat_not_authoritative: true` no `hseos.config.yaml`).
2. **State-of-the-Art é o baseline** — trade-off abaixo do estado da arte exige draft de ADR.
3. **Preservação de requisitos** — proíbe "resumir para fora" requisitos existentes (Zero Requirement Loss).
4. **Sharding obrigatório** para documentos grandes (Index-First Rule).
5. **Sem reinvenção de arquitetura** — agente sugere via ADR draft; nunca substitui silenciosamente.

Outras seções load-bearing: §3 hierarquia documental (Constitution > core > cross > stack > ADRs > templates > gerados); §5 modelo operacional Draft→Review→Merge; §9 protocolo stop-the-line para conflitos; §11 consumo de skills em camadas.

### 3.2 Standards core (`.specs/core/`, 13 documentos — invariantes organizacionais)

| Standard | Regras-chave | Por que existe |
|---|---|---|
| AGENT RULES STANDARD (AR-01..57) | AR-08 Clean Architecture; AR-17 DB relacional como fonte de verdade; AR-23 Outbox obrigatório; AR-52 commits sem menção a IA; AR-55..57 roteamento de modelo (Sonnet default, escalação >20% = decomposição errada) | Contrato comportamental único para qualquer agente em qualquer stack |
| Hexagonal & Clean Architecture (HA-01..29) | Dependency Rule inviolável (HA-19); compliance via skill `ddd-boundary-check` (HA-26) | Múltiplas arquiteturas coexistindo aumentavam custo de onboarding (ADR-0001) |
| CQRS (CQ-01..35) | Commands mutam / queries leem; DTOs tipados, nunca modelo de banco cru | Resolveu contradição AR-17 × CQ-17 (ADR-0003) |
| Event Sourcing (ES-01..54) | Opt-in por ADR; eventos imutáveis; correção = evento compensatório | Overhead de ES desproporcional sem necessidade de histórico (ADR-0002) |
| Saga (SG-01..43) | Compensation Map obrigatório; sem ele, saga não vai a produção (SG-43) | Sagas sem compensação documentada = falha operacional garantida |
| Microservices (MS-01..50) | 1 BC = 1 serviço; DB compartilhado proibido; `/health` `/ready` `/metrics`; mTLS | Isolamento de bounded context como propriedade estrutural |
| SOLID & Craftsmanship (SP-01..90) | 6 anti-patterns nomeados; complexidade ciclomática ≤10; waivers via ADR (nunca para SP-41/42/44/68) | Base de qualidade de código com exemplos em 4 linguagens |
| Git Flow & Release | Regex de termos proibidos em commit `(?i)\b(ai|ia|gpt|chatgpt|claude|copilot|hseos|...)\b` | Histórico git público sem atribuição de metodologia/IA |
| Deprecation & Sunset (DS-01..22) | APIs 90 dias, eventos/mobile 180+; sunset quebrante = ADR | Mudanças quebrantes previsíveis |
| + Engineering Governance, Engineering Playbook (Eval-First Loop, Subagent-Driven Development, Scope Lock/Known Gaps), Naming v2.0, Quality Gates (BLOCKING vs WARNING) | | |

### 3.3 Standards cross-cutting (`.specs/cross/`, 16 — 15 mandatórios + 1 opt-in)

Destaques: **CI/CD** (12 stages fixos, SLSA L2, feature branch ≤5 dias); **Data Governance & LGPD** (4 níveis de classificação, PII nunca em log, erasure em 15 dias úteis, ANPD 72h); **Testing** (pirâmide 70/20/10, mutation score ≥70% no domínio bloqueia release, PII real em teste = P0); **Security & Supply Chain** (CRITICAL/HIGH bloqueia merge; secret no histórico → revogar credencial ANTES de qualquer outra ação); **Resilience** (timeout explícito, retry com jitter, circuit breaker); **API Management** (RFC 7807, sunset ≥6/12 meses); **Performance Engineering** (único opt-in, ativado por ADR — template ADR-0005).

**Distintivo do HSEOS:** 5 standards `CE-*` tratam **engenharia de contexto de agentes como disciplina normativa**: Context-Compression, Context-Degradation-Monitoring (10 padrões nomeados de degradação), Memory-Architecture (4 tipos de memória), Multi-Agent-Architecture (trust boundaries: tool result é sempre não-confiável — defesa anti prompt-injection), Tool-Design-Governance (tools classificadas por reversibilidade; tool irreversível exige instrução explícita na sessão).

### 3.4 Standards por stack (`.specs/<Stack>/`, 7 stacks × 10 docs)

CSharp, Cpp, Flutter, Go, Java, PHP, ReactNative — template idêntico (Architecture, FR, NFR, Networking, Service/Feature Template, PR Checklist, Idiomatic Guide, Build, Testing, Modern Features). **Por que existe:** o mesmo invariante core se traduz idiomaticamente por linguagem (ex.: Java = domínio zero-Spring; PHP = `readonly class` para VOs; RN = New Architecture obrigatória).

### 3.5 Políticas (`.enterprise/policies/` + `governance/policies/`, 12)

| Política | Regula | Racional |
|---|---|---|
| `adr-policy.md` | Quando ADR é obrigatório | "No significant decision may remain implicit" |
| `skill-consumption.md` | Protocolo 3 tiers (Registry→QUICK→FULL), RP-SK-01..09 | Carregar a skill errada ou demais = poluição de contexto |
| `specification-consumption.md` | Hierarquia Canonical > Anchors > Mappings > Views | "Parar por conflito é resultado de governança bem-sucedida, não falha" |
| `shared-infrastructure.md` | Infra compartilhada obrigatória (`shared-*` local / `platform-shared-dev` k3s), mapa de 14 serviços | Evita proliferação de postgres/redis per-project e conflitos de porta |
| `sharding-policy.md` | Gatilhos e modelo canônico de sharding | Documentos grandes degradam consumo por agente |
| `automated-validation.md` | Validação estrutural de todo output de agente | Falha estrutural = rejeitado antes de revisão humana |
| `documentation-policy.md` | Docs as code; "No Shallow Documentation" | Doc é artefato de engenharia de primeira classe |
| `exceptions.md` | Desvios via `EXC-XXXX` com expiração | Sem auto-aprovação por agente; exceção expirada é inválida |
| `pre-flight-checks.md` | Checklist pré-execução | Execução sem pre-flight = output inválido |
| `minimal-wiring.md` | Uma linha de wiring de governança em prompts | Proíbe hardcode de paths internos em prompts |
| `standards-adoption-metrics.md` | Scorecard 8 dimensões ponderadas; <75 = feature freeze | Compliance mensurável, não aspiracional |
| `architecture-boundaries.md` | Fronteiras DDD mandatórias | Anti-padrões proibidos (Shared Domain Model, domínio com ORM) |

### 3.6 Governança de execução (`governance/execution-governance.md` + `AGENTS.md` §4-§9)

Regras git que **sobrescrevem defaults do sistema**: nunca commit em main/master/develop; nunca merge sem aprovação humana; nunca `Co-Authored-By`; nunca menção a IA em commit; nunca `--no-verify`; nunca force-push sem autorização; branches `task/*` só via ciclo de worktree. Commit: `<type>(<scope>): <resumo imperativo>` ≤100 chars; **1 commit = 1 task concluída; 1 wave = 1 PR**.

---

## 4. Decisões — ADRs (`.specs/decisions/`, 16)

| ADR | Título | Status | Essência |
|---|---|---|---|
| 0001 | Hexagonal obrigatória | Accepted | Ports & Adapters default para backend |
| 0002 | Event Sourcing opt-in | Accepted | ES só com ADR por serviço |
| 0003 | CQRS: DB relacional como verdade | Accepted | Read models reconstruíveis, nunca escritos diretamente |
| 0004 | Flutter Architecture | Proposed (template vazio) | Rebaixado no ciclo 01 — arquivo é template sem conteúdo Flutter |
| 0005 | Performance Activation Template | Proposed (template de ativação) | Status alinhado no ciclo 01 — template por serviço, não decisão fechada |
| 0006 | **Standalone Architecture v2.0** | **Accepted (2026-07-08)** | 7 invariantes P1-P7; raiz de dependência de quase tudo pós-2026 |
| 0007 | Compiler v2 multi-adapter | **Accepted (2026-07-08)** | AdapterContract declarativo + SDK BYOA |
| 0008 | MCP 3-tier bundles | **Accepted (2026-07-08)** | core/extended/enterprise em `.agents/mcp/` |
| 0009 | Plugin Marketplace dual-format | **Accepted (2026-07-08)** | Emissão simultânea Anthropic + Codex |
| 0010 | OTel Collector compartilhado | **Accepted (2026-07-08)** | `otel-collector-shared` em `platform-shared-dev` |
| 0011 | Módulo ADO-Ops | **Accepted** | Feature-flag `ado.enabled`; ADO-first via gate G1; agente ATLAS |
| 0012 | Sandboxing opcional | **Accepted (2026-07-08)** | Provider externo `ai-jail` (GPL não absorvido no core MIT) |
| 0013 | PR Closeout & Branch Lifecycle | **Accepted** | `hseos pr closeout --approved`; merge só com humano |
| 0014 | Telemetry Export Bridge | **Accepted** | TEE OTLP/Loki opt-in; SQLite permanece canônico |
| 0015 | dev-squad Canonical Authority | **Accepted** | 4 tiers de autoridade; Gate 7 em `quality-gates.sh` + CI |
| 0016 | **Capability Packaging** | **Accepted (2026-07-08)** | Assunto do branch atual (ver §10) |

**Nota de ratificação (ciclo 01):** a onda "Standalone v2.0" (0006-0010, 0012, 0016) foi ratificada em lote em 2026-07-08 com aprovação humana explícita — já estava implementada e enforçada em CI. 0004/0005 foram rebaixados/alinhados como templates (não são decisões fechadas). A seção `## Authority` exigida pelo ADR-0015 no dev-squad SKILL.md fonte foi adicionada, e o follow-up do ADR-0015 (promover o job `governance` a required check) foi cumprido.

---

## 5. Agentes

### 5.1 Roster (16 no manifest; 14 operacionais + ATLAS feature-flagged + HSEOS-MASTER meta)

Cada agente = `*.agent.yaml` em `.hseos/agents/` (persona, `tool_policy`, menu→workflows) + par `authority.md`/`constraints.md` em `.enterprise/agents/<code>/` (correspondência 1:1 verificada). Todos carregam as mesmas 7 "Mandatory Governance Clauses".

| Code | Título | Domínio | tool_policy | Por que existe |
|---|---|---|---|---|
| NYX | Intelligence Broker | Discovery | read-only + artifacts | Elicitação de requisitos sem inventar gaps — recebe a delegação "invent missing requirements" |
| VECTOR | Mission Architect | Planning | write-safe (docs) | PRD, escopo, épicos/stories; mudança de escopo passa por ele |
| CIPHER | Systems Architect | Solutioning | write-safe (docs) | Arquitetura e drafts de ADR; **nunca aprova ADR, só drafta** |
| PRISM | Interface Weaver | Experience | read-only + artifacts | UX/acessibilidade como fase formal, não afterthought |
| RAZOR | Sprint Commander | Coordination | write-safe (docs) | Stories/sprints; sharding de stories cross-domain |
| GHOST | Code Executor | Execution | write-safe (sem git destrutivo) | Implementação TDD; Self-Review Gate antes de handoff; "Almost passing is failing" |
| GLITCH | Chaos Engineer | Validation | write-safe | Reality Checker Mode cético; Deploy Gate de 3 aprovações (técnica=GLITCH, sistema=CIPHER/ORBIT, negócio=humano) |
| QUILL | Knowledge Scribe | Knowledge | write-safe (docs) | Documentação sem sumarização com perda; sidecar "Paige" (tech-writer) |
| ORBIT | Flow Conductor | Orchestration | write-safe (docs) | Sequencia fases, persiste run-state; **não pode avançar fase com Reality Check FAIL** |
| BLITZ | Solo Protocol | Autonomy | write-safe | Fluxo comprimido solo (1 sessão); destino de "single story sem paralelização" |
| FORGE | Release Engineer | DevOps | **admin** (confirm_before rm-rf/kubectl-delete/migration) | Publica artefatos com evidência imutável (tag/digest/SHA); 1º elo FORGE→KUBE→SABLE |
| KUBE | K8s Delivery Operator | GitOps | admin | Atualiza manifests GitOps + PR + sync ArgoCD; nunca `prune:true` em infra; 2º elo |
| SABLE | Runtime Operator | Operations | admin | Verifica rollout/health/smoke; **único auditor de governança de IA** (spend caps, FinOps); 3º elo |
| SWARM | Parallel Execution Commander | Parallel Orchestration | write-safe (sem push/merge) | Decompõe batch heterogêneo em waves worktree-isoladas; orquestra, nunca executa ops destrutivas |
| ATLAS | ADO Lifecycle | ado-orchestration | read-mostly (MCP ADO) | Tracking Azure DevOps plano→sync→close; só ativa com `ado.enabled: true` |
| HSEOS-MASTER | Meta/bootstrap | — | — | Executor raiz de tarefas genéricas do módulo `core` (não faz parte do fluxo de delivery) |

**Racional da gradação de tool_policy:** discovery/UX são read-only (só produzem artefatos); planejamento/coordenação/conhecimento escrevem docs mas não código/git; execução escreve código sem operações git destrutivas; DevOps/GitOps/Runtime têm `admin` porque tocam infraestrutura real — mas com `confirm_before` nas operações irreversíveis. A autoridade cresce junto com a proximidade de produção, e o gate humano cresce junto.

### 5.2 Fluxos

- **Standard:** NYX → VECTOR → PRISM → CIPHER → RAZOR → GHOST → GLITCH → QUILL
- **Solo Fast:** BLITZ end-to-end
- **Epic Delivery:** ORBIT → (standard) → FORGE → KUBE → SABLE → QUILL (12 fases, handoff `tag/digest/SHA → PR/sync/revision`)
- **Parallel Batch:** SWARM (plano Opus) → N subagentes Sonnet/Haiku em worktrees → SWARM (debrief)

---

## 6. Workflows

### 6.1 Registrados com contrato completo (`.hseos/workflows/registry.yaml`, 7)

| Workflow | Owner | Por que existe |
|---|---|---|
| `delivery-readiness` | ORBIT | Gate de pré-condições (repo, config, constituição, CLIs) — nenhum fluxo orquestrado começa sem validação; cada check tem `prepare:` com correção |
| `epic-delivery` | ORBIT | Pipeline completo de 12 fases com state persistido (`.hseos/data/runs/epic-<id>/state.yaml`) e gates por fase |
| `dev-squad` | SWARM | Ver §6.3 — o workflow mais elaborado |
| `release-publish` | FORGE | freeze→ci-detect→publish→verify; hard-fail sem evidência de publicação |
| `kube-deploy` | KUBE | Detecção de perfil GitOps (`kube-profile.yaml`: `centralized` ativo / `app-paired` documentado) → kustomize edit → PR → poll ArgoCD → handoff |
| `runtime-deploy` | SABLE | handoff-verify→rollout→smoke→regression; SABLE nunca re-dispara deploy, só verifica e escala |
| `state-tracking` | SWARM | Observabilidade SQLite (ver §11); "nunca bloqueia delivery por observabilidade indisponível" |
| `ado-ops` | ATLAS | Lifecycle ADO feature-flagged (exit 0 silencioso quando desligado) |

### 6.2 Fases numeradas (pipeline padrão) + auxiliares

`1-discovery/` (NYX: brief, market/domain/technical research) → `2-planning/` (VECTOR: PRD create/edit/validate; PRISM: UX/design-system/audit) → `3-solutioning/` (CIPHER: arquitetura, draft-adr, readiness; VECTOR: épicos/stories) → `4-execution/` (GHOST: dev-story com hard-fail sem testes, code-review; RAZOR: sprint, story, retro, correct-course). Auxiliares: `blitz-flow/` (+ quick-story), `knowledge/` (QUILL), `validation/` (GLITCH), `document-project`. Todos com o padrão `Intent/Owner/Phases/Output/Gates` e gates recorrentes de bloqueio ("stop se objetivo desconhecido", "escalar arquitetura para CIPHER").

**Fontes:** os workflows executáveis derivam de `src/hsm/workflows/` (23 workflows-fonte com steps detalhados) e `src/core/workflows/` (elicitação avançada, brainstorming, party-mode) — `src/core` é o motor genérico, `src/hsm` é o módulo de negócio com os 13 agentes-persona.

### 6.3 dev-squad em detalhe (ADR-0015)

Execução paralela heterogênea (3+ tasks) com **model-tiering institucionalizado**: Commander (Opus) planeja e extrai handoffs; Squad (Sonnet/Haiku) executa. 6 fases: Vault Load → Intake (`INTAKE.md`, 1 rodada de perguntas) → Study opcional (≤3 exploradores) → Plan (`PLAN.md` com wave graph; **Gate G2: aprovação humana mandatória**) → Execute (por wave: worktree por task via `worktree-manager.sh`, dispatch em UMA mensagem, handoffs ≤40 linhas **sempre escritos pelo Commander**, validate→commit→merge→remove por task, `WAVE-N-REPORT.md`) → Consolidate (PR draft; humano cria e mergeia) → Knowledge Consolidation (vault, se habilitado).

Gates G1-G5 (bypass = violação de governança). Modo **detached** (resume): após G2, `/clear` e retomada carregando SÓ `PLAN.md`+`STATUS.md`+handoffs — resolve inflação de contexto. Localização de run é SQLite-first com fallback markdown. Enforcement: `.agents/hooks/handlers/swarm-gate.sh` (PreToolUse:Agent, canônico desde o ciclo 01) bloqueia dispatch paralelo sem run ativo com PLAN aprovado.

**Por que existe:** paralelismo sem isolamento estrutural (worktrees) e sem tiering de modelo gera colisões de arquivo, custo Opus desnecessário e histórico git ilegível. O dev-squad transforma esses três riscos em contrato executável.

---

## 7. Skills (49 governadas)

### 7.1 Modelo de consumo

Registro canônico: `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md` (v1.4); mirror compilado: `.agents/skills/` (frontmatter com `source`, `sha256` no manifest). **2 tiers por skill**: `SKILL-QUICK.md` (Tier 1: trigger + checklist, default) e `SKILL.md` (Tier 2: algoritmo completo, só para análise profunda). Protocolo: registry sempre → match de trigger → Tier 1 → Tier 2 quando necessário → **sem trigger = nenhuma skill carregada**. Condições declarativas via `metadata.hseos`: `required_modes` (ex.: `gitops-deploy`/`policy-layer` exigem `admin`), `explicit_only` (`threat-modeling`, `performance-profiling` nunca auto-ativam).

**Por que o modelo de 2 tiers:** carregar a biblioteca inteira polui contexto e degrada precisão; carregar só o registro + tier 1 mantém o custo de contexto proporcional à tarefa.

### 7.2 Catálogo por categoria

**A. Governança/auditoria de código (19):** `accessibility` (WCAG 2.1 AA), `adr-compliance`, `agent-permissions` (settings.json least-privilege), `architecture-breaking-change-detection`, `architecture-ddd-boundary-check`, `commit-hygiene`, `dependency-audit` (CVE/licença/pinning), `documentation-completeness`, `enterprise-readiness-audit` (14 dimensões), `naming-conventions`, `observability-compliance`, `performance-profiling`†, `pr-review` (2 estágios + Blast Radius, padrões Trail of Bits), `release-control`, `sanitize-comments`, `secure-coding` (Confidence-Based Filtering, padrões Sentry), `security-audit-plain-language` (para stakeholders não-técnicos), `test-coverage` (thresholds por camada), `threat-modeling`† (8 passos + pausa humana). († = `explicit_only`)

**B. Processo/meta (17):** `ai-observability`, `context-compression` (12 estratégias), `context-engineering` (5 níveis), `context-policy`, `core-drift` (drift implementação × intenção arquitetural), `inter-agent-comms` (protocolo A2A), `mcp-governance`, `multi-agent-orchestration` (padrões Fan-Out/Map-Reduce/Critic Loop/HITL), `project-state`, `second-brain` (`vault_required: false`, degrada graciosamente — P6), `session-handoff`, `simplicity-first` ("Regra da Abstração": 2 exemplos concretos + 1 antecipado), `spec-driven` (Specify→Design→Tasks→Implement), `systematic-debugging` ("Lei de Ferro": nunca fix sem causa raiz; 3 tentativas → escalar), `self-verification` (verify_step embutido no design da task), `verification-before-completion` (4 gates de evidência + verificação adversarial para ≥3 arquivos).

**C. ADO (5, feature-flagged):** `ado-plan` (gate G1-ADO), `ado-ops` (CRUD via MCP, ≤10 chamadas/turno), `ado-sync` (best-effort), `ado-close-wave` (fecha Feature/Epic + tag), `ado-new-project` (único que não exige flag — é quem a ativa; migração de repo sempre com prompt explícito).

**D. GitOps (3):** `gitops-new-project`, `gitops-add-service`, `gitops-deploy` (3 variantes: genérica, `CENTRALIZED` — ativa neste ambiente via `kube-profile.yaml` — e `APP-PAIRED` para portabilidade).

**E. Orquestração/docs/pesquisa (5):** `dev-squad` (canônica via ADR-0015), `doc-project` (README bilíngue EN+PT-BR), `repo-radar` (avaliação de repos com fallback sem Axon), `rfc`, `tech-research`.

**Racional da separação em famílias:** as skills A são *checagens* (podem rodar em qualquer código); as B governam o *próprio processo do agente*; C/D são *integrações* com superfícies externas (ADO, GitOps); E são *protocolos executáveis*. O capability packaging (§10) agrupa exatamente sobre essas famílias.

---

## 8. Hooks

### 8.1 Arquitetura

**Fonte canônica (desde o ciclo 02):** `.enterprise/governance/hooks/{registry.yaml,handlers/}` — hooks e handlers editam-se AQUI. **Registro compilado:** `.agents/hooks/registry.yaml` (gerado; 28 hooks, cada um com `id/event/matcher/blocking/status/fallback`). **Handlers compilados:** `.agents/hooks/handlers/*.sh` (cópias CRLF-normalizadas da fonte, hash-pinned em `manifest.yaml handlers[]` e verificadas pelo `agent-core verify` — 23 entradas). **Adapters compilados:** `.claude/hooks.json` (consumido pelo Claude Code) e `.codex/hseos-hooks.json` (metadado de auditoria — Codex não tem primitiva de hook; o campo `fallback` prescreve replicação manual). A auto-referência input/output do registry (única violação do fluxo `.enterprise → .agents`) foi eliminada; fallback compatível preserva projetos pré-migração. Regras de autoria: idempotente, best-effort (nunca quebra), project-scoped (nunca toca `~/`, `/opt/` — P5), fail-open para integrações opcionais (P6).

**Por que registry neutro + adapters:** hooks são a camada de enforcement em tempo real; mantê-los vendor-neutral com compilação por adapter preserva a paridade P4 e permite auditar intenção mesmo em plataformas sem suporte nativo.

### 8.2 Inventário funcional (por evento)

**PreToolUse (bloqueantes):**
- `swarm-gate.sh` (Agent) — o guardião do dev-squad: roteamento de modelo (execução sem `model` → ask; Opus em execução sem opt-in → ask), dicionário de ~20 skills com sugestão, e gate SWARM (bloqueia dispatch paralelo sem run ativo).
- `claude-md-guard.sh` (Write|Edit) — nega edição direta de `CLAUDE.md`; redireciona para `AGENTS.md` (ADR-0006: CLAUDE.md é ponteiro de compatibilidade).
- `code-index-guard.sh` (Grep|Glob) — quando existe índice Axon pronto, pede confirmação e recomenda `get_context_capsule`/`get_skeleton` (economia 76-98% de tokens); escape `HSEOS_BYPASS_INDEX=1`; permite silenciosamente se não há índice (P6).
- `ado-branch-guard.sh` (Bash) — bloqueia `git push` direto para trunk branches (exit 2).
- `ado-preflight-gate.sh` (Agent) — advisory de mapeamento ADO em contexto dev-squad (não bloqueia de fato, apesar do nome).
- backup inline pré-Edit; aviso inline de comandos de alto risco; `suggest-skill.sh` (Agent, advisory) — match de frontmatter de skills contra o prompt do subagente (1-5 matches; >5 = ruído, silencia).
- Inativos opt-in: `rtk-rewrite.sh` (reescrita token-saving via RTK, `permissionDecision: allow` com comando substituído) e `build-resource-guard.sh` (cap de `-j` em make/cmake/ninja via `HSEOS_BUILD_MAX_JOBS` — materializa a diretiva de throttling §3f do AGENTS.md global).

**PostToolUse (não-bloqueantes):** auto-format (black/prettier) pós-Edit; `state-emit-hook.sh` (`*`) — emite `tool_call` para o SQLite quando há run ativo; `telemetry-export-tool.sh` (`*`) — métricas OTLP opt-in (ADR-0014; inerte sem `OTEL_EXPORTER_OTLP_ENDPOINT`); `plan-lint.sh` (Write|Edit) — em planos com ≥3 sinais de paralelismo sem seção "Execution Protocol", emite advisory (a meta-diretiva "formalização explícita" como código); `code-index-post-edit.sh` — agenda re-index Axon via `pending-writes.txt` com flock; `ado-task-progress.sh`/`ado-pr-link.sh`/`ado-tag-close.sh` (Bash) — progresso de task ADO em commit, link de PR a Story, evento de inbox para fechamento por tag.

**Ciclo de sessão:** SessionStart — banner de navegação HSEOS + emit start + `ado-inbox-check.sh`; UserPromptSubmit — `on-prompt-submit.sh` (log de prompt project-scoped + detecção de `/plan` heterogêneo → advisory SWARM, 1× por sessão); PreCompact — `pre-compact.sh` (snapshot de branch/log/status + notas do usuário antes da compactação); Stop — emit complete + `telemetry-export-session.sh` (OTLP/Loki opt-in); SessionEnd — `session-end.sh` (2 tiers: log local sempre; vault sync **só** se `second_brain.enabled`); Notification — `on-notification.sh` (notify-send→osascript→powershell→bell).

### 8.3 Hook profiles (ADR-0016)

`advisory` (warn-only, primeira instalação) · `standard` (dev default) · `strict` (governança pesada local) · `ci` (gates obrigatórios com falha). **Gates mandatórios de repositório não são desligáveis por perfil mais leve** — perfil é intenção de instalação, não bypass de política.

---

## 9. Ferramentas

### 9.1 CLI `hseos` (`tools/cli/`, Commander.js, auto-discovery de comandos)

| Grupo | Comandos | Por que existe |
|---|---|---|
| Instalação | `install` (perfis/componentes/skills/tools/RTK/dashboard/second-brain), `install-plan` (dry-run auditável), `uninstall`, `status` | Onboarding com intenção de instalação revisável (ADR-0016) |
| Núcleo compilado | `agent-core compile\|verify\|audit\|doctor` (multi-adapter via `--target`) | Compila `.enterprise`→`.agents`→adapters; self-verification de integridade/drift |
| Governança de PR | `pr closeout --approved` | Merge governado: exige aprovação humana + checks 100% verdes + branch não-protegida; cleanup restrito a `feature/*` (ADR-0013) |
| Workflow | `workflow list/validate/init/status/sync/resume/advance/batch/gate/story-*` | Motor genérico YAML-driven; checks tipados; ledger `sprint-status.yaml` |
| Estado | `state start/stop/status`, `state-emit/list/describe/render/purge/snapshot/stale-sweep` | Instrumentação SQLite sem exigir servidor MCP rodando |
| Kanban | `kanban [--watch]` (ASCII), `state-ui` (web :3200 loopback), `kanban-central` (multi-projeto :3210, registry `~/.hseos/projects.json`) | Visibilidade de runs para humanos, do terminal ao browser |
| Módulos/plugins | `plugin list/install/remove/doctor` (dual-format), `brain status/sync`, `sandbox doctor/run` (ai-jail, perfis standard/lockdown) | Extensões e integrações opt-in com degradação graciosa |

Subsistema de instalação (`tools/cli/installers/`): orquestrador de 3.8k linhas + **19 adapters de IDE** (`platform-codes.yaml`: claude-code e cursor "preferred"; handlers bespoke para codex/github-copilot/kilo/rovodev; genérico config-driven para o resto, com `ancestor_conflict_check` para evitar instalação duplicada em diretórios aninhados).

### 9.2 Servidores MCP nativos (`tools/mcp-*`)

| Server | Porta | Status | Tools | Por que existe |
|---|---|---|---|---|
| `mcp-project-state` | 3100 | **implemented** | runs/tasks/events/handoffs sobre schema `as_*` + FTS5 | Estado de execução queryável por agente ("qual agente tocou auth nos últimos 30 runs") |
| `mcp-hseos-governance` | 3101 | scaffolded | query_constitution, validate_adr, check_authority, list_skills, list_workflows | Governança consultável via MCP em vez de leitura de arquivos |
| `mcp-hseos-swarm` | 3102 | scaffolded | plan_squad, dispatch_wave, consolidate_handoff, get_run_state | Protocolo dev-squad como API (hoje opera em markdown/filesystem; integração SQLite declarada mas não implementada) |
| `mcp-axon-bridge` | 3103 | scaffolded | code_search, dep_graph, get_skeleton, get_overview, memory_search, run_pipeline | Wrapper portável do Axon com resolução de binário em 4 passos e fallback no-op (`fallback:true`) — P5/P6 |

Bundles (ADR-0008, `.agents/mcp/bundles/`): **core** (sempre: governance, state, filesystem), **extended** (opt-in: swarm, axon-bridge, sequential-thinking, fetch, memory), **enterprise** (opt-in + secrets via env: github, postgres SELECT-only, kubernetes read-mostly, sentry, azure-devops com regras operacionais embutidas — "nunca criar com State=Closed", ≤10 chamadas/turno). Ativos: `[core, extended]`.

### 9.3 Observabilidade auxiliar

- `tools/usage-dashboard/` (Python) — mineração dos JSONL do Claude Code para SQLite + dashboard de custo/uso (:8080, exposto na rede local deliberadamente).
- `tools/state-ui-server/` — kanban web SSE (loopback-only por default; `lib/snapshot.js` é a fonte única do formato, compartilhada com o kanban ASCII).
- `packages/adapter-sdk` (`@hseos/adapter-sdk` v1.0.0, scaffolded) — contrato `AdapterBase` + `checkAdapterConformance` para BYOA; Goose é o adapter de referência.
- Plugins (ADR-0009, 4): `hseos-skill-creator`, `hseos-hookify`, `hseos-pr-review` (extends toolkit oficial), `hseos-security-guidance` — emissão dual `.claude-plugin/` + `.codex-plugin/`.

### 9.4 Scripts de governança (`scripts/governance/`)

`quality-gates.sh` (8 gates: estrutura, placeholders/markdownlint, lint+testes, secrets, menções a IA, política de workflow de docs, **Gate 7 ADR-0015** — nenhum runtime path pode citar `~/.claude/skills/` como canônico) · `worktree-manager.sh` (create→validate→commit→merge→remove; o mecanismo estrutural anti-colisão do dev-squad) · `validate-commit-msg.sh` (5 regras) · `check-branch.sh` · `validate-skills.sh` (SKILL-01..06) · `apply-branch-protection.js` (aplica `.github/branch-protection.yaml` via API) · `state-emit-hook.sh` · `ado-task-from-branch.sh`.

### 9.5 Enforcement em camadas (defesa em profundidade)

1. **Tempo real** — hooks PreToolUse (swarm-gate, claude-md-guard, branch-guard, code-index-guard).
2. **Pré-commit local** — `.husky/pre-commit` (check-branch + quality-gates `--phase code`) e `.husky/commit-msg` (validate-commit-msg). *Bypassável com `--no-verify` (proibido por diretiva).*
3. **CI não-bypassável** — `ci.yaml` (matrix Node 20/22, suíte completa + job `governance` com quality-gates `--phase doc`); `standalone-smoke.yaml` (container limpo, invariantes P5/P6 por grep + testes); `release.yaml` (publish só via tag `v*` com suíte verde).
4. **Server-side** — branch protection declarativa aplicada por script (status checks obrigatórios, 1 approval, sem force-push).

**Por que 4 camadas:** cada camada cobre o bypass da anterior — hooks são contornáveis por config, husky por `--no-verify`, e só o CI + branch protection são invioláveis. O comentário no próprio `ci.yaml` explicita esse desenho.

---

## 10. Capability Packaging (ADR-0016 — o trabalho deste branch)

**Problema:** o instalador expunha seleção de módulos/tools, mas não uma forma de primeira classe de selecionar uma *superfície de capacidade* coerente — intenção de instalação difícil de auditar.

**Solução (aditiva — não substitui Constituição/gates/worktree):**

- `.agents/capabilities/components.yaml` — 18 componentes + sintéticos, em 5 famílias: `baseline:*` (3, `required:true` — governance, entrypoints, skills-registry; **irremovíveis**), `runtime:*` (4 — hooks, state, workflows, mcp), `capability:*` (11 — architecture, delivery, security, knowledge, observability, gitops, ado, sandbox, readiness, solo, verification — cada um mapeando skills reais), `adapter:*` (3), `skill:*` (sintéticos, gerados em runtime de `.agents/skills/` — ≥40; só seletores, a autoridade permanece em `.enterprise/`).
- `.agents/capabilities/profiles.yaml` — 7 perfis: `minimal` (advisory), `developer` (**default**, standard), `governance`/`gitops`/`ado` (strict), `solo` (standard), `full` (ci, único com adapter goose).
- `tools/cli/lib/capability-catalog.js` — `loadCapabilityCatalog` / `resolveCapabilityPlan` (sempre inclui `required`; valida IDs; retorna plano `{profile, hook_profile, components, modules, tools, skills, install_paths}`) / `loadAdapterMatrix` / `writeCapabilitySelection` (persiste em `.hseos/config/capability-selection.yaml`).
- CLI: `hseos install-plan --profile <id> [--json|--list-*|--adapters]` (dry-run) e `hseos install --profile/--components/--skills/--hook-profile`.
- Testes: `test/test-capability-catalog.js` (integridade referencial perfil→componente→skill, resolução, flags).

**Em uma frase:** transforma "o que eu instalo?" de lista de módulos internos em catálogo auditável de perfis/componentes/skills, com o baseline de governança impossível de desligar.

---

## 11. Estado e observabilidade

**Modelo híbrido (`state_management.mode: hybrid`):** markdown run-dir (canônico para escopo single-run: resume + revisão humana) + SQLite `.hseos/state/project.db` (canônico para cross-run/cross-project: órfãos, kanban, busca FTS5). Schema `as_*` (migrations em `mcp-project-state`): `as_runs`, `as_tasks` (wave, effort, model_tier, status com CHECK constraints), `as_agent_runs` (heartbeat, tokens, custo), `as_events` (+FTS5), `as_handoffs`, `as_sessions`, `as_wave_executions`, `as_worktree_state` (índice único parcial = claim atômico de branch entre sessões concorrentes). Lifecycle: scheduler de sweep de órfãos (5 min), archiver (markdown no vault antes de purge), snapshotter (últimos 7).

**Telemetria (ADR-0014):** TEE opt-in via 2 hooks env-gated → OTLP metrics (`claude_tool_use_total`, `claude_tool_duration_ms`) e OTLP/Loki session logs. SQLite permanece o sink canônico; zero chamadas de rede por default.

**Por que dual-write:** o markdown serve o humano e o resume detached; o SQLite serve queries que markdown não responde. A regra "observabilidade nunca bloqueia delivery" evita que a instrumentação vire ponto único de falha.

---

## 12. Estado do repositório em 2026-07-08

### 12.1 Reparos aplicados nesta análise (working tree, não commitados)

Um `git stash pop` conflitante foi commitado sem resolução nos commits de decom de 2026-06-08 (`d4ceb94` etc.), deixando **8 arquivos com marcadores de conflito no HEAD**. Todos resolvidos com base em evidência:

| Arquivo | Resolução | Evidência |
|---|---|---|
| `.claude/settings.local.json` | União das permissões dos dois lados | Ambos os lados eram allowlists já aprovadas |
| `package.json` | Lado upstream (suíte completa) | Todos os arquivos de teste referenciados existem em `test/` |
| `.claude/hooks.json` | Lado upstream (`matcher: "*"`) | Lado stashed duplicava `plan-lint.sh` já resolvido adiante e usava matcher inválido `""` — **JSON inválido desativava todos os hooks** |
| `.agents/hooks/registry.yaml` (2 blocos) | Comentários Wave 4 (stashed) | Conteúdo funcional idêntico nos dois lados |
| `.agents/skills/{ai-observability,dev-squad}/SKILL.md` | **Merge**: trigger/skip (stashed) + versão (upstream) | Upstream regrediu o schema (perdeu trigger/skip presente nas outras 47 skills) mas avançou a versão |
| `tools/cli/commands/agent-core.js` (2 blocos) | Lado upstream | Lado stashed causaria `ReferenceError: extraNote` |
| `tools/cli/installers/lib/core/agent-core-compiler.js` | Shim de 3 linhas (upstream) | Pacote modular Compiler v2 existe completo em `agent-core-compiler/` — **o conflito quebrava `hseos install`, `agent-core` e `plugin` inteiros** |

Validação: JSON/YAML/`node --check` verdes em todos; `require()` da cadeia do compiler OK; zero marcadores restantes no repo.

### 12.2 Pendências e gaps (priorizados)

**P1 — decisão/ratificação**
1. ~~ADRs 0006-0010, 0012, 0016 "Proposed"~~ ✔ **resolvido (ciclo 01, aprovação humana)**: ratificados em lote como Accepted (2026-07-08) — arquivos + `_INDEX.md`.
2. ~~ADR-0004/0005 divergentes~~ ✔ **resolvido (ciclo 01)**: 0004 rebaixado para "Proposed (empty template)"; 0005 alinhado como "Proposed (activation template)" no índice.

**P2 — drift e duplicação**
3. ~~Dois `swarm-gate.sh` coexistem~~ ✔ **resolvido (ciclo 01, aprovação humana)**: registry/adapters fiados ao handler canônico `.agents/hooks/handlers/swarm-gate.sh` (model routing + skill-check + gate dev-squad); `scripts/governance/swarm-gate.sh` removido; smoke-test 4/4 cenários; a regra "executor não herda Opus sem opt-in" agora RODA de fato.
4. ~~`platform-codes.yaml` duplicado com drift~~ ✔ **resolvido (ciclo 01)**: par raiz (`tools/platform-codes.yaml` + `tools/cli/lib/platform-codes.js`) era código morto desde o commit inicial — removido; cópia viva única em `installers/lib/ide/`.
5. `.claude/` incompleto vs spec do adapter — **hipótese parcialmente falsificada (ciclo 01)**: `agent-core compile` emite apenas `hooks.json` (e `.codex/hseos-hooks.json`); `settings.json`/`commands/`/`skills/`/`.mcp.json` são responsabilidade do `hseos install`, não do compile.
6. ~~Skills com cópias divergentes no plugin `hseos-security-guidance`~~ **hipótese falsificada (ciclo 09)**: os arquivos do plugin são *stubs de ativação* em formato de plugin (`tier: 2`, `load_strategy: trigger`, `triggers[]` plural — compatível agentskills.io; ~30 linhas), não cópias da skill canônica (~160 linhas) — divergência por design, o nome `SKILL.md` igual é que confundia. Resíduo real: a `description` dos stubs é a versão antiga da canônica; melhoria futura = derivar stubs da canônica na emissão do plugin.
7. ~~Registry de skills declara só Tier 1 para `inter-agent-comms` e `policy-layer`~~ ✔ **resolvido (ciclo 01)**: Tier 2 declarado no `SKILLS-REGISTRY.md`.
8. SQLite e run-dirs contêm dados de **outros projetos** (`cambio-real`, `ecp`, `design-system-*`) — confirmar se o uso cross-projeto é intencional ou drift.

**P3 — documentação**
9. ~~README badges/contagens/comandos~~ ✔ **parcialmente resolvido (ciclo 01)**: badges 16/49, roster +ATLAS, 4 servers MCP, comandos fantasma corrigidos (`hseos validate`→`status`; `verify`→`agent-core verify`), paths `tools/mcp-*/index.js`. Pendentes: `docs/getting-started.md`; `docs/skills.md` cobre ~29 de 49 skills.
10. ~~ATLAS ausente do `AGENT-MANIFEST.md`~~ ✔ **resolvido (ciclo 01)**: entrada ATLAS adicionada a `.hseos/AGENT-MANIFEST.md`; também criados `docs/agents/atlas.md` + linhas de roster/authority em `docs/agents/README.md`.
11. `docs/sandbox.md` e `docs/ado-ops/` órfãos de navegação (não linkados nos READMEs).
12. `shared-infrastructure.md` documenta hostname Keycloak legado (pré-diretiva 3e de 2026-06-25).
13. ~~Gap de doc para capability packaging~~ ✔ **resolvido (ciclo 01)**: `docs/capabilities.md` criado (perfis, componentes, pré-requisitos, extras opt-in) + linkado em `docs/README.md` e no README principal (seção "capability profile" na instalação). Espelho PT-BR permanece pendente. Bônus da mesma rodada: 7 skills órfãs de família ganharam lar no catálogo (+`capability:research`), campo `prerequisites:` adicionado aos componentes com dependência externa (ADO, sandbox, gitops, telemetria, MCP, second-brain, research), `install-plan` exibe pré-requisitos, perfil `full` completado (faltavam readiness/solo/research), e teste de invariante impede skills órfãs futuras (22/22).

**P4 — higiene**
14. ~~Testes órfãos de CI~~ ✔ **resolvido (ciclo 01)**: 8 testes promovidos ao `npm test` (incl. `test-mcp-agent-state.js`, que faltava nesta lista); `test-state-purge.js` tinha 2 defeitos reais de apodrecimento (replay de migrations sem `user_version` + asserção incorreta) — corrigidos, purge CLI confirmado correto.
15. ~~`.claude/settings.local.json` versionado~~ ✔ **resolvido (ciclo 01)**: untracked + gitignored.
16. ~~Diretório órfão `.enterprise/constitution/`~~ ✔ **resolvido (ciclo 01)**: removido (README-esqueleto que se autodeclarava autoridade constitucional); `governance-checklist.md` corrigido para `.specs/constitution/`. Pendentes: maquinaria de Replay Mode instrumentada mas nunca usada; registro de exceções vazio (positivo).
17. ~~Bugs conhecidos não corrigidos~~ **atualizado (ciclo 01, verificação dos mapeadores)**: dos 3 bugs de `worktree-manager.sh` do WAVE-1-REPORT, #1 (checkout no repo principal) e #3 (tipo de merge inválido) **já estavam corrigidos** no código atual; só #2 segue real (`gate_code` decide rodar por staged files mas linta o repo inteiro). `xml-handler.js#injectActivationSimple` (ReferenceError, chamado por `_base-ide.js:508`) ✔ **corrigido no ciclo 01** (método removido + call site limpo).
18. Índice Axon stale (2026-05-25) com `sync-requested` pendente.

### 12.3 Ciclo 01 do goal "Evolução contínua" (2026-07-08) — resumo

Relatório completo: `docs/goals/reports/2026-07-08-ciclo-01.md`. Além das resoluções marcadas acima:

- **Integridade hash restaurada**: `agent-core verify` saiu de 42 erros para **65/65 verde**. Causa raiz: o compiler modular pós-decom deixou de emitir `trigger`/`skip` (schema Wave 4), e o manifest ficou para trás dos artefatos. Correção: 42 pares `trigger`/`skip` resgatados do HEAD e **movidos para a fonte canônica** (`.enterprise/.../SKILL.md` frontmatter — o `normalizeSkill` faz passthrough de chaves não-geradas), recompile escopado (`--target claude-code,codex`) e manifest regenerado. 7 skills nunca tiveram trigger/skip → autoria futura.
- **Reparo de 2026-07-08 validado duas vezes**: suíte completa verde E `.claude/hooks.json` regenerado pelo compiler byte-idêntico à resolução manual do conflito.
- **Gates determinísticos**: eslint agora ignora `.logs/` (lint local ≠ CI eliminado); `prettier-plugin-packagejson` instalado (config referenciava plugin ausente — `format:*` quebrados em checkout limpo); `.prettierignore` criado (árvores geradas fora do prettier — evita guerra compile↔prettier); backlog de 84 arquivos formatado.
- **Registry de hooks autodocumentado**: compiler emite cabeçalho com a semântica de `status` (só `active`/omitido vai a adapters) — comentários manuais no registry são destruídos no round-trip (o registry é input E output do compiler, único ponto de auto-referência do fluxo fonte→compilado; mover a fonte para `.enterprise/` é candidato do ciclo 02).
- **Benchmark**: SKILL.md é padrão aberto (AAIF/Linux Foundation, 32+ ferramentas) — HSEOS compatível/aditivo; MCP RC 2026-07-28 (stateless core, caching, extensions) — planejar upgrade dos 4 servers nativos pós-GA.
- **Rodada 2 (6 mapeadores em paralelo)**: bug ativo `xml-handler.js` corrigido; transporte MCP async-safe; declaração `transport: stdio` do axon-bridge corrigida para `http` (implementação nunca lê stdin); bundles/READMEs `scaffolded→implemented`; job `governance` promovido a required check em `branch-protection.yaml` (aplicar via `npm run branch-protection:apply`); 6 `authority.md` com paths `/specs/...` insatisfazíveis corrigidos; `enterprise-readiness-audit` registrada no SKILLS-REGISTRY; ATLAS no `AGENT-MANIFEST.md`; frontmatter duplicado do core-drift dedupado. Gaps novos priorizados no relatório do ciclo (§Gaps adicionais): gates de segurança ausentes do CI, estado dual dev-squad (markdown×SQLite), goose/plugins-emit desconectados, standards-adoption-metrics aspiracional, replay-mode falso-positivo, 3 algoritmos de idempotência no installer.

### 12.4 Ciclos 02–09 do goal "Evolução contínua" (2026-07-08/09) — consolidação

Relatórios completos em `docs/goals/reports/2026-07-08-ciclo-0{2..9}.md`. Resumo do que mudou sobre esta spec:

- **Ciclo 02 — hooks fonte única**: fonte canônica movida para `.enterprise/governance/hooks/{registry.yaml,handlers/}` (auto-referência input/output eliminada — atualiza o §8.1); handlers hash-pinned no manifest (`verify` 65→**88 checks**); 11 testes de comportamento p/ hooks bloqueantes (`test-blocking-hooks.js`).
- **Ciclo 03 — enforcement**: `gate_security` era **no-op desde a origem** (brace-glob que o grep não expande) — reescrito com `git grep` sobre rastreados; nova fase `--phase ci` (job `governance` roda com `fetch-depth: 0`); higiene de mensagens (HEAD bloqueante, range advisory); estado dual dev-squad DECIDIDO pela canonicity policy (mcp-hseos-swarm é filesystem-by-design; `run-state-dal.js` morto removido); 49/49 skills com `trigger`/`skip`.
- **Ciclo 04 — manifest verdadeiro**: `adapters{}`/`platforms` derivados do realmente emitido (atualiza o risco #2 do §9); `--target` sem emissor é erro explícito; **GooseAdapter fiado ao dispatch** (`--target goose` emite `.goose/` completo — atualiza "goose órfão").
- **Ciclo 05 — audit triangular**: `agent-core audit` deixou de ser clone do `verify` — triangula fonte×compilado×manifest com vereditos direcionais e remédio (114 checks; fecha o gap V3).
- **Ciclo 06 — idempotência única**: `FileOps.syncFileSafe` content-addressed substitui os 3 algoritmos (mtime abolido — o antigo clobberava edições após checkout); `updateCore`/`syncModule` preservam e reportam; 14 testes.
- **Ciclo 07 — extras auditáveis**: família `extra:*` no catálogo (rtk/usage-dashboard/second-brain/git-hooks) com prerequisites (RTK declara o patch global no plano); seleção ativa flag; opt-in puro como invariante testado (29/29).
- **Ciclo 08 — MCP contratado**: `MCP_PROTOCOL_VERSION` centralizado em `tools/lib/mcp-protocol.js`; teste de contrato runtime dos 4 servers (21 asserções); RFC pós-GA em `docs/rfc/2026-07-09-mcp-post-ga-conformance.md` (recomendação B com gatilho C).
- **Ciclo 09 — consolidação**: P2.6 falsificada (stubs de plugin por design); esta seção; sumário executivo do PR em `docs/goals/PR-SUMMARY-capability-packaging-v1.md`.

**Permanece aberto** (decisão humana ou ciclos futuros): ratificar RFC MCP como ADR; plugins-emit (ADR-0009) não-fiado; `enforce_admins: true`; merge `task/stacked-branch-policy` (ADR-0017, desbloqueado); replay-mode.active falso-positivo; `standards-adoption-metrics` aspiracional; RTK×P5 (visível no plano desde o ciclo 07); `docs/skills.md` ~29/49; espelho PT-BR de `docs/capabilities.md`; SQLite com dados de outros projetos (#8); índice Axon stale (#18); `update`/`updateCore` consumirem `files-manifest.csv` como `recordedHash`; testes dedicados dos worktree-manager bugs (#17 → só Bug #2 do WAVE-1 segue real — escopo do lint no gate_code).

---

*Documento vivo. Quando promovido a documentação oficial, gerar a versão EN em `docs/` e linkar em `docs/README.md`, conforme CONTRIBUTING (§Documentation).*
