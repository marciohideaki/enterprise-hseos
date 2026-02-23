# Java — Non-Functional Requirements (NFR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Generic / Project-agnostic
**Runtime:** Java 21+ / Spring Boot 3+

> Defines **non-functional requirements** for Java backends — how the platform must behave in terms of quality attributes.

---

## Referenced Platform Standards (MANDATORY)

- **Java Architecture Standard**
- **Naming & Conventions Standard** (Backend Profile)
- **Data Contracts & Schema Evolution Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Resilience Patterns Standard**
- **Deprecation & Sunset Policy**

---

## 1. Performance

- NFR-01: Critical endpoints must meet defined latency SLOs (p99 < agreed threshold per service).
- NFR-02: All IO must be non-blocking where applicable — use Spring WebFlux or Virtual Threads (Java 21).
- NFR-03: Read-heavy paths must use read models and cache to reduce write DB load.
- NFR-04: JVM startup must be minimized — prefer lazy bean initialization in production.
- NFR-05: GC tuning must be documented for services with high allocation rates.

---

## 2. Scalability

- NFR-06: API services must be **stateless** and horizontally scalable.
- NFR-07: Background workers must scale independently from API nodes.
- NFR-08: Read models must scale independently from write model.
- NFR-09: Cache layers (Redis/Caffeine) must support bounded resource usage.
- NFR-10: Connection pools (DB, broker, HTTP) must be sized and monitored.

---

## 3. Availability & Reliability

- NFR-11: Services must support high availability via multiple instances.
- NFR-12: Graceful degradation required for partial dependency failures.
- NFR-13: No single dependency failure may crash the entire service.
- NFR-14: RTO and RPO must be defined and documented per service.

---

## 4. Consistency & Data Integrity

- NFR-15: Strong consistency guaranteed within aggregate transactions.
- NFR-16: Eventual consistency explicitly assumed across bounded contexts.
- NFR-17: Distributed transactions forbidden — use Saga Pattern.
- NFR-18: Expand-contract database migrations mandatory (Flyway/Liquibase).
- NFR-19: Read models must be rebuildable without data loss.

---

## 5. Resilience & Fault Tolerance

- NFR-20: All external calls must have explicit timeouts (Resilience4j `TimeLimiter`).
- NFR-21: Retries bounded with exponential backoff and jitter (Resilience4j `Retry`).
- NFR-22: Circuit breakers mandatory for unstable dependencies (Resilience4j `CircuitBreaker`).
- NFR-23: Bulkhead isolation required for critical path dependencies (Resilience4j `Bulkhead`).
- NFR-24: Poison messages routed to DLQ — never cause consumer crash loops.

---

## 6. Security

- NFR-25: All traffic encrypted in transit (TLS 1.2+, prefer TLS 1.3).
- NFR-26: Sensitive data encrypted at rest.
- NFR-27: Secrets externalized — never in `application.properties` or source code.
- NFR-28: Least privilege enforced for service accounts and database users.
- NFR-29: Dependency scanning (OWASP Dependency-Check or Snyk) mandatory in CI.

---

## 7. Privacy & Compliance

- NFR-30: Personal data handling follows applicable privacy regulations (GDPR/LGPD).
- NFR-31: Logs must never contain PII or secrets.
- NFR-32: Data minimization enforced — no storing unnecessary personal data.
- NFR-33: Audit trails required for security-relevant and financially-relevant operations.

---

## 8. Observability

- NFR-34: Structured JSON logs via SLF4J — mandatory in staging and production.
- NFR-35: Micrometer metrics with Prometheus exporter — standard label set.
- NFR-36: Distributed tracing (OpenTelemetry) end-to-end across all services.
- NFR-37: `correlationId` propagated via MDC and outbound headers.
- NFR-38: SLIs and SLOs defined and monitored for critical flows.

---

## 9. Maintainability

- NFR-39: Code follows Clean/Hexagonal Architecture — enforced via ArchUnit tests.
- NFR-40: Checkstyle, PMD, SpotBugs configured and enforced in CI.
- NFR-41: Architectural deviations require ADR approval.
- NFR-42: Cyclomatic complexity monitored and bounded.

---

## 10. Testability

- NFR-43: Domain and Application logic unit-testable with JUnit 5 + Mockito.
- NFR-44: Infrastructure integration-testable with TestContainers.
- NFR-45: API contracts testable via MockMvc / REST-assured.
- NFR-46: Tests deterministic — no `Thread.sleep`, no `new Date()`, use clock abstraction.
- NFR-47: Minimum 80% line coverage on Application layer, 90% on Domain layer.

---

## 11. Deployability & Backward Compatibility

- NFR-48: Deployments backward-compatible — rolling deploy must not break running consumers.
- NFR-49: DB migrations follow expand-contract pattern (Flyway/Liquibase).
- NFR-50: Events remain backward-compatible; breaking changes require new event types.
- NFR-51: Rollback procedure documented and tested for every High-risk release.

---

## 12. Operability

- NFR-52: Spring Actuator health endpoints mandatory (`/liveness`, `/readiness`).
- NFR-53: Graceful shutdown configured (`server.shutdown=graceful`).
- NFR-54: Config externalized via Spring profiles and environment variables.
- NFR-55: Runbooks must exist for common incident scenarios.

---

## 13. AI-Assisted Engineering

- NFR-56: AI-generated code must comply with architecture, persistence, and messaging rules.
- NFR-57: AI usage must not bypass security or quality gates.
- NFR-58: Templates and scaffolding must exist to constrain AI-generated code.

---

## Summary

These NFRs define the quality bar for Java/Spring Boot platforms: performant, scalable, secure, resilient, observable, and maintainable at enterprise scale.
