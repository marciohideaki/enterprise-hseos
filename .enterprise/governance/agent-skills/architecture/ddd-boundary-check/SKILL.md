---
name: ddd-boundary-check
description: "Use when running a full DDD boundary audit, detecting context leakage, or remediating domain and infrastructure contamination"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# DDD Boundary Check (Project-Agnostic)

## Goal
Prevent architectural erosion by enforcing:
- Bounded Context isolation
- Layered dependency direction
- Domain purity (no infrastructure leakage into domain)
- Contract-first integration across contexts

This skill is **project-agnostic**: it relies on repository structure + dependency evidence, not on domain-specific rules.

## When to use
Run this skill when:
- a PR changes code under `/domain`, `/application`, `/infrastructure`, `/api`, `/services`
- new modules/packages are added
- cross-module references appear in the diff
- events/contracts are changed
- persistence/ORM changes touch domain types

## Inputs you MUST inspect
- File paths changed in the diff
- Namespaces/modules/packages of changed files
- Imports/usings/references added
- Build module dependency graph (solution/project references or package deps) if available
- Public API surface changes (controllers/endpoints/contracts)

## Universal DDD rules (MUST)

### 1) Dependency Direction (Layering)
Allowed direction (typical):
- `API` → `Application` → `Domain`
- `Infrastructure` → `Application` and/or implements `Application` ports
Forbidden:
- `Domain` referencing `Infrastructure`
- `Domain` referencing `API` or delivery mechanisms
- `Application` depending on concrete infra adapters (must depend on ports/interfaces)

**Pass condition:** For each changed file, show that new imports/usings do not violate direction.

### 2) Bounded Context Isolation
- A bounded context must not call another bounded context internals directly.
- Integration must be via:
  - published contracts (events/messages)
  - public APIs (explicit client/SDK)
  - anti-corruption layer (ACL) / adapters

Forbidden indicators:
- direct imports from another context's `domain` or `internal` packages
- sharing domain entities/value objects across contexts
- referencing another context's repository/ORM models

**Pass condition:** Cross-context interactions in the diff occur only through `contracts/`, `integration/`, `clients/`, or explicit ACL modules.

### 3) Domain Purity
Inside `Domain`:
- no ORM annotations/attributes
- no HTTP, serialization, database, message-broker libraries
- no logging frameworks as direct dependency (domain can expose domain events; logging is application/infra)
- no time/system IO calls directly (use abstractions)

**Pass condition:** Domain types changed remain POCO/POJO-like and free of infrastructure concerns.

### 4) Aggregates & Invariants
- Only aggregate roots enforce invariants and publish domain events.
- External code must not mutate aggregate internals bypassing methods.
- Repositories are per-aggregate root.

**Pass condition:** Changes that affect entities show invariants enforced in methods, not in controllers/handlers.

### 5) Transaction Boundaries & Side Effects
- Domain methods are deterministic and side-effect-free (except producing domain events).
- Side effects (IO, broker publish, DB writes, external calls) live in Application/Infrastructure.

**Pass condition:** Side effects in the diff occur in Application/Infra; Domain exposes intent/events only.

## Heuristics for projects without explicit BC folders
If the repo doesn't clearly separate contexts, infer them by:
- top-level modules/packages/projects (e.g., `Customer.*`, `Payment.*`)
- folder roots under `src/`
- solution project boundaries (each service = BC by default)

If still ambiguous, treat **each deployable unit** (service/app) as a bounded context and enforce isolation between them.

## Output required (what you MUST produce)
Provide:
1) A short verdict: PASS / WARN / FAIL
2) Evidence list:
   - files checked
   - new cross-module imports
   - any violations found with file+line references (or best-effort pointers)
3) Fix guidance:
   - what to move where (Domain vs Application vs Infra)
   - suggested ACL/adapters/contracts to introduce
4) If FAIL, propose a minimal refactor plan (3–6 steps)

## Common violations and fixes

### Violation: Domain depends on ORM
Fix:
- move persistence mapping to Infrastructure
- use separate persistence models if needed
- map Domain ↔ Persistence in adapter

### Violation: Context A imports Context B domain entities
Fix:
- define integration contracts (DTO/events) in a shared `contracts` module
- create ACL adapter in Context A that translates contracts ↔ domain

### Violation: Controller mutates entity fields directly
Fix:
- expose behavior methods on aggregate root
- perform orchestration in Application command handler

## Minimal acceptance checklist
- [ ] No Domain → Infrastructure references introduced
- [ ] No cross-context internal imports introduced
- [ ] Contracts versioning considered when integration changed
- [ ] Side effects kept out of Domain
- [ ] Aggregate invariants enforced in domain methods