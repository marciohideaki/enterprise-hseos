# Java Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/Java/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** Java (Spring Boot / Jakarta EE)
**Change Frequency:** Medium
**Audience:** Agents operating on Java stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [Java — Architecture Standard.md](./Java%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for Java services | Hexagonal layers, DDD, bounded context |
| [Java — Functional Requirements (FR).md](./Java%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [Java — Non-Functional Requirements (NFR).md](./Java%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, observability, resilience NFRs | Latency, availability targets |
| [Java — Core Networking Package Specification.md](./Java%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [Java — Service Template.md](./Java%20%E2%80%94%20Service%20Template.md) | Project scaffolding template | Folder structure, wiring |
| [Java — Pull Request Checklist.md](./Java%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | Compliance sections |
| [Java — Idiomatic Guide.md](./Java%20%E2%80%94%20Idiomatic%20Guide.md) | Java idioms, patterns, best practices | Language conventions |
| [Java — Build & Toolchain Standard.md](./Java%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | Maven/Gradle, CI toolchain rules | Build reproducibility |
| [Java — Testing Standard.md](./Java%20%E2%80%94%20Testing%20Standard.md) | Unit, integration, contract test rules | Coverage gates |
| [Java — Modern Features Standard.md](./Java%20%E2%80%94%20Modern%20Features%20Standard.md) | Java 21+ modern language features | MF-JV-01 to MF-JV-48 |

---

## Agent Reading Order

1. `Java — Architecture Standard.md` — architecture law for this stack
2. `Java — Non-Functional Requirements (NFR).md` — SLO targets
3. `Java — Pull Request Checklist.md` — before any PR review
4. `Java — Modern Features Standard.md` — for new feature work
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
