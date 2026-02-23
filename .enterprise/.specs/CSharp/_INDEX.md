# C# / .NET Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/CSharp/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** C# / .NET
**Change Frequency:** Medium
**Audience:** Agents operating on CSharp stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [CSharp DotNET — Architecture Standard.md](./CSharp%20DotNET%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for .NET services | Hexagonal layers, DDD, bounded context |
| [CSharp DotNET — Functional Requirements (FR).md](./CSharp%20DotNET%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [CSharp DotNET — Non-Functional Requirements (NFR).md](./CSharp%20DotNET%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, observability, resilience NFRs | Latency, availability targets |
| [CSharp DotNET — Core Networking Package Specification.md](./CSharp%20DotNET%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [CSharp DotNET — Service + Module Template.md](./CSharp%20DotNET%20%E2%80%94%20Service%20%2B%20Module%20Template.md) | Project scaffolding template | Folder structure, wiring |
| [CSharp DotNET — Pull Request Checklist.md](./CSharp%20DotNET%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | 12 compliance sections |
| [CSharp DotNET — Idiomatic Guide.md](./CSharp%20DotNET%20%E2%80%94%20Idiomatic%20Guide.md) | C# idioms, patterns, best practices | Language conventions |
| [CSharp DotNET — Build & Toolchain Standard.md](./CSharp%20DotNET%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | SDK, NuGet, CI toolchain rules | Build reproducibility |
| [CSharp DotNET — Testing Standard.md](./CSharp%20DotNET%20%E2%80%94%20Testing%20Standard.md) | Unit, integration, contract test rules | Coverage gates |
| [CSharp DotNET — Modern Features Standard.md](./CSharp%20DotNET%20%E2%80%94%20Modern%20Features%20Standard.md) | .NET 8/9 modern language features | MF-CS-01 to MF-CS-48 |

---

## Agent Reading Order

1. `CSharp DotNET — Architecture Standard.md` — architecture law for this stack
2. `CSharp DotNET — Non-Functional Requirements (NFR).md` — SLO targets
3. `CSharp DotNET — Pull Request Checklist.md` — before any PR review
4. `CSharp DotNET — Modern Features Standard.md` — for new feature work
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
