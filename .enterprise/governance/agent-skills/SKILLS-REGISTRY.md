---
type: skill-registry
version: "1.3"
---

# Agent Skills Registry

> Read this file FIRST — always — before any task.
> Match triggers → load the minimum skill tier needed.
> Never load all skills simultaneously.

---

## Loading Protocol

1. Read this registry (always, low cost)
2. Match the current task context against triggers below
3. Load **Tier 1 (SKILL-QUICK.md)** — default for active development tasks
4. Load **Tier 2 (SKILL.md)** — only for deep analysis, violation fixing, or formal review gates
5. If no trigger matches → no skill loaded

---

## Registered Skills

### commit-hygiene
**Description:** Enforce commit message hygiene — no co-authorship trailers, no AI tool names. Uses whole-word matching only; technical terms like "domain", "email", "cursor" (DB) are never flagged.
**Load when:** creating or amending a commit, generating PR title/body, generating changelog or release notes. Also load when validating any existing commit for compliance.
**Triggers:** `commit`, `amend`, `PR title`, `PR body`, `changelog`, `release notes`, `Co-authored-by`, `AI mention`, `HSEOS mention`, `Claude mention`
**Tier 1:** `.enterprise/governance/agent-skills/commit-hygiene/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/commit-hygiene/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = low
**Critical:** Matching is ALWAYS whole-word (`\b`). Substring matches are a hard bug. "domain" contains "ai" but is NOT a violation.

---

### sanitize-comments
**Description:** Remove methodology references (FR, NFR, Story, Epic, Sprint) and AI-attribution phrases from source code comments without touching executable code.
**Load when:** cleaning comments before commit; reviewing a PR for compliance; preparing code for open-source or client delivery; auditing for AI attribution in codebase.
**Triggers:** `sanitize comments`, `clean comments`, `remove FR reference`, `remove story reference`, `AI attribution in code`, `comment hygiene`, `open-source prep`, `client delivery`
**Tier 1:** `.enterprise/governance/agent-skills/sanitize-comments/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/sanitize-comments/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium
**Critical:** Matching is ALWAYS whole-word. Zero executable code changes allowed.

---

### ddd-boundary-check
**Description:** Validate DDD boundaries — layer direction, bounded context isolation, domain purity.
**Load when:** PR or diff touches `domain/`, `application/`, `infrastructure/`, `api/`, `services/`; new modules; cross-module imports; contracts or ORM mappings changed.
**Triggers:** `domain`, `application`, `infrastructure`, `bounded context`, `aggregate`, `repository`, `ORM`, `cross-module`, `import`, `event contract`, `integration event`, `persistence`
**Tier 1:** `.enterprise/governance/agent-skills/architecture/ddd-boundary-check/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/architecture/ddd-boundary-check/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### breaking-change-detection
**Description:** Detect breaking changes in API, event, DTO, and contract diffs.
**Load when:** PR modifies HTTP endpoints, event schemas, DTOs, shared contracts, gRPC definitions, or Protocol Buffer schemas.
**Triggers:** `API change`, `endpoint removed`, `field removed`, `field renamed`, `type changed`, `enum value removed`, `contract change`, `event schema`, `OpenAPI`, `proto`, `breaking`
**Tier 1:** `.enterprise/governance/agent-skills/architecture/breaking-change-detection/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/architecture/breaking-change-detection/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### release-control
**Description:** Release governance — changelog discipline, risk classification, rollout requirements.
**Load when:** preparing a release, creating a release branch or tag, updating CHANGELOG, promoting to production, writing a hotfix.
**Triggers:** `release`, `version bump`, `semver`, `CHANGELOG`, `hotfix`, `production deploy`, `release branch`, `release tag`, `breaking change announcement`
**Tier 1:** `.enterprise/governance/agent-skills/release-control/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/release-control/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### secure-coding
**Description:** Secure coding guardrails for auth, crypto, secrets, input validation, and PII.
**Load when:** changes touch authentication, authorization, tokens, cryptography, secrets, PII, new endpoints, input validation, or new dependencies.
**Triggers:** `auth`, `token`, `JWT`, `OAuth`, `secret`, `password`, `crypto`, `encrypt`, `hash`, `PII`, `AllowAnonymous`, `new endpoint`, `dependency`, `SQL`, `injection`, `input validation`, `RBAC`, `permission`
**Tier 1:** `.enterprise/governance/agent-skills/secure-coding/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/secure-coding/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### pr-review
**Description:** Enforce PR review standards — quality gates, boundary evidence, contract safety, and governance compliance.
**Load when:** performing or generating a pull request review, validating a PR is ready to merge.
**Triggers:** `pull request`, `PR review`, `code review`, `merge request`, `ready to merge`, `review checklist`
**Tier 1:** `.enterprise/governance/agent-skills/pr-review/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/pr-review/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### adr-compliance
**Description:** Validate ADR format, completeness, approval status, and linkage to affected standards.
**Load when:** creating, reviewing, or referencing an ADR; validating a change that requires an ADR has one.
**Triggers:** `ADR`, `Architecture Decision Record`, `architectural change`, `deviation`, `exception`, `decision record`, `approved ADR`
**Tier 1:** `.enterprise/governance/agent-skills/adr-compliance/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/adr-compliance/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### naming-conventions
**Description:** Validate code naming against stack profiles and semantic rules.
**Load when:** generating new code artifacts or reviewing naming in any stack (C#, Dart, TypeScript, Java, Go, PHP, C++).
**Triggers:** `class name`, `method name`, `variable name`, `file name`, `naming review`, `naming convention`, `new class`, `new function`, `new module`, `identifier`
**Tier 1:** `.enterprise/governance/agent-skills/naming-conventions/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/naming-conventions/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### documentation-completeness
**Description:** Validate documentation coverage for public code, APIs, architecture, and decision records.
**Load when:** PR introduces new public code, new API endpoints, or new services; auditing doc coverage.
**Triggers:** `public API`, `new class`, `new function`, `exported component`, `OpenAPI`, `Swagger`, `doc comment`, `XML doc`, `DartDoc`, `TSDoc`, `Javadoc`, `missing documentation`
**Tier 1:** `.enterprise/governance/agent-skills/documentation-completeness/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/documentation-completeness/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### dependency-audit
**Description:** Review new or upgraded dependencies for security, license compliance, and pinning.
**Load when:** PR adds or upgrades a third-party package, changes a lockfile, or introduces a new transitive dependency.
**Triggers:** `new dependency`, `npm install`, `nuget add`, `pub add`, `go get`, `pip install`, `composer require`, `package added`, `lockfile changed`, `dependency upgrade`
**Tier 1:** `.enterprise/governance/agent-skills/dependency-audit/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/dependency-audit/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### test-coverage
**Description:** Validate test coverage adequacy, test pyramid compliance, and test quality.
**Load when:** PR introduces new business logic, use cases, or domain rules; reviewing test adequacy; generating tests.
**Triggers:** `test`, `unit test`, `integration test`, `coverage`, `test suite`, `missing tests`, `test strategy`, `test pyramid`, `no tests`
**Tier 1:** `.enterprise/governance/agent-skills/test-coverage/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/test-coverage/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### observability-compliance
**Description:** Validate structured logging, metrics, tracing, and alerting requirements.
**Load when:** PR adds new service operations, endpoints, background jobs, or event consumers; generating telemetry code.
**Triggers:** `log`, `logger`, `metric`, `trace`, `span`, `telemetry`, `correlationId`, `traceId`, `observability`, `monitoring`, `new endpoint`, `new consumer`, `background job`
**Tier 1:** `.enterprise/governance/agent-skills/observability-compliance/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/observability-compliance/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### spec-driven
**Description:** Structured 4-phase workflow for planning features and services — Specify, Design, Tasks, Implement.
**Load when:** starting a new feature, service, or significant change; breaking down complex work into tasks.
**Triggers:** `new feature`, `new service`, `planning`, `specification`, `requirements`, `user story`, `breakdown`, `task list`, `feature spec`, `design doc`
**Tier 1:** `.enterprise/governance/agent-skills/spec-driven/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/spec-driven/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### accessibility
**Description:** WCAG 2.1 compliance for Flutter and React Native — screen readers, touch targets, contrast.
**Load when:** building or reviewing UI components, screens, or interactive flows in Flutter or React Native.
**Triggers:** `Flutter widget`, `React Native component`, `screen reader`, `VoiceOver`, `TalkBack`, `accessibility`, `a11y`, `WCAG`, `contrast`, `touch target`, `semantic label`, `accessibilityLabel`
**Tier 1:** `.enterprise/governance/agent-skills/accessibility/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/accessibility/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### performance-profiling
**Description:** Hot path review — zero-alloc validation, lock-free pattern audit, cache layout, and benchmark regression gates. Only applies to services that have adopted the Performance Engineering Standard via ADR.
**Load when:** PR touches hot path code, benchmarks, lock-free data structures, memory pools, serialization on critical paths, or performance-sensitive services.
**Triggers:** `hot path`, `zero alloc`, `lock-free`, `SPSC`, `MPSC`, `MPMC`, `ring buffer`, `benchmark`, `allocs/op`, `ns/op`, `cache line`, `false sharing`, `SoA`, `AoS`, `sync.Pool`, `object pool`, `arena`, `performance regression`, `latency`, `throughput`, `pprof`, `flamegraph`, `JMH`, `heaptrack`
**Tier 1:** `.enterprise/governance/agent-skills/performance-profiling/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/performance-profiling/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = high
**Note:** Opt-in — only load if service has an active Performance Engineering ADR.

---

### agent-permissions
**Description:** Analyze repository structure to generate a least-privilege `.claude/settings.json` — read-only commands only, stack-aware, package-manager-exclusive. Never allows state-modifying commands, absolute paths, or custom scripts.
**Load when:** Setting up Claude Code for a new project; auditing existing `.claude/settings.json` for over-permission; after running `/setup` Mode B.
**Triggers:** `settings.json`, `claude permissions`, `agent permissions`, `settings audit`, `least privilege`, `.claude/settings`, `what permissions`, `claude setup`, `new project permissions`
**Tier 1:** `.enterprise/governance/agent-skills/agent-permissions/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/agent-permissions/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### threat-modeling
**Description:** Repository-grounded threat modeling — enumerates trust boundaries, assets, attacker capabilities, abuse paths, and mitigations from actual code evidence. 8-step workflow with mandatory user validation pause at Step 6.
**Load when:** User explicitly requests threat modeling, AppSec analysis, or abuse path enumeration. NOT for general security reviews, PR review, or architecture discussions.
**Triggers:** `threat model`, `threat modeling`, `AppSec`, `application security`, `abuse path`, `attack surface`, `attacker model`, `trust boundary`, `security assessment`
**Tier 1:** `.enterprise/governance/agent-skills/threat-modeling/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/threat-modeling/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = high
**Note:** Explicit request only — never auto-load for general security or architecture reviews.

---

### gitops-deploy
**Description:** Atualiza image tags no repositório GitOps para deploy de serviços no Kubernetes. Suporta dois modelos: `centralized` (monorepo, ex: platform-gitops) e `app-paired` (repo por aplicação). Detecta perfil automaticamente via `.hseos/config/kube-profile.yaml` ou estrutura do repo. Faz bump de tag no kustomization.yaml, valida, cria branch e commit seguindo governança GitOps.
**Load when:** usuário pede deploy, publicação, bump de imagem ou promoção de versão para qualquer ambiente Kubernetes.
**Triggers:** `deploy`, `publicar`, `publique`, `sobe no k8s`, `bump de imagem`, `bump de tag`, `atualizar tag`, `promover versão`, `promover imagem`, `lançar versão`, `fazer release`, `colocar no ar`, `nova versão`, `rollout`, `nova imagem`, `mandar pro cluster`, `mandar pra produção`, `publish`, `image tag`, `kustomization`, `newTag`
**Tier 1:** `.enterprise/governance/agent-skills/gitops-deploy/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/gitops-deploy/SKILL.md`
**Model-specific Tier 1:**
  - Centralized: `.enterprise/governance/agent-skills/gitops-deploy/SKILL-CENTRALIZED.md`
  - App-paired: `.enterprise/governance/agent-skills/gitops-deploy/SKILL-APP-PAIRED.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### gitops-add-service
**Description:** Adiciona novo serviço (Deployment + Service + ConfigMap) a um projeto existente no platform-gitops. Cria manifests no base, atualiza todos os overlays dev/hmg/stg/prod, valida e commita em branch de feature.
**Load when:** usuário quer adicionar um novo serviço, worker, microsserviço ou deployment a um projeto já existente no Kubernetes.
**Triggers:** `adicionar serviço`, `novo serviço`, `novo deployment`, `novo worker`, `novo microsserviço`, `novo microserviço`, `criar manifests`, `criar yaml k8s`, `novo container`, `novo pod`, `subir novo serviço`, `criar deployment`, `add service`, `new service`, `new deployment`
**Tier 1:** `.enterprise/governance/agent-skills/gitops-add-service/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/gitops-add-service/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### gitops-new-project
**Description:** Cria estrutura GitOps completa para novo projeto no platform-gitops — namespaces, infra (StatefulSets), services (Deployments), overlays para todos os ambientes, ArgoCD Applications e AppProject, e bootstrap script.
**Load when:** usuário quer criar um projeto completamente novo no Kubernetes / GitOps, sem estrutura prévia no platform-gitops.
**Triggers:** `novo projeto`, `novo projeto no k8s`, `criar projeto`, `bootstrapar projeto`, `bootstrap k8s`, `onboarding k8s`, `scaffoldar projeto`, `scaffold projeto`, `registrar projeto no argocd`, `adicionar projeto ao gitops`, `iniciar projeto no kubernetes`, `subir projeto do zero`, `criar estrutura gitops`, `new project`, `bootstrap project`, `scaffold project`
**Tier 1:** `.enterprise/governance/agent-skills/gitops-new-project/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/gitops-new-project/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium

---

### inter-agent-comms
**Description:** Protocolos de comunicação entre agentes HSEOS — sequential hand-off via shared state, e real-time coordination via claude-peers MCP. Cobre tipos de mensagem, timeouts, e constraints de segurança para comunicação cross-session.
**Load when:** ORBIT coordenando múltiplas sessões ativas; planejando hand-off entre agentes; verificando disponibilidade de claude-peers; estruturando mensagens cross-session.
**Triggers:** `inter-agent`, `cross-session`, `hand-off`, `agent coordination`, `claude-peers`, `peer session`, `ORBIT coordenando`, `workflow state`, `phase output`, `gate request`, `A2A`
**Tier 1:** `.enterprise/governance/agent-skills/inter-agent-comms/SKILL-QUICK.md`
**Cost:** Tier 1 = low

---

### policy-layer
**Description:** Governança da camada de política para agentes de IA — spend caps, rate limits, tool access por papel, tool hiding, e audit trail. SABLE é o agente responsável por auditar e recomendar configurações de policy layer.
**Load when:** SABLE auditando governança de IA; configurando permissões de agentes; investigando acesso não autorizado a ferramentas; revisando spend ou rate limits.
**Triggers:** `policy layer`, `spend cap`, `rate limit`, `tool access`, `tool hiding`, `audit trail`, `agent permissions`, `least privilege agente`, `governança IA`, `acesso ferramentas`, `policylayer`, `SABLE audit`
**Tier 1:** `.enterprise/governance/agent-skills/policy-layer/SKILL-QUICK.md`
**Cost:** Tier 1 = low
**Owner:** SABLE

---

### multi-agent-orchestration
**Description:** Padrões formais de orquestração multi-agente para ORBIT — Sequential Chain, Parallel Fan-Out, Map-Reduce, Critic Loop, Routing, Human-in-the-Loop. Cobre seleção de padrão, gate conditions, memória de estado, exception handling e inter-agent communication.
**Load when:** ORBIT iniciando ou planejando um workflow multi-agente; decidindo padrão de orquestração; implementando fan-out, critic loop, ou routing entre agentes.
**Triggers:** `ORBIT`, `workflow orchestration`, `multi-agent`, `fan-out`, `critic loop`, `map-reduce`, `routing agente`, `parallel agents`, `sequential chain`, `human-in-the-loop`, `gate condition`, `delivery flow`, `agente coordenador`
**Tier 1:** `.enterprise/governance/agent-skills/multi-agent-orchestration/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/multi-agent-orchestration/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium
**Critical:** ORBIT coordina autoridade — não a absorve. Todo workflow deve declarar prerequisites, outputs e stop conditions antes de iniciar.

---

### mcp-governance
**Description:** Governa o uso de MCP servers — hierarquia de seleção de tools (MCP first), orçamento de chamadas, rate limits, caching de sessão e política de escalação. Aplica-se a todos os agentes que usam ferramentas externas.
**Load when:** iniciando qualquer workflow com múltiplas chamadas MCP; decidindo qual tool usar (MCP vs CLI vs curl); atingindo rate limits; executando operações write em lote.
**Triggers:** `MCP`, `tool selection`, `rate limit`, `429`, `API call`, `spend`, `throttle`, `kubectl vs MCP`, `gh vs MCP`, `chamadas MCP`, `budget de chamadas`, `loop MCP`, `parallel calls`
**Tier 1:** `.enterprise/governance/agent-skills/mcp-governance/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/mcp-governance/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = low
**Critical:** MCP sempre tem precedência sobre CLI equivalente. Violação = usar `gh` quando `mcp__github__*` cobre a operação.

---

## Decision Table

| Task context | Skills to load | Tier |
|---|---|---|
| Writing or amending a commit | commit-hygiene | 1 |
| Generating PR title / changelog | commit-hygiene | 1 |
| Validating existing commit for compliance | commit-hygiene | 2 |
| Cleaning source comments before commit | sanitize-comments | 1 |
| Auditing codebase for AI attribution | sanitize-comments | 2 |
| Preparing code for open-source / client delivery | sanitize-comments | 2 |
| PR review (any) | pr-review | 1 |
| PR touches domain/ or application/ | ddd-boundary-check | 1 |
| PR touches infrastructure/ or ORM | ddd-boundary-check | 1 |
| PR modifies API / event / DTO | breaking-change-detection | 1 |
| PR touches auth, tokens, secrets | secure-coding | 1 |
| PR adds new endpoint or dependency | secure-coding + dependency-audit | 1 |
| PR adds new public code | documentation-completeness | 1 |
| PR adds new business logic | test-coverage | 1 |
| PR adds logs / metrics / new ops | observability-compliance | 1 |
| PR adds Flutter / RN UI component | accessibility | 1 |
| PR touches hot path / benchmark (perf service) | performance-profiling | 1 |
| Performance regression investigation | performance-profiling | 2 |
| Preparing release / CHANGELOG | release-control | 1 |
| Generating / reviewing an ADR | adr-compliance | 1 |
| New naming review or code gen | naming-conventions | 1 |
| Starting new feature or service | spec-driven | 1 |
| Setting up .claude/settings.json for a project | agent-permissions | 1 |
| Auditing existing Claude Code permissions | agent-permissions | 2 |
| User explicitly requests threat model / AppSec | threat-modeling | 1 |
| Full threat model generation and output | threat-modeling | 2 |
| Fixing a DDD violation | ddd-boundary-check | 2 |
| Formal architectural PR review | ddd-boundary-check + pr-review | 2 |
| Security audit of a module | secure-coding | 2 |
| Release governance review | release-control | 2 |
| ADR format review / generation | adr-compliance | 2 |
| Test adequacy audit | test-coverage | 2 |
| Full observability audit | observability-compliance | 2 |
| General coding (no trigger match) | none | — |
| ORBIT planning or executing a multi-agent workflow | multi-agent-orchestration | 1 |
| ORBIT coordinating cross-session agent hand-offs | inter-agent-comms | 1 |
| Auditing agent tool permissions or spend controls | policy-layer | 1 |
| Agent requests access outside its defined tool matrix | policy-layer | 1 |
| Deciding orchestration pattern (fan-out vs chain vs critic loop) | multi-agent-orchestration | 2 |
| Deciding which tool to call (MCP vs CLI vs curl) | mcp-governance | 1 |
| Multi-step workflow with > 5 MCP calls | mcp-governance | 1 |
| Rate limit hit during MCP workflow | mcp-governance | 2 |
| Bulk write operations via MCP (> 3 resources) | mcp-governance | 2 |
| Deploy / publicar / bump de imagem no k8s (qualquer modelo) | gitops-deploy | 1 |
| Deploy em monorepo centralizado (platform-gitops) | gitops-deploy → SKILL-CENTRALIZED | 1 |
| Deploy em repo por aplicação (app-paired) | gitops-deploy → SKILL-APP-PAIRED | 1 |
| Manifests não existem ao tentar deploy | gitops-deploy (redireciona) → gitops-new-project ou gitops-add-service | 1 |
| Adicionar novo serviço a projeto k8s existente | gitops-add-service | 1 |
| Criar novo projeto no Kubernetes / GitOps | gitops-new-project | 1 |

---

## Multi-Skill Loading

Multiple skills may be triggered simultaneously. Load each at Tier 1 first.
Upgrade to Tier 2 only the skill requiring deep analysis.

**Example:** PR that modifies infrastructure/ AND adds a new endpoint AND changes a DTO:
→ `ddd-boundary-check` Tier 1 + `breaking-change-detection` Tier 1 + `secure-coding` Tier 1

---

## Adding New Skills

1. Create `SKILL-QUICK.md` (Tier 1) + `SKILL.md` (Tier 2) in appropriate folder
2. Add registry entry here (description, triggers, paths, cost)
3. Update Decision Table
4. A skill without a registry entry MUST NOT be used by agents
