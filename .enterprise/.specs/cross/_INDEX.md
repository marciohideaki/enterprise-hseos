# Cross-Cutting Standards — Index

**Shard:** Cross-Cutting Concerns
**Path:** `.enterprise/.specs/cross/`
**Authority:** Mandatory across all stacks (opt-in standards require ADR activation)
**Change Frequency:** Medium
**Audience:** All agents — automatically applicable unless explicitly excluded

---

## Documents

| Document | Scope | Opt-In? | Key Rules |
|---|---|---|---|
| [Security & Identity Standard.md](./Security%20%26%20Identity%20Standard.md) | Auth, secrets, PII, API security | No — mandatory | SI-01 to SI-47 |
| [Security Scanning & Supply Chain Standard.md](./Security%20Scanning%20%26%20Supply%20Chain%20Standard.md) | SAST, DAST, SBOM, Secret Scanning | No — mandatory | SS-01 to SS-XX |
| [Data Governance & LGPD Standard.md](./Data%20Governance%20%26%20LGPD%20Standard.md) | PII classification, retention, LGPD/GDPR | No — mandatory | DG-01 to DG-XX |
| [Observability Playbook.md](./Observability%20Playbook.md) | Logging, metrics, tracing | No — mandatory | Full playbook |
| [Data Contracts & Schema Evolution Standard.md](./Data%20Contracts%20%26%20Schema%20Evolution%20Standard.md) | API contracts, event schema versioning | No — mandatory | DC-01 to DC-XX |
| [Code & API Documentation Standard.md](./Code%20%26%20API%20Documentation%20Standard.md) | Doc coverage for public code and APIs | No — mandatory | Full standard |
| [Resilience Patterns Standard.md](./Resilience%20Patterns%20Standard.md) | Retry, circuit breaker, bulkhead | No — mandatory | Full standard |
| [Performance Engineering Standard.md](./Performance%20Engineering%20Standard.md) | Hot path, zero-alloc, benchmarking | **Yes — requires ADR** | PE-01 to PE-55 |
| [Advanced Testing Strategy Standard.md](./Advanced%20Testing%20Strategy%20Standard.md) | Test pyramid, TDD, BDD, contract, property-based, mutation, chaos | No — mandatory | AT-01 to AT-80 |
| [API Management & Versioning Standard.md](./API%20Management%20%26%20Versioning%20Standard.md) | URL versioning, breaking changes, rate limiting, deprecation, error format | No — mandatory | AM-01 to AM-75 |
| [CI CD Pipeline Standard.md](./CI%20CD%20Pipeline%20Standard.md) | Pipeline stages, branch strategy, CD promotion, quality gates, artifact management | No — mandatory | CI-01 to CI-80 |
| [Context-Degradation-Monitoring-Standard.md](./Context-Degradation-Monitoring-Standard.md) | Degradation pattern detection, mitigation, context usage rules for agent sessions | No — mandatory | CE-DEG-01 to CE-DEG-15 |
| [Memory-Architecture-Standard.md](./Memory-Architecture-Standard.md) | In-context, external, cached, and computed memory — selection rules and handoff protocol | No — mandatory | CE-MEM-01 to CE-MEM-13 |
| [Multi-Agent-Architecture-Standard.md](./Multi-Agent-Architecture-Standard.md) | Orchestrator/subagent design, trust boundaries, prompt injection defense, parallelism | No — mandatory | CE-MAA-01 to CE-MAA-24 |
| [Tool-Design-Governance-Standard.md](./Tool-Design-Governance-Standard.md) | Tool responsibility, permission scope, reversibility, output contracts, security | No — mandatory | CE-TOOL-01 to CE-TOOL-17 |
| [Context-Compression-Standard.md](./Context-Compression-Standard.md) | Compression techniques, quality rules, compression vs. loss classification | No — mandatory | CE-COMP-01 to CE-COMP-15 |

---

## Applicability Rules

- Agents MUST assume all non-opt-in standards apply unless explicitly excluded
- Opt-in standards (Performance Engineering) require an approved ADR in `.specs/decisions/`
- Violations of mandatory cross-cutting standards require an ADR exception in `.specs/decisions/`

---

## Agent Loading Guidance

For any PR or task, load cross-cutting standards that match the change:

| Change type | Load |
|---|---|
| Any auth/token/secret change | Security & Identity Standard |
| New dependency or package | Security Scanning & Supply Chain |
| PII data touched | Data Governance & LGPD |
| New endpoint or service operation | Observability Playbook |
| API contract change | Data Contracts & Schema Evolution |
| New public code | Code & API Documentation |
| New service with external calls | Resilience Patterns |
| Performance-sensitive service (ADR active) | Performance Engineering |
| Any service with business logic | Advanced Testing Strategy |
| New domain logic, use cases, or acceptance criteria | Advanced Testing Strategy |
| Service-to-service API or event integration | Advanced Testing Strategy (Contract Testing) |
| New or changed HTTP/gRPC/event API | API Management & Versioning |
| API deprecation or version bump | API Management & Versioning |
| New CI/CD pipeline or pipeline change | CI/CD Pipeline Standard |
| New deployment environment or promotion gate | CI/CD Pipeline Standard |
| Long-running agent session (> 5 turns) | Context-Degradation-Monitoring-Standard |
| Multi-session agent workflow or handoff | Memory-Architecture-Standard |
| Multi-agent orchestration design | Multi-Agent-Architecture-Standard |
| New tool design or tool review | Tool-Design-Governance-Standard |
| Context budget concern or session compression | Context-Compression-Standard |
