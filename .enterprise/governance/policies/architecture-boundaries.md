# Architecture Boundaries Policy
**Status:** Active  
**Owner:** Platform Architecture / Engineering Governance  
**Applies to:** All repositories and deployable units under the Enterprise ecosystem  
**Effective date:** 2026-02-19  
**Review cadence:** Quarterly (or on major platform changes)

---

## 1. Purpose
This policy defines **mandatory architectural boundaries** for software delivered in this enterprise ecosystem.

The intent is to:
- prevent **bounded context leakage** and uncontrolled coupling
- preserve **domain integrity** (DDD)
- reduce operational risk by enforcing predictable **dependency direction**
- make change impact and ownership clear through **explicit contracts**
- keep the system evolvable under continuous delivery

This is a **normative policy**. Violations must be treated as architectural defects.

---

## 2. Definitions
### 2.1 Bounded Context (BC)
A Bounded Context is a cohesive domain scope with its own:
- domain model (ubiquitous language)
- invariants and rules
- persistence model (optional)
- API surface and/or message contracts
- ownership and release cadence

**Default rule:** each deployable service is a BC unless explicitly documented otherwise.

### 2.2 Layers
Layers are logical zones with a **directional dependency rule**:
- **Domain**: model + invariants + domain events (no IO)
- **Application**: orchestration, use cases, ports, transactional boundaries
- **Infrastructure**: adapters, persistence, external integrations, brokers, observability plumbing
- **Delivery/API**: controllers, transport, serialization edge, auth edge

### 2.3 Contract
A contract is an explicit boundary artifact, including:
- API schema (OpenAPI/Proto)
- event schema (JSON schema/Proto/Avro)
- versioning rules and compatibility constraints

---

## 3. Mandatory Rules (MUST)

### Rule A — Dependency Direction
**Allowed direction:**
- Delivery/API → Application → Domain
- Infrastructure → Application (implements ports) and may reference Domain types only when mapping is explicit and controlled

**Forbidden:**
- Domain → Infrastructure (direct reference/import)
- Domain → Delivery/API
- Application → concrete Infrastructure implementations (must depend on abstractions/ports)

**Rationale:** preserves domain purity and testability; prevents vendor/transport lock-in inside domain logic.

---

### Rule B — Bounded Context Isolation
A BC MUST NOT:
- import another BC’s internal packages/modules
- share domain entities/value objects directly with other BCs
- access another BC’s database directly

Cross-BC interactions MUST occur only via:
- **contracts** (events/messages) OR
- **public APIs** (explicit clients) OR
- **Anti-Corruption Layer (ACL)** that maps foreign concepts into local domain concepts

**Rationale:** prevents implicit coupling; allows independent evolution.

---

### Rule C — Domain Purity (No Infrastructure Leakage)
Code in the **Domain layer** MUST NOT:
- contain ORM annotations/attributes or persistence mappings
- depend on database/broker/http client libraries
- perform IO (filesystem/network/time) directly
- contain logging as a runtime dependency (domain emits events; logging occurs outside)

**Allowed:** domain events, exceptions, pure functions, invariants, deterministic behavior.

**Rationale:** keeps the domain model stable, portable, and robust.

---

### Rule D — Aggregates and Invariants
- Invariants MUST be enforced inside aggregate methods, not in controllers.
- External code MUST NOT mutate aggregate state directly (no “anemic domain” field poking).
- Repositories MUST be defined per aggregate root.

**Rationale:** integrity must be guaranteed at the model boundary, not by convention.

---

### Rule E — Side Effects and Transaction Boundaries
Side effects MUST live outside Domain:
- external calls
- publishing to broker
- persistence commits
- retries/circuit breakers
- observability emitters

Application layer owns orchestration and transactional boundaries.

**Rationale:** deterministic domain logic + controlled side effects reduces incident surface.

---

## 4. Compatibility & Versioning Requirements

### 4.1 Event / Message Contracts
Any change to an event/message contract MUST declare:
- whether change is backward compatible
- version bump strategy (e.g., `v1` → `v2`)
- consumer impact and migration steps

**Forbidden:** breaking changes without a dual-publish / dual-consume strategy.

### 4.2 API Contracts
Breaking changes MUST:
- be versioned
- include rollout and rollback plan
- include client migration instructions (if applicable)

---

## 5. Evidence Required in PRs (Gate)
Any PR that:
- adds/removes modules
- changes domain models
- introduces cross-context references
- modifies contracts (API/events)
- touches persistence mappings

MUST include evidence:
1) **Boundary check summary** (manual or via `ddd-boundary-check`)
2) **Dependency direction confirmation** (what references were added/removed)
3) **Contract impact** (if applicable)
4) **Risk classification** (Low/Med/High) + rollback strategy

PRs lacking these items MUST NOT be approved.

---

## 6. Enforcement
### 6.1 Automated Checks
The pipeline SHOULD fail when detecting:
- `Domain` importing known infra libraries
- cross-context internal imports (e.g., `*.Customer.Domain.*` used inside `Payment.*`)
- direct DB access across services
- contract breaking changes without versioning

### 6.2 Agent Skills
The organization standard skill:
- `ddd-boundary-check`
MUST be available and used by agents that generate or validate code changes.

### 6.3 Exceptions
Exceptions require:
- Architecture review approval
- documented rationale
- explicit scope and expiry date
- mitigation plan

Exceptions without expiry are treated as **architecture debt** and must be tracked.

---

## 7. Common Anti-Patterns (Explicitly Forbidden)

### 7.1 Shared Domain Model
A “shared” library of domain entities used across contexts is forbidden.
**Use:** shared contracts only, mapped per context.

### 7.2 Domain Includes ORM/Transport
Domain classes annotated with ORM/serialization concerns are forbidden.
**Use:** mapping layer in Infrastructure + DTOs at boundary.

### 7.3 Chatty Cross-BC Calls
Synchronous calls across contexts for internal invariants are forbidden unless explicitly justified.
**Use:** events, sagas/process managers, or contract-based APIs.

---

## 8. Minimal Reference Architecture
For each Bounded Context, the recommended module layout is:

- `bc.domain/`
- `bc.application/`
- `bc.infrastructure/`
- `bc.api/` (or delivery)

Where “bc” is the bounded context identifier.

If a repo is not structured like this, it must document equivalences (e.g., folder conventions).

---

## 9. Appendix — Practical Examples (Non-Normative)

### Example: Cross-BC integration (correct)
Payment consumes `CustomerProfileUpdated` (contract), maps to local `PayerProfile` via ACL.

### Example: Cross-BC integration (incorrect)
Payment imports `Customer.Domain.Client` and uses it directly.

---

## 10. Ownership & Review
- **Owner:** Platform Architecture
- **Reviewers:** Staff Engineers, Security, SRE (as applicable)
- **Review cadence:** quarterly or on major boundary refactors