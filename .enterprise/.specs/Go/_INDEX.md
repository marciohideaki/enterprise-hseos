# Go Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/Go/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** Go
**Change Frequency:** Medium
**Audience:** Agents operating on Go stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [Go — Architecture Standard.md](./Go%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for Go services | Hexagonal layers, DDD, bounded context |
| [Go — Functional Requirements (FR).md](./Go%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [Go — Non-Functional Requirements (NFR).md](./Go%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, observability, resilience NFRs | Latency, availability targets |
| [Go — Core Networking Package Specification.md](./Go%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [Go — Service Template.md](./Go%20%E2%80%94%20Service%20Template.md) | Project scaffolding template | Folder structure, wiring |
| [Go — Pull Request Checklist.md](./Go%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | Compliance sections |
| [Go — Idiomatic Guide.md](./Go%20%E2%80%94%20Idiomatic%20Guide.md) | Go idioms, patterns, best practices | Language conventions |
| [Go — Build & Toolchain Standard.md](./Go%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | Go modules, CI toolchain rules | Build reproducibility |
| [Go — Testing Standard.md](./Go%20%E2%80%94%20Testing%20Standard.md) | Unit, integration, contract test rules | Coverage gates |
| [Go — Modern Features Standard.md](./Go%20%E2%80%94%20Modern%20Features%20Standard.md) | Go 1.21+ modern language features | MF-GO-01 to MF-GO-40 |

---

## Agent Reading Order

1. `Go — Architecture Standard.md` — architecture law for this stack
2. `Go — Non-Functional Requirements (NFR).md` — SLO targets
3. `Go — Pull Request Checklist.md` — before any PR review
4. `Go — Modern Features Standard.md` — for new feature work
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
