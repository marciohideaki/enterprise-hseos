# Core Standards — Index

**Shard:** Core (Organizational Invariants)
**Path:** `.enterprise/.specs/core/`
**Authority:** Highest (below Constitution)
**Change Frequency:** Low — requires Engineering Leadership approval
**Audience:** All agents, all stacks — read before any task

---

## Documents

| Document | Purpose | Key Rules |
|---|---|---|
| [AGENT RULES STANDARD.md](./AGENT%20RULES%20STANDARD.md) | Agent behavior and operation constraints | AR-01 to AR-XX |
| [Engineering Governance Standard.md](./Engineering%20Governance%20Standard.md) | Organizational engineering principles | Full compliance baseline |
| [Engineering Playbook.md](./Engineering%20Playbook.md) | Operational engineering practices | How teams work |
| [Quality Gates & Compliance Standard.md](./Quality%20Gates%20%26%20Compliance%20Standard.md) | PR/merge/release quality gates | Mandatory gates per environment |
| [Git Flow & Release Governance Standard.md](./Git%20Flow%20%26%20Release%20Governance%20Standard.md) | Branching, tagging, release process | Branch naming, merge rules |
| [Naming & Conventions Standard.md](./Naming%20%26%20Conventions%20Standard.md) | Cross-stack naming rules | Files, variables, services |
| [Deprecation & Sunset Policy.md](./Deprecation%20%26%20Sunset%20Policy.md) | Lifecycle management for standards and code | Notice periods, migration |
| [Hexagonal & Clean Architecture Standard.md](./Hexagonal%20%26%20Clean%20Architecture%20Standard.md) | Architecture layer rules | Domain purity, dependency direction |
| [Microservices Architecture Standard.md](./Microservices%20Architecture%20Standard.md) | Service decomposition principles | Bounded context, API contracts |
| [CQRS Standard.md](./CQRS%20Standard.md) | Command/Query separation | Read/write model separation |
| [Event Sourcing Standard.md](./Event%20Sourcing%20Standard.md) | Event-driven state management | Opt-in; event log as source of truth |
| [Saga Pattern Standard.md](./Saga%20Pattern%20Standard.md) | Distributed transaction coordination | Choreography vs orchestration |
| [SOLID Principles & Software Craftsmanship Standard.md](./SOLID%20Principles%20%26%20Software%20Craftsmanship%20Standard.md) | SOLID, DRY, KISS, YAGNI, Law of Demeter, Composition over Inheritance | SP-01 to SP-90 |

---

## Reading Order for Agents

1. `AGENT RULES STANDARD.md` — operating constraints
2. `Engineering Governance Standard.md` — principles baseline
3. `Hexagonal & Clean Architecture Standard.md` — architecture law
4. `SOLID Principles & Software Craftsmanship Standard.md` — design principles
5. Then stack-specific and cross-cutting docs

---

## Rules

- These documents are **never auto-modified** by agents
- Agents MUST read this index before any architecture, design, or PR task
- Violations require explicit ADR in `.specs/decisions/`
