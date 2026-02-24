# Cross-Cutting Standards

> **For human contributors.** AI agents navigate this directory via `_INDEX.md` — not this README.

---

## What "Cross-Cutting" Means

Cross-cutting standards apply **across all stacks simultaneously**. They cover concerns that transcend any individual technology — security, observability, testing, API design, data governance — and must be addressed in every service regardless of language or framework.

Unlike core standards (organizational invariants), cross-cutting standards are **operational mandates** — they define how you build, not just what you build.

---

## Documents in This Directory

| Document | Scope | Mandatory? | Key Rules |
|---|---|---|---|
| `Security & Identity Standard.md` | Auth, secrets, PII, API security | **Yes** | SI-01 to SI-47 |
| `Security Scanning & Supply Chain Standard.md` | SAST, DAST, SBOM, secret scanning, SLSA Level 2 | **Yes** | SS-01 to SS-65 |
| `Data Governance & LGPD Standard.md` | PII classification, retention, LGPD/GDPR compliance | **Yes** | DG-01 to DG-75 |
| `Observability Playbook.md` | Structured logging, metrics, distributed tracing | **Yes** | Full playbook |
| `Data Contracts & Schema Evolution Standard.md` | API contracts, event schema versioning | **Yes** | DC-01 to DC-XX |
| `Code & API Documentation Standard.md` | Doc coverage for all public code and APIs | **Yes** | Full standard |
| `Resilience Patterns Standard.md` | Retry, circuit breaker, bulkhead, timeout patterns | **Yes** | Full standard |
| `Advanced Testing Strategy Standard.md` | TDD, BDD, contract testing, mutation testing, chaos engineering | **Yes** | AT-01 to AT-80 |
| `API Management & Versioning Standard.md` | URL versioning, rate limiting, RFC 7807 errors, deprecation | **Yes** | AM-01 to AM-75 |
| `CI/CD Pipeline Standard.md` | Pipeline stages, CD promotion, quality gates, artifact management | **Yes** | CI-01 to CI-80 |
| `Context-Degradation-Monitoring-Standard.md` | Degradation pattern detection, mitigation, context usage rules for agent sessions | **Yes** | CE-DEG-01 to CE-DEG-15 |
| `Memory-Architecture-Standard.md` | In-context, external, cached, and computed memory — selection rules and handoff protocol | **Yes** | CE-MEM-01 to CE-MEM-13 |
| `Multi-Agent-Architecture-Standard.md` | Orchestrator/subagent design, trust boundaries, prompt injection defense, parallelism | **Yes** | CE-MAA-01 to CE-MAA-24 |
| `Tool-Design-Governance-Standard.md` | Tool responsibility, permission scope, reversibility, output contracts, security | **Yes** | CE-TOOL-01 to CE-TOOL-17 |
| `Context-Compression-Standard.md` | Compression techniques, quality rules, compression vs. loss classification | **Yes** | CE-COMP-01 to CE-COMP-15 |
| `Performance Engineering Standard.md` | Hot path, zero-alloc, benchmarking gates | **Opt-in** | PE-01 to PE-55 |

---

## Mandatory vs. Opt-In

**Mandatory standards** apply automatically to every service. No ADR required to use them — but an ADR IS required to deviate from them.

**Opt-in standards** (currently only Performance Engineering) require an approved ADR before any rule from that standard applies. Use the template at `.specs/decisions/ADR-0005-performance-engineering-activation-template.md`.

---

## How Agents Apply These Standards

Agents load cross-cutting standards **by trigger**, not all at once. The `_INDEX.md` contains the full trigger table. Examples:

| If the change involves... | Load this standard |
|---|---|
| Auth, tokens, secrets | Security & Identity Standard |
| New dependency | Security Scanning & Supply Chain |
| PII data | Data Governance & LGPD |
| New endpoint | Observability Playbook |
| API contract change | Data Contracts & Schema Evolution |
| New HTTP/gRPC/event API | API Management & Versioning |
| Business logic | Advanced Testing Strategy |

---

## Adding a New Cross-Cutting Standard

1. Create the document in this directory following the existing naming pattern
2. Add an entry to `cross/_INDEX.md` with the `Opt-In?` column filled
3. Update `Enterprise-Constitution.md` §4.2 with the new standard
4. If mandatory: no ADR needed for addition, but update all stack PR checklists
5. If opt-in: document the activation ADR template in `decisions/`

---

## Deviating from a Mandatory Standard

Deviations require an ADR in `.specs/decisions/` explicitly approved by Engineering Leadership. The ADR must include:
- Which standard and which specific rules are being deviated from
- Why compliance is not feasible
- Compensating controls
- Expiration condition
