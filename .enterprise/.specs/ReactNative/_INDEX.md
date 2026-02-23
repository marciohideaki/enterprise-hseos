# React Native Stack — Index

**Shard:** Stack-Specific Standards
**Path:** `.enterprise/.specs/ReactNative/`
**Authority:** Stack-level (below Core and Cross-Cutting)
**Stack:** React Native (TypeScript / Expo Bare Workflow)
**Change Frequency:** Medium
**Audience:** Agents operating on React Native stack tasks

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [React Native — Architecture Standard.md](./React%20Native%20%E2%80%94%20Architecture%20Standard.md) | Mandatory architecture rules for React Native apps | Feature-first, Clean Architecture, New Architecture |
| [React Native — Functional Requirements (FR).md](./React%20Native%20%E2%80%94%20Functional%20Requirements%20%28FR%29.md) | Functional requirements baseline | FR rules |
| [React Native — Non-Functional Requirements (NFR).md](./React%20Native%20%E2%80%94%20Non-Functional%20Requirements%20%28NFR%29.md) | SLOs, TTI, JS bundle, offline NFRs | TTI, frame rate targets |
| [React Native — Core Networking Package Specification.md](./React%20Native%20%E2%80%94%20Core%20Networking%20Package%20Specification.md) | HTTP client, retry, circuit breaker specification | Networking baseline |
| [React Native — Feature Template.md](./React%20Native%20%E2%80%94%20Feature%20Template.md) | Feature scaffolding template | Feature-first folder structure |
| [React Native — Pull Request Checklist.md](./React%20Native%20%E2%80%94%20Pull%20Request%20Checklist.md) | PR quality gates | Compliance sections |
| [React Native — Idiomatic Guide.md](./React%20Native%20%E2%80%94%20Idiomatic%20Guide.md) | TypeScript / RN idioms and best practices | Language conventions |
| [React Native — Build & Toolchain Standard.md](./React%20Native%20%E2%80%94%20Build%20%26%20Toolchain%20Standard.md) | Metro, EAS Build, CI toolchain rules | Build reproducibility |
| [React Native — Testing Standard.md](./React%20Native%20%E2%80%94%20Testing%20Standard.md) | Unit, component, E2E test rules | Coverage gates |
| [React Native — Modern Features Standard.md](./React%20Native%20%E2%80%94%20Modern%20Features%20Standard.md) | RN New Architecture, TurboModules, Hermes, Reanimated 3 | MF-RN-01 to MF-RN-52 |

---

## Notes

- Flutter and React Native use **Feature Template** (not Service Template) — mobile apps are organized by feature, not by service boundary
- **New Architecture** (Fabric + JSI + TurboModules) is mandatory from RN 0.74+ — see MF-RN-01
- **Expo bare workflow** is the preferred starting point — see MF-RN-25
- **Hermes engine** is non-negotiable — disabling requires ADR + benchmark — see MF-RN-33

---

## Agent Reading Order

1. `React Native — Architecture Standard.md` — architecture law for this stack
2. `React Native — Non-Functional Requirements (NFR).md` — TTI and frame rate targets
3. `React Native — Pull Request Checklist.md` — before any PR review
4. `React Native — Modern Features Standard.md` — for new feature work (TurboModules, Fabric, Reanimated)
5. Other documents as task requires

---

## Governing Standards

This stack is bound by (in authority order):
1. Core Standards — `.specs/core/`
2. Cross-Cutting Standards — `.specs/cross/` (all mandatory standards apply)
3. These stack-specific standards (this directory)

Stack standards MUST NOT weaken core or cross-cutting standards.
