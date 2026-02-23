# PHP Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/PHP/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** PHP (Laravel / Symfony)
**Change Frequency:** Medium
**Audience:** Agents operating on PHP stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [PHP — Architecture Standard.md](./PHP%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for PHP services | Hexagonal layers, DDD, bounded context |
| [PHP — Functional Requirements (FR).md](./PHP%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [PHP — Non-Functional Requirements (NFR).md](./PHP%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, observability, resilience NFRs | Latency, availability targets |
| [PHP — Core Networking Package Specification.md](./PHP%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [PHP — Service Template.md](./PHP%20%E2%80%94%20Service%20Template.md) | Project scaffolding template | Folder structure, wiring |
| [PHP — Pull Request Checklist.md](./PHP%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | Compliance sections |
| [PHP — Idiomatic Guide.md](./PHP%20%E2%80%94%20Idiomatic%20Guide.md) | PHP idioms, patterns, best practices | Language conventions |
| [PHP — Build & Toolchain Standard.md](./PHP%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | Composer, CI toolchain rules | Build reproducibility |
| [PHP — Testing Standard.md](./PHP%20%E2%80%94%20Testing%20Standard.md) | Unit, integration, contract test rules | Coverage gates |
| [PHP — Modern Features Standard.md](./PHP%20%E2%80%94%20Modern%20Features%20Standard.md) | PHP 8.2/8.3 modern language features | MF-PHP-01 to MF-PHP-46 |

---

## Agent Reading Order

1. `PHP — Architecture Standard.md` — architecture law for this stack
2. `PHP — Non-Functional Requirements (NFR).md` — SLO targets
3. `PHP — Pull Request Checklist.md` — before any PR review
4. `PHP — Modern Features Standard.md` — for new feature work
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
