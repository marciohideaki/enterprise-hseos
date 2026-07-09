---
name: enterprise-readiness-audit
description: "Use when performing a full enterprise-readiness, production-readiness, architecture modernization, or POC-to-enterprise audit of a repository"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
trigger: "user asks for a full enterprise-readiness, production-readiness, architecture modernization, or POC-to-enterprise audit of a repository"
skip: "a single-dimension check is enough (use the specific skill: secure-coding, test-coverage, accessibility, dependency-audit); user wants a quick opinion, not a formal 14-dimension audit"
---

# Enterprise Readiness Audit

## Purpose

Use this skill to assess whether a repository can evolve from prototype, POC, MVP, or initial product into a robust enterprise-grade solution. The audit must be repository-grounded, stack-aware, evidence-based, and informed by current official guidance and market practices.

## 0. Audit Guardrails

- Start in **read-only mode**. Do not change code, config, infrastructure, lockfiles, migrations, docs, or dependencies during the audit.
- Prefer incremental modernization. Do not recommend a full rewrite unless evidence shows incremental evolution is unsafe, uneconomic, or technically blocked.
- Do not infer maturity from architecture labels alone. Clean Architecture, DDD, Hexagonal, microservices, Kubernetes, or event-driven naming are not evidence of quality by themselves.
- Separate:
  - `verified fact`: directly observed in files or command output
  - `technical inference`: reasoned from observed evidence
  - `hypothesis`: plausible but not verified
- If evidence is missing, state `no evidence found` instead of assuming quality or failure.
- If report artifacts are requested, generate Markdown as the source artifact and HTML as a derived artifact. Do not include secrets or sensitive values.

## 1. Intake Context

Capture these inputs if available. If missing, continue with explicit assumptions:

| Context | Required Handling |
|---|---|
| Target environment | local, dev, staging, production, regulated, unknown |
| Users and tenants | single user, internal team, B2B, multi-tenant, unknown |
| Sensitive data | PII, financial, health, credentials, business confidential, unknown |
| SLA/SLO | stated targets or unknown |
| Team model | solo, small team, multi-team, outsourced, unknown |
| Delivery pressure | prototype, demo, pilot, production launch, scale-up, unknown |
| Compliance needs | SOC2, ISO, LGPD/GDPR, PCI, HIPAA, other, none/unknown |

## 2. Repository Investigation Protocol

Run this sequence before scoring:

1. Inventory repository shape:
   - language/runtime/package manager
   - source directories and architectural boundaries
   - entrypoints, APIs, UI apps, jobs, workers, consumers, CLIs
   - tests, docs, scripts, CI/CD, Docker, Kubernetes/GitOps, IaC
2. Identify stack and execution model:
   - framework versions from manifests and lockfiles
   - database and persistence technology
   - auth/authz components
   - external integrations and messaging
3. Inspect operational readiness:
   - config/env handling
   - health/readiness/liveness
   - logs, metrics, traces, alerts, runbooks
   - release, rollback, migrations, feature flags
4. Inspect quality readiness:
   - lint/format gates
   - unit/integration/e2e/contract/security/load tests
   - quality gates in CI
   - coverage meaning, not just coverage number
5. Inspect security readiness:
   - auth and authorization paths
   - secrets handling
   - dependency vulnerability posture
   - CORS, rate limits, input validation, injection risks
   - sensitive data exposure in logs/errors/config
6. Only after the inventory, classify maturity and generate findings.

Useful read-only commands, adapted to the stack:

```bash
git status --short
find . -maxdepth 3 -type f | sort
rg --files -g '!*node_modules*' -g '!*.lock' | sed -n '1,200p'
rg -n "TODO|FIXME|HACK|password|secret|token|AllowAnonymous|cors|health|ready|trace|metric|TODO" .
```

Do not run commands that mutate tracked files. Test/build commands are allowed only when they do not rewrite tracked files.

## 3. Mandatory Internet Research

After identifying the stack and solution type, research current best practices using the internet. Prefer primary sources first, then market evidence.

### 3.1 Official Sources

Use only relevant sources for the project context:

| Concern | Preferred Sources |
|---|---|
| Secure SDLC | NIST SSDF SP 800-218, OWASP SAMM |
| Application security | OWASP ASVS, OWASP Top 10, framework security docs |
| Cloud-native architecture | CNCF guides, Kubernetes docs, cloud provider architecture centers |
| Operability | OpenTelemetry docs, Google SRE books, Prometheus/Grafana docs |
| Delivery performance | DORA / Google Cloud research |
| App configuration | Twelve-Factor App, platform docs |
| Stack-specific practice | Official framework/runtime docs and migration guides |

### 3.2 Market Practice

Complement official guidance with current practice only when it improves the recommendation:

- recent framework release notes or migration guides
- vendor advisories and security bulletins
- maintained benchmark reports with methodology
- well-known engineering blogs from credible vendors
- adoption caveats from issue trackers when directly relevant

### 3.3 Research Rules

- Cite sources used in the final report with title, URL, and access date.
- Do not treat marketing claims as evidence.
- Do not prescribe tooling solely because it is popular.
- If internet is unavailable, state that market research could not be performed and mark external-practice confidence as low.

## 4. Dimensions to Score

Score every dimension from 0 to 5:

| Score | Meaning |
|---:|---|
| 0 | Missing, broken, or contradicted by evidence |
| 1 | Experimental, manual, fragile, or undocumented |
| 2 | MVP functional, but material risks remain |
| 3 | Initial product with partial standards and incomplete gates |
| 4 | Corporate initial, operable with controlled gaps |
| 5 | Enterprise-ready: standardized, tested, observable, secure, resilient, governed |

Required dimensions:

- Architecture
- Organization
- Code
- Domain
- APIs
- Database
- Security
- Observability
- Resilience
- Scalability
- Tests
- DevOps
- Documentation
- Governance

Overall maturity labels:

| Label | Typical Score Pattern |
|---|---|
| Prototype | most dimensions 0-1 |
| POC | works selectively, many dimensions 1-2 |
| MVP | core flows work, many dimensions 2 |
| Initial Product | many dimensions 2-3, production gaps remain |
| Corporate Initial | most dimensions 3-4 |
| Enterprise Ready | most dimensions 4-5, no critical blockers |

## 5. Severity Classification

Use severity consistently:

| Severity | Definition |
|---|---|
| Critical | Blocks production, exposes secrets or sensitive data, bypasses auth/authz, can cause data loss, financial loss, or systemic outage |
| High | Likely production failure or material security/data/integrity risk; severe coupling; no rollback for risky deployment |
| Medium | Meaningful maintainability, scalability, operability, testability, or evolution risk with reasonable mitigation |
| Low | Local cleanup, naming, documentation, or standardization issue without immediate operational impact |

For every finding include:

- description
- evidence
- impact
- risk
- confidence: `high`, `medium`, or `low`
- classification: `verified fact`, `technical inference`, or `hypothesis`
- recommendation
- estimated effort: `S`, `M`, `L`, or `XL`
- priority: `P0`, `P1`, `P2`, or `P3`

Priority mapping:

| Priority | Meaning |
|---|---|
| P0 | Must fix before production or before next major delivery gate |
| P1 | Fix in the next hardening phase |
| P2 | Schedule in normalization backlog |
| P3 | Opportunistic improvement |

## 6. Report Contract

Produce a structured report in Portuguese (BR), unless the user requests another language.

### 6.1 Required Sections

1. Sumário executivo
2. Premissas e contexto usado
3. Método de análise e limitações
4. Stack detectada e superfície analisada
5. Diagnóstico geral de maturidade
6. Principais achados por severidade
7. Gaps para enterprise readiness
8. Recomendações de normalização
9. Arquitetura alvo recomendada
10. Plano de evolução em fases
11. Backlog técnico priorizado
12. Decisões arquiteturais sugeridas
13. Pesquisa externa e práticas de mercado aplicáveis
14. Conclusão: próximos 30, 60 e 90 dias

### 6.2 Maturity Table

```markdown
| Dimensão | Nota | Maturidade | Evidência Principal | Comentário |
|---|---:|---|---|---|
| Arquitetura |  |  |  |  |
| Organização |  |  |  |  |
| Código |  |  |  |  |
| Domínio |  |  |  |  |
| APIs |  |  |  |  |
| Banco de dados |  |  |  |  |
| Segurança |  |  |  |  |
| Observabilidade |  |  |  |  |
| Resiliência |  |  |  |  |
| Escalabilidade |  |  |  |  |
| Testes |  |  |  |  |
| DevOps |  |  |  |  |
| Documentação |  |  |  |  |
| Governança |  |  |  |  |
```

### 6.3 Finding Template

```markdown
### [Severidade/Prioridade] Título do achado

- **Descrição:** ...
- **Evidência:** `path/to/file.ext:123` ou comando/ausência documentada
- **Classificação:** verified fact | technical inference | hypothesis
- **Confiança:** high | medium | low
- **Impacto:** ...
- **Risco:** ...
- **Recomendação:** ...
- **Esforço:** S | M | L | XL
```

### 6.4 Backlog Template

```markdown
| Prioridade | Item | Tipo | Impacto | Esforço | Dependência |
|---|---|---|---|---|---|
| P0 |  | Security/Architecture/Testing/DevOps/etc |  | S/M/L/XL |  |
```

### 6.5 Artifact Recommendation

At the end, recommend durable artifacts:

- Markdown report: `_hseos-output/enterprise-readiness/<project>-<YYYY-MM-DD>.md`
- HTML report: `_hseos-output/enterprise-readiness/<project>-<YYYY-MM-DD>.html`

Create artifacts only when the user asks for them or has already authorized artifact generation. Markdown is canonical; HTML is derived.

If generating HTML, keep it self-contained:

- semantic HTML
- table of contents
- severity classes
- no external scripts
- no secrets or raw sensitive values

## 7. Architecture Guidance

Recommend target architecture based on actual stack and project needs, not ideology.

Evaluate:

- modular monolith vs microservices
- clean/hexagonal architecture fit
- domain complexity and DDD fit
- synchronous vs asynchronous integration
- persistence boundaries and schema evolution
- security boundaries and tenant isolation
- observability and operational ownership
- deploy topology and rollback strategy

Reject overengineering:

- Do not force DDD where CRUD with simple business rules is enough.
- Do not force microservices when team size and deployment maturity do not support them.
- Do not introduce abstraction layers without clear volatility, testability, or boundary benefits.

## 8. Phased Roadmap

Use these default phases unless the context requires different sequencing:

| Phase | Objective |
|---|---|
| Phase 1 — Critical Fixes | Make the system safe, executable, and minimally governable |
| Phase 2 — Technical Normalization | Standardize structure, code, contracts, config, and CI gates |
| Phase 3 — Corporate Robustness | Add resilience, observability, testing depth, and advanced security |
| Phase 4 — Scale and Evolution | Prepare for more users, tenants, teams, integrations, and volume |

Each phase must include:

- objective
- work items
- dependencies
- risks
- estimated effort
- acceptance criteria

## 9. Final Decision Questions

End with direct answers:

- Can the codebase evolve as-is?
- Is incremental refactoring enough?
- Is architectural restructuring needed?
- Are there production-blocking risks?
- What should be done in the next 30, 60, and 90 days?

## 10. Anti-Patterns

Do not:

- produce generic enterprise checklists without repository evidence
- assume absence of a file means absence of a capability without checking alternatives
- hide uncertainty
- mix opinions with verified risks
- recommend a rewrite by default
- create HTML without Markdown source
- create artifacts containing secrets, tokens, credentials, or PII samples
- let market research override local evidence

## Quick Mode

For low-context activation, load `SKILL-QUICK.md` first. Load this full skill for deep analysis, violation fixing, formal review gates, internet research, or report artifact generation.
