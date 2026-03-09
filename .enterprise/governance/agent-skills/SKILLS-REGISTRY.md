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

---

### security-audit-plain-language
**Description:** Read-only project security audit for non-technical stakeholders, with plain-language risk communication and step-by-step remediation guidance.
**Load when:** user asks for a project security audit in simple language, executive-friendly risk summary, or non-technical security review.
**Triggers:** `security audit`, `non-technical security review`, `plain language security`, `executive security summary`, `check my project security`
**Tier 1:** `.enterprise/governance/agent-skills/security-audit-plain-language/SKILL-QUICK.md`
**Tier 2:** `.enterprise/governance/agent-skills/security-audit-plain-language/SKILL.md`
**Cost:** Tier 1 = low | Tier 2 = medium


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
| User requests full security audit in plain language | security-audit-plain-language | 1 |
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
