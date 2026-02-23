# Enterprise Specs — Master Index

> All shards are reachable from this index.
> Agents MUST start here. Follow the authority order defined in the Enterprise Constitution.

---

## Authority Order (Highest → Lowest)

1. [Enterprise Constitution](./constitution/Enterprise-Constitution.md)
2. [Core Standards](./core/_INDEX.md)
3. [Cross-Cutting Standards](./cross/_INDEX.md)
4. [Stack-Specific Standards](#stacks)
5. [Decision Records](./decisions/_INDEX.md)

---

## Core Standards

→ [core/_INDEX.md](./core/_INDEX.md)

Includes: Agent Rules, Engineering Governance, Architecture Patterns (Hexagonal, Microservices, CQRS, Event Sourcing, Saga), Naming, Quality Gates, Git Flow, Deprecation Policy.

---

## Cross-Cutting Standards

→ [cross/_INDEX.md](./cross/_INDEX.md)

Includes: Security & Identity, Security Scanning & Supply Chain, Data Governance & LGPD, Observability, Data Contracts & Schema Evolution, Code & API Documentation, Resilience Patterns, Performance Engineering (opt-in).

---

## Stack-Specific Standards {#stacks}

| Stack | Index | Documents |
|---|---|---|
| C# / .NET | [CSharp/_INDEX.md](./CSharp/_INDEX.md) | Architecture, FR, NFR, Networking, Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |
| Java | [Java/_INDEX.md](./Java/_INDEX.md) | Architecture, FR, NFR, Networking, Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |
| Go | [Go/_INDEX.md](./Go/_INDEX.md) | Architecture, FR, NFR, Networking, Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |
| PHP | [PHP/_INDEX.md](./PHP/_INDEX.md) | Architecture, FR, NFR, Networking, Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |
| C++ | [Cpp/_INDEX.md](./Cpp/_INDEX.md) | Architecture, FR, NFR, Networking, Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |
| Flutter | [Flutter/_INDEX.md](./Flutter/_INDEX.md) | Architecture, FR, NFR, Networking, Feature Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |
| React Native | [ReactNative/_INDEX.md](./ReactNative/_INDEX.md) | Architecture, FR, NFR, Networking, Feature Template, PR Checklist, Idiomatic, Build, Testing, Modern Features |

---

## Decision Records

→ [decisions/_INDEX.md](./decisions/_INDEX.md)

Active: ADR-0001 (Hexagonal Architecture), ADR-0002 (Event Sourcing Opt-In), ADR-0003 (CQRS Source of Truth Clarification).

---

## Sharding Rules

- Documents covering multiple stacks → must go in `core/` or `cross/`
- Documents growing beyond safe cognitive limits → must be sharded (see `policies/sharding-policy.md`)
- All shards must be listed in this index or a sub-index
- Stack documents MUST NOT override core or cross standards
