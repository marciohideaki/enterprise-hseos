# Flutter Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/Flutter/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** Flutter / Dart
**Change Frequency:** Medium
**Audience:** Agents operating on Flutter stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [Flutter — Architecture Standard.md](./Flutter%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for Flutter apps | Feature-first, Hexagonal layers, Clean Architecture |
| [Flutter — Functional Requirements (FR).md](./Flutter%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [Flutter — Non-Functional Requirements (NFR).md](./Flutter%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, rendering, offline NFRs | Frame rate, TTI targets |
| [Flutter — Core Networking Package Specification.md](./Flutter%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [Flutter — Feature Template.md](./Flutter%20%E2%80%94%20Feature%20Template.md) | Feature scaffolding template | Feature-first folder structure |
| [Flutter — Pull Request Checklist.md](./Flutter%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | Compliance sections |
| [Flutter — Idiomatic Guide.md](./Flutter%20%E2%80%94%20Idiomatic%20Guide.md) | Dart / Flutter idioms and best practices | Language conventions |
| [Flutter — Build & Toolchain Standard.md](./Flutter%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | Flutter CLI, pub, CI toolchain rules | Build reproducibility |
| [Flutter — Testing Standard.md](./Flutter%20%E2%80%94%20Testing%20Standard.md) | Unit, widget, integration test rules | Coverage gates |
| [Flutter — Modern Features Standard.md](./Flutter%20%E2%80%94%20Modern%20Features%20Standard.md) | Dart 3.x / Flutter modern features | MF-FL-01 to MF-FL-48 |

---

## Notes

- Flutter and React Native use **Feature Template** (not Service Template) — mobile apps are organized by feature, not by service boundary
- Architecture decisions specific to this stack are documented in `.specs/decisions/ADR-0004-flutter-architecture-decisions.md`

---

## Agent Reading Order

1. `Flutter — Architecture Standard.md` — architecture law for this stack
2. `Flutter — Non-Functional Requirements (NFR).md` — frame rate and TTI targets
3. `Flutter — Pull Request Checklist.md` — before any PR review
4. `Flutter — Modern Features Standard.md` — for new feature work (Impeller, Records, Isolates)
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
