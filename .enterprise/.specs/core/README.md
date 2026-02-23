# Core Standards

> **For human contributors.** AI agents navigate this directory via `_INDEX.md` — not this README.

---

## What "Core" Means

Core standards are **organizational invariants** — rules that apply to every agent, every stack, and every task, regardless of context. They change rarely and require Engineering Leadership approval to modify.

Think of core standards as the **laws of the organization**. Cross-cutting standards are regulations. Stack standards are local rules. Core standards are the constitution made operational.

---

## Documents in This Directory

| Document | What It Governs | Change Frequency |
|---|---|---|
| `AGENT RULES STANDARD.md` | Agent behavior and operation constraints (AR-01 to AR-55) | Very Low |
| `Engineering Governance Standard.md` | Organizational engineering principles and compliance baseline | Very Low |
| `Engineering Playbook.md` | How teams work operationally — ceremonies, rituals, practices | Low |
| `Quality Gates & Compliance Standard.md` | Mandatory gates per PR, merge, and release environment | Low |
| `Git Flow & Release Governance Standard.md` | Branch naming, merge rules, tagging, release process | Low |
| `Naming & Conventions Standard.md` | Cross-stack naming rules for files, variables, services, events | Very Low |
| `Deprecation & Sunset Policy.md` | Lifecycle management — notice periods, migration windows | Very Low |
| `Hexagonal & Clean Architecture Standard.md` | Mandatory layer rules — domain purity, dependency direction | Very Low |
| `Microservices Architecture Standard.md` | Service decomposition — bounded context, API contracts | Low |
| `CQRS Standard.md` | Command/Query separation — read/write model rules | Low |
| `Event Sourcing Standard.md` | Event-driven state — opt-in; event log as source of truth | Low |
| `Saga Pattern Standard.md` | Distributed transaction coordination — choreography vs orchestration | Low |
| `SOLID Principles & Software Craftsmanship Standard.md` | SOLID, DRY, KISS, YAGNI, Law of Demeter, 6 anti-patterns (SP-01–90) | Low |

---

## Agent Reading Order

Agents MUST read core standards in this order before any architecture, design, or PR task:

1. `AGENT RULES STANDARD.md` — operating constraints
2. `Engineering Governance Standard.md` — principles baseline
3. `Hexagonal & Clean Architecture Standard.md` — architecture law
4. `SOLID Principles & Software Craftsmanship Standard.md` — design principles
5. Other core documents as the task requires

See `_INDEX.md` for the machine-readable version of this order.

---

## What Cannot Be Done Without Approval

- Modifying any document in this directory requires Engineering Leadership sign-off
- Deviating from any core standard requires an ADR in `.specs/decisions/`
- Agents MUST NEVER auto-modify these documents

---

## Relationship to Other Shards

```
Constitution
    └── Core (you are here) — highest operational authority
            └── Cross-Cutting — mandatory extensions
                    └── Stack-Specific — local rules within a stack
                            └── ADRs — approved overrides
```

Core standards cannot be overridden by cross-cutting, stack, or ADR documents.
Cross-cutting standards can add requirements on top of core, but cannot weaken them.
