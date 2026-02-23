# PHP — Non-Functional Requirements (NFR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Generic / Project-agnostic
**Runtime:** PHP 8.3+ / Laravel 11+ or Symfony 7+

> Defines **non-functional requirements** for PHP backends.

---

## Referenced Platform Standards (MANDATORY)

- **PHP Architecture Standard**
- **Naming & Conventions Standard** (Backend Profile)
- **Data Contracts & Schema Evolution Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Resilience Patterns Standard**

---

## 1. Performance

- NFR-01: Critical endpoints must meet defined latency SLOs (p99 < agreed threshold per service).
- NFR-02: PHP-FPM worker pools sized per workload — tuned and documented.
- NFR-03: Read-heavy paths must use read models and Redis cache to reduce DB load.
- NFR-04: OPcache enabled and tuned in staging and production.
- NFR-05: Long-running PHP processes use Laravel Octane (Swoole/RoadRunner) where beneficial.

---

## 2. Scalability

- NFR-06: API services must be stateless and horizontally scalable.
- NFR-07: Queue workers scale independently from API nodes.
- NFR-08: Read models scale independently from write model.
- NFR-09: Cache layers (Redis) support bounded resource usage.
- NFR-10: DB connection pools sized and monitored.

---

## 3. Availability & Reliability

- NFR-11: Services support high availability via multiple instances.
- NFR-12: Graceful degradation required for partial dependency failures.
- NFR-13: No single dependency failure crashes the entire service.
- NFR-14: RTO and RPO defined and documented per service.

---

## 4. Consistency & Data Integrity

- NFR-15: Strong consistency guaranteed within aggregate transactions.
- NFR-16: Eventual consistency explicitly assumed across bounded contexts.
- NFR-17: Distributed transactions forbidden — use Saga Pattern.
- NFR-18: Expand-contract database migrations mandatory (Laravel Migrations).
- NFR-19: Read models must be rebuildable without data loss.

---

## 5. Resilience & Fault Tolerance

- NFR-20: All external calls have explicit timeouts.
- NFR-21: Retries bounded with exponential backoff and jitter.
- NFR-22: Circuit breakers for unstable dependencies.
- NFR-23: Bulkhead isolation for critical path dependencies.
- NFR-24: Poison messages routed to DLQ — never cause consumer crash loops.

---

## 6. Security

- NFR-25: All traffic encrypted in transit (TLS 1.2+, prefer TLS 1.3).
- NFR-26: Sensitive data encrypted at rest.
- NFR-27: Secrets externalized — never in `.env` committed to source control.
- NFR-28: Least privilege enforced for service accounts and database users.
- NFR-29: Composer audit + Snyk/OWASP dependency scanning mandatory in CI.

---

## 7. Privacy & Compliance

- NFR-30: Personal data handling follows applicable privacy regulations (GDPR/LGPD).
- NFR-31: Logs must never contain PII or secrets.
- NFR-32: Data minimization enforced — no storing unnecessary personal data.
- NFR-33: Audit trails required for security-relevant and financially-relevant operations.

---

## 8. Observability

- NFR-34: Structured JSON logs via Monolog — mandatory in staging and production.
- NFR-35: Prometheus metrics with standard label set.
- NFR-36: Distributed tracing (OpenTelemetry) end-to-end.
- NFR-37: `correlationId` propagated via logging context and outbound headers.
- NFR-38: SLIs and SLOs defined for critical flows.

---

## 9. Maintainability

- NFR-39: Code follows Clean/Hexagonal Architecture — enforced via Deptrac or PHPArkitect.
- NFR-40: PHPStan level 8+ and PHP_CodeSniffer (PSR-12) enforced in CI.
- NFR-41: Architectural deviations require ADR approval.
- NFR-42: Cyclomatic complexity monitored via PHPMD.

---

## 10. Testability

- NFR-43: Domain and Application logic unit-testable with PHPUnit — no framework required.
- NFR-44: Infrastructure integration-testable with SQLite in-memory or Testcontainers.
- NFR-45: API contracts testable via Laravel HTTP tests or Symfony WebTestCase.
- NFR-46: Tests deterministic — no `sleep()`, no `time()` direct calls; use clock abstraction.
- NFR-47: Minimum 80% line coverage on Application layer, 90% on Domain layer.

---

## 11. Deployability & Backward Compatibility

- NFR-48: Deployments backward-compatible — rolling deploy must not break running consumers.
- NFR-49: DB migrations follow expand-contract pattern.
- NFR-50: Events remain backward-compatible; breaking changes require new event types.
- NFR-51: Rollback procedure documented and tested for every high-risk release.

---

## 12. Operability

- NFR-52: Health endpoints mandatory (`/health/liveness`, `/health/readiness`).
- NFR-53: Graceful shutdown configured for PHP-FPM and queue workers.
- NFR-54: Config externalized via environment variables and secret managers.
- NFR-55: Runbooks must exist for common incident scenarios.

---

## 13. AI-Assisted Engineering

- NFR-56: AI-generated code must comply with architecture, persistence, and messaging rules.
- NFR-57: AI usage must not bypass security or quality gates.
- NFR-58: Templates and scaffolding must exist to constrain AI-generated code.

---

## Summary

These NFRs define the quality bar for PHP/Laravel & PHP/Symfony platforms: performant, scalable, secure, resilient, observable, and maintainable at enterprise scale.
