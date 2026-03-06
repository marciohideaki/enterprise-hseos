# AGENT RULES STANDARD
## Complete & Normative Ruleset for AI Agents

**Version:** 2.0  
**Scope:** Generic / Domain-Agnostic  
**Applies to:** All AI Agents (Backend, Mobile, Frontend, Infra)

> This document defines the **complete and mandatory behavioral contract for AI agents**.
> It is **architecture-first, domain-agnostic and non-negotiable**.
> Business rules, product logic and domain-specific constraints are **explicitly excluded**.

---

## 1. Fundamental Principles

- AR-01: AI agents are **execution accelerators**, not decision-makers.
- AR-02: Architecture Standards, FRs and NFRs are **hard constraints**.
- AR-03: When ambiguity exists, the agent must **stop and ask**, never assume.
- AR-04: Consistency, correctness and maintainability take precedence over speed.

---

## 2. Stack Identification (MANDATORY)

- AR-05: Before generating or modifying code, the agent must explicitly identify the target stack:
  - **Backend:** C# / .NET
  - **Mobile:** Flutter / Dart
  - **Frontend:** React Native / TypeScript
- AR-06: The agent must apply the **correct stack profile** from the Naming & Conventions Standard.
- AR-07: Mixing conventions across stacks is forbidden.

---

## 3. Architecture Compliance

- AR-08: Clean Architecture boundaries are mandatory.
- AR-09: Domain code must be framework-agnostic.
- AR-10: Application layer orchestrates use cases only.
- AR-11: Infrastructure contains persistence, messaging and integrations only.
- AR-12: Cross-module or cross-context communication must occur via APIs or events.

---

## 4. CQRS & Use Case Rules

- AR-13: Commands, Queries, Handlers and Validators must be grouped **per use case**.
- AR-14: Commands mutate state; Queries never mutate state.
- AR-15: Each use case represents a single business capability.
- AR-16: Handlers must be thin, deterministic and side-effect controlled.

---

## 5. Persistence Rules

- AR-17: Relational databases are the **only source of truth**.
- AR-18: AI agents must never write directly to read models or caches.
- AR-19: Read models are materialized exclusively from events.
- AR-20: Cache is an optimization only and must follow cache-aside with fallback.

---

## 6. Event-Driven Architecture

- AR-21: Domain events represent facts that already happened (past tense).
- AR-22: Events are immutable and versioned.
- AR-23: The Outbox Pattern is mandatory for event publishing.
- AR-24: Event consumers must be idempotent and replay-safe.
- AR-25: CorrelationId and CausationId must be propagated across events.

---

## 7. Error Handling & Result Model

- AR-26: Exceptions must not be used for control flow.
- AR-27: Application boundaries must return typed Result objects.
- AR-28: Errors must be explicit, categorized and deterministic.
- AR-29: Infrastructure exceptions must be translated before leaving infrastructure.

---

## 8. API & Contract Rules

- AR-30: APIs must be explicitly versioned.
- AR-31: Backward compatibility is mandatory.
- AR-32: Correlation IDs must propagate across requests and responses.
- AR-33: Contracts must be stable and documented.

---

## 9. Observability & Auditability

- AR-34: Structured logging is mandatory.
- AR-35: Trace context must propagate across async boundaries.
- AR-36: Business-critical flows must emit metrics.
- AR-37: Sensitive data must never be logged.

---

## 10. Resilience & Safety

- AR-38: External calls must enforce timeouts.
- AR-39: Retries must be bounded and explicit.
- AR-40: Circuit breakers must be respected.
- AR-41: Graceful degradation must be preferred over failure.

---

## 11. Naming & Conventions

- AR-42: Naming must follow the Naming & Conventions Standard (Core + Stack Profile).
- AR-43: Events must use past tense naming.
- AR-44: Generic names such as `Utils`, `Helpers` or `Common` are forbidden.

---

## 12. Testing Expectations

- AR-45: Domain logic must be unit-testable.
- AR-46: Infrastructure changes require integration tests.
- AR-47: Existing tests must not be removed or weakened.

---

## 13. Versioning & Evolution

- AR-48: Breaking changes require new versions.
- AR-49: Deprecated code must be clearly marked.
- AR-50: Architectural deviations require ADR approval.

---

## 14. Git, PR & CI Compliance

- AR-51: AI agents must follow Git Flow & Release Governance rules.
- AR-52: AI agents must not reference AI, automation or agents in commit messages.
- AR-53: AI agents must respect PR checklists and CI quality gates.
- AR-54: Every repository adopting the governance overlay MUST include a `AGENTS.md` at the root. This file is loaded automatically by Codex CLI before any action, ensuring governance rules override tool defaults (e.g., preventing AI co-authorship trailers). Use the template at `.enterprise/tooling/AGENTS.md.template`.
- AR-55: AI agents must **never** delete branches (`git branch -d`, `git branch -D`, `git push origin --delete`) without explicit user authorization.
- AR-56: AI agents must **never** delete or remove repositories without explicit user authorization.

---

## 15. Explicit Prohibitions

AI agents must **never**:
- Introduce new architectural patterns without approval
- Bypass persistence, outbox, idempotency or versioning rules
- Perform cross-context refactors implicitly
- Generate undocumented breaking changes
- Delete branches or repositories without explicit user authorization

---

## Summary

This document represents the **complete, enforceable and stack-aware Agent Rules Standard**.

AI agents operate under strict governance to ensure:
- architectural integrity
- consistency across stacks
- long-term maintainability
- safe AI-assisted engineering

**Non-compliance is considered a blocking violation.**
