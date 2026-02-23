# C++ Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/Cpp/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** C++ (C++17 / C++20 / C++23)
**Change Frequency:** Medium
**Audience:** Agents operating on C++ stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [C++ — Architecture Standard.md](./C%2B%2B%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for C++ services | Hexagonal layers, DDD, bounded context |
| [C++ — Functional Requirements (FR).md](./C%2B%2B%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [C++ — Non-Functional Requirements (NFR).md](./C%2B%2B%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, observability, resilience NFRs | Latency, availability targets |
| [C++ — Core Networking Package Specification.md](./C%2B%2B%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [C++ — Service Template.md](./C%2B%2B%20%E2%80%94%20Service%20Template.md) | Project scaffolding template | Folder structure, wiring |
| [C++ — Pull Request Checklist.md](./C%2B%2B%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | Compliance sections |
| [C++ — Idiomatic Guide.md](./C%2B%2B%20%E2%80%94%20Idiomatic%20Guide.md) | C++ idioms, patterns, best practices | Language conventions |
| [C++ — Build & Toolchain Standard.md](./C%2B%2B%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | CMake, vcpkg, CI toolchain rules | Build reproducibility |
| [C++ — Testing Standard.md](./C%2B%2B%20%E2%80%94%20Testing%20Standard.md) | Unit, integration, contract test rules | Coverage gates |
| [C++ — Modern Features Standard.md](./C%2B%2B%20%E2%80%94%20Modern%20Features%20Standard.md) | C++17/20/23 modern language features | MF-CPP-01 to MF-CPP-50 |

---

## Agent Reading Order

1. `C++ — Architecture Standard.md` — architecture law for this stack
2. `C++ — Non-Functional Requirements (NFR).md` — SLO targets
3. `C++ — Pull Request Checklist.md` — before any PR review
4. `C++ — Modern Features Standard.md` — for new feature work
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
