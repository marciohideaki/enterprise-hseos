---
name: spec-driven
description: "Use when planning and implementing a new feature or service end-to-end using the Specify→Design→Tasks→Implement workflow"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Spec-Driven Development

## When to use
Use this skill when:
- starting a new feature with significant scope
- designing a new service or bounded context
- breaking down a complex change into implementable tasks
- onboarding a new team member to a feature

---

## 1. Core Principle

> Specify fully before designing. Design fully before tasking. Task fully before implementing.

Skipping phases increases rework, ambiguity, and context loss across sessions.
Each phase produces a durable artifact that persists beyond a single agent/human session.

---

## 2. Phase 1 — Specify

**Goal:** Define what will be built and what will not.

**Produce:**
- SD-01: A **Feature Specification** document at `.specs/features/<feature-name>/spec.md`.
- SD-02: The spec MUST include:
  - **Purpose** — why this feature exists (business driver)
  - **Scope** — what is in scope
  - **Out of Scope** — explicit exclusions (prevents scope creep)
  - **Actors** — who/what uses this feature
  - **Functional Requirements (FR)** — numbered, testable acceptance criteria
  - **Non-Functional Requirements (NFR)** — performance SLAs, security, observability, resilience
  - **Constraints** — technology, regulatory, compatibility
  - **Open Questions** — unresolved decisions to be answered before Design phase

- SD-03: FRs MUST be testable: "The system MUST..." not "The system should be able to...".
- SD-04: NFRs MUST reference the relevant platform standard (Resilience Patterns Standard, Observability Playbook, etc.).
- SD-05: Open Questions MUST be resolved (or explicitly accepted as risks) before advancing to Phase 2.

---

## 3. Phase 2 — Design

**Goal:** Define how the feature will be built.

**Produce:**
- SD-06: A **Design Document** at `.specs/features/<feature-name>/design.md`.
- SD-07: The design MUST include:
  - **Bounded Context** — which service/BC owns this feature
  - **Architecture Approach** — patterns used (CQRS, Event Sourcing, Saga, etc.) with justification
  - **Domain Model Changes** — new aggregates, value objects, domain events
  - **API / Contract Design** — HTTP endpoints or event schemas (draft OpenAPI/JSON schema)
  - **Data Model** — new tables, collections, or schema changes
  - **Integration Points** — other services consumed or producing events
  - **Security Considerations** — auth requirements, PII handling, sensitive data
  - **Observability Plan** — key metrics, logs, traces for this feature
  - **ADRs** — drafts for non-trivial architectural decisions

- SD-08: Architecture approach MUST reference applicable platform standards.
- SD-09: API/contract design MUST follow Data Contracts & Schema Evolution Standard.
- SD-10: ADRs MUST be drafted (not just noted) for decisions requiring one per Engineering Governance Standard.

---

## 4. Phase 3 — Tasks

**Goal:** Decompose the design into atomic, implementable units of work.

**Produce:**
- SD-11: A **Task List** at `.specs/features/<feature-name>/tasks.md`.
- SD-12: Each task MUST include:
  - **ID** — sequential identifier
  - **Title** — imperative, specific: "Implement PlaceOrder command handler"
  - **Description** — what needs to be built, referenced layers, files to create/modify
  - **Acceptance Criteria** — how to verify it is done (testable)
  - **Dependencies** — which tasks must complete first
  - **Estimated scope** — Small / Medium / Large (no time estimates)

- SD-13: Tasks MUST be atomic — one task MUST be completable in a single session/context window.
- SD-14: Tasks MUST be sequenced so each task builds on the previous without creating undefined dependencies.
- SD-15: Test tasks MUST be explicit — do not assume tests are included in implementation tasks.
- SD-16: Each task's acceptance criteria MUST be verifiable without human interpretation.

---

## 4b. Task Contract Format (AI-SDLC)

Each task in `tasks.md` SHOULD be expressed using the full AI-SDLC contract format. This makes input/output boundaries explicit, enabling stateless execution — each agent session can start cold from the contract without requiring prior context.

**Canonical schema:**

```yaml
tasks:
  - id: T1
    name: "Implement PlaceOrder command handler"
    description: "Create PlaceOrderHandler in application layer. Validate command, emit OrderPlaced event via outbox."

    input_contract:
      files:
        - ".specs/features/checkout/design.md"       # architecture reference
        - "src/Orders/Domain/Order.cs"               # aggregate to extend
      data:
        - "PlaceOrder command schema (design.md §API)"
        - "OrderPlaced event schema (design.md §Events)"
      dependencies: []                               # predecessor task IDs

    output_contract:
      files:
        - "src/Orders/Application/Commands/PlaceOrderHandler.cs"  # created
        - "src/Orders/Application/Commands/PlaceOrderHandler.Tests.cs"
      artifacts:
        - "unit tests passing"
        - "domain event dispatched to outbox"

    constraints:
      - "C# 12 / .NET 8"
      - "Hexagonal architecture — no infrastructure imports in application layer"
      - "DDD: handler receives command, calls aggregate, emits domain event only"

    acceptance_criteria:
      - "PlaceOrderHandler.Handle() calls Order.Place() and emits OrderPlaced"
      - "Unit tests cover happy path and validation failure"
      - "No direct DB calls in handler"

    execution_mode: isolated   # always isolated — no shared context with other tasks
```

**Rules:**
- SD-27: `input_contract.files` MUST list only files the agent needs to read — not the entire codebase
- SD-28: `output_contract.files` MUST list every file the agent will create or modify
- SD-29: `execution_mode` MUST always be `isolated` — context from prior tasks is passed via `input_contract`, not conversation history
- SD-30: `input_contract.dependencies` MUST reference task IDs, not implicit knowledge

---

## 5. Phase 4 — Implement

**Goal:** Execute tasks against acceptance criteria.

- SD-17: Implementation MUST proceed task by task in the defined sequence.
- SD-18: Each task MUST be marked complete only when all acceptance criteria are verified.
- SD-19: Tests MUST be written alongside implementation — not deferred.
- SD-20: If a task reveals new requirements or design gaps, STOP and update Phase 1/2 before proceeding.
- SD-21: Each completed task SHOULD result in a commit following commit hygiene rules.
- SD-22: PR review (`pr-review` skill) MUST be applied before merging any implementation.

---

## 6. Artifact Storage

```
.specs/features/
  <feature-name>/
    spec.md          ← Phase 1 output
    design.md        ← Phase 2 output
    tasks.md         ← Phase 3 output
    adr-drafts/      ← ADR drafts produced during design
```

---

## 7. Agent Behavior Rules

- SD-23: Agents MUST NOT start implementation before Phase 2 (Design) is complete.
- SD-24: Agents MUST NOT skip Phase 3 (Tasks) and jump directly from Design to coding.
- SD-25: If context window limits require stopping mid-phase, the current phase artifact MUST be saved before stopping.
- SD-26: Open Questions from Phase 1 MUST be answered before Phase 2 begins — agents MUST stop and request resolution, not assume answers.

---

## Examples

✅ Good flow:
1. Spec written with 8 FRs and NFRs (observability, resilience SLAs).
2. Design identifies new `PaymentBC`, CQRS, Outbox, and drafts ADR for payment provider choice.
3. Tasks broken into 11 atomic items, sequenced Domain → Application → Infrastructure → API.
4. Implementation proceeds task by task, tests alongside, PR raised per task group.

❌ Bad: Agent starts writing code after a one-sentence description — no spec, no design, no tasks.
❌ Bad: Tasks defined as "implement the payment feature" — not atomic, no acceptance criteria.

---

## Racionalizações Comuns

| Racionalização | Realidade |
|---|---|
| "É simples, não precisa de spec" | Tasks simples ainda precisam de critério de aceitação. Um spec de 2 linhas já é suficiente — sem critério, "pronto" é indefinível. |
| "Vou escrever o spec depois de codificar" | Isso é documentação, não spec. O valor do spec está em forçar clareza *antes* do código — depois, as decisões já foram tomadas implicitamente. |
| "Os requisitos vão mudar de qualquer forma" | Por isso o spec é um documento vivo. Mudanças de requisito são esperadas; surpresas de escopo por falta de spec são evitáveis. |
| "O usuário sabe o que quer" | Mesmo requisitos claros têm suposições implícitas. Spec as torna explícitas e verificáveis — antes de virar código. |
| "Não temos tempo para spec" | Um spec de 15 minutos previne horas de retrabalho. Spec em 15 minutos é mais rápido que debugging em 15 horas. |

---

## Sinais de Alerta (Red Flags)

- Iniciar qualquer implementação sem spec.md criado e revisado
- Tasks definidas como "implementar a feature X" sem critérios de aceitação
- Avançar da Fase 1 para a Fase 2 com Open Questions ainda abertas — **Open Questions MUST be resolved before Phase 2 begins; agents MUST stop and request resolution**
- Implementar funcionalidade não mencionada em nenhuma FR ou NFR do spec
- Spec sem Out of Scope — ausência de exclusões explícitas garante scope creep
- Input contract de uma task referencia "contexto implícito da sessão" em vez de arquivos concretos

---

## Verificação (Exit Criteria)

- [ ] spec.md existe em `.specs/features/<feature-name>/` com todas as seções obrigatórias (SD-02)
- [ ] Todas as FRs são testáveis ("o sistema MUST..." não "o sistema deveria...")
- [ ] Open Questions da Fase 1 foram resolvidas ou aceitas como risco antes de avançar para Fase 2
- [ ] design.md referencia os padrões de plataforma aplicáveis (SD-08)
- [ ] Cada task em tasks.md tem acceptance criteria verificável sem interpretação humana (SD-16)
- [ ] Todas as tasks têm `execution_mode: isolated` e input_contract completo (SD-28, SD-29)
