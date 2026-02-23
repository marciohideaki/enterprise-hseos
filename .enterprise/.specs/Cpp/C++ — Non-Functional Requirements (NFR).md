# C++ — Non-Functional Requirements (NFR)
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Generic / Project-agnostic
**Runtime:** C++20 / C++23 | CMake 3.28+

> Defines **non-functional requirements** for C++ backends and services.

---

## Referenced Platform Standards (MANDATORY)

- **C++ Architecture Standard**
- **Naming & Conventions Standard** (Backend Profile)
- **Data Contracts & Schema Evolution Standard**
- **Security & Identity Standard**
- **Observability Playbook**
- **Resilience Patterns Standard**

---

## 1. Performance

- NFR-01: Critical endpoints must meet defined latency SLOs (p99 < agreed threshold per service).
- NFR-02: All IO must be non-blocking where applicable — use async IO (Boost.Asio or Drogon coroutines).
- NFR-03: Read-heavy paths must use read models and cache to reduce DB load.
- NFR-04: Binary startup must be minimized — profile with `perf` or `gprof` as needed.
- NFR-05: Hot paths profiled with `perf`/`valgrind`/`heaptrack` — allocation-free where feasible.

---

## 2. Scalability

- NFR-06: API services must be stateless and horizontally scalable.
- NFR-07: Background workers scale independently from API nodes.
- NFR-08: Read models scale independently from write model.
- NFR-09: Cache layers (Redis) support bounded resource usage.
- NFR-10: DB and HTTP connection pools sized and monitored.

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
- NFR-18: Expand-contract database migrations mandatory.
- NFR-19: Read models must be rebuildable without data loss.

---

## 5. Resilience & Fault Tolerance

- NFR-20: All external calls have explicit timeouts.
- NFR-21: Retries bounded with exponential backoff and jitter.
- NFR-22: Circuit breakers for unstable dependencies.
- NFR-23: Bulkhead isolation via bounded thread pools.
- NFR-24: Poison messages routed to DLQ — never cause consumer crash loops.

---

## 6. Security

- NFR-25: All traffic encrypted in transit (TLS 1.2+, prefer TLS 1.3 via OpenSSL/BoringSSL).
- NFR-26: Sensitive data encrypted at rest.
- NFR-27: Secrets externalized — never in source code or config files committed to VCS.
- NFR-28: Least privilege enforced for service accounts and database users.
- NFR-29: Dependency scanning via `vcpkg audit`, `conan-center` security feed, or Snyk mandatory in CI.

---

## 7. Memory Safety

- NFR-30: No raw owning pointers (`T*`) — use `std::unique_ptr`/`std::shared_ptr`.
- NFR-31: No `new`/`delete` outside smart pointer construction.
- NFR-32: RAII mandatory for all resources (files, sockets, mutexes, DB connections).
- NFR-33: AddressSanitizer (ASan) and UndefinedBehaviorSanitizer (UBSan) enabled in CI test builds.
- NFR-34: No buffer overflows — use `std::span`, `std::string_view`, bounds-checked containers.

---

## 8. Privacy & Compliance

- NFR-35: Personal data handling follows applicable privacy regulations (GDPR/LGPD).
- NFR-36: Logs must never contain PII or secrets.
- NFR-37: Data minimization enforced — no storing unnecessary personal data.
- NFR-38: Audit trails required for security-relevant and financially-relevant operations.

---

## 9. Observability

- NFR-39: Structured JSON logs via `spdlog` — mandatory in staging and production.
- NFR-40: Prometheus metrics with standard label set.
- NFR-41: Distributed tracing (OpenTelemetry C++ SDK) end-to-end.
- NFR-42: `correlationId` propagated via request context and outbound headers.
- NFR-43: SLIs and SLOs defined for critical flows.

---

## 10. Maintainability

- NFR-44: Code follows Clean/Hexagonal Architecture — enforced via CMake target dependencies.
- NFR-45: `clang-tidy` and `clang-format` enforced in CI — zero warnings policy.
- NFR-46: Architectural deviations require ADR approval.
- NFR-47: Cyclomatic complexity bounded — monitored via `lizard` or `cppcheck`.

---

## 11. Testability

- NFR-48: Domain and Application logic unit-testable with Google Test or Catch2 — no infrastructure required.
- NFR-49: Infrastructure integration-testable with Testcontainers-cpp or real infra in CI.
- NFR-50: API contracts testable via HTTP client fixtures.
- NFR-51: Tests deterministic — no `std::chrono::system_clock::now()` direct calls; use clock abstraction.
- NFR-52: Minimum 80% line coverage on Application layer, 90% on Domain layer (gcov/llvm-cov).

---

## 12. Deployability & Backward Compatibility

- NFR-53: Deployments backward-compatible — rolling deploy must not break running consumers.
- NFR-54: DB migrations follow expand-contract pattern.
- NFR-55: Events remain backward-compatible; breaking changes require new event types.
- NFR-56: Rollback procedure documented and tested for every high-risk release.

---

## 13. Operability

- NFR-57: Health endpoints mandatory (`/health/liveness`, `/health/readiness`).
- NFR-58: Graceful shutdown via signal handler (`SIGTERM`) — drain in-flight requests.
- NFR-59: Config externalized via environment variables and secret managers.
- NFR-60: Runbooks must exist for common incident scenarios.

---

## 14. Build & Toolchain

- NFR-61: Builds must be reproducible — pinned dependency versions (Conan lock or vcpkg baseline).
- NFR-62: Parallel builds supported — CMake targets designed for `cmake --build . -j`.
- NFR-63: Incremental builds fast — avoid unnecessary header dependencies (use forward declarations).
- NFR-64: Debug and Release build types maintained — no debug code in Release path.

---

## 15. AI-Assisted Engineering

- NFR-65: AI-generated code must comply with architecture, memory management, and error handling rules.
- NFR-66: AI usage must not bypass security or quality gates.
- NFR-67: Templates and scaffolding must exist to constrain AI-generated code.

---

## Summary

These NFRs define the quality bar for C++ backend platforms: performant, memory-safe, scalable, secure, resilient, observable, and maintainable at enterprise scale.
