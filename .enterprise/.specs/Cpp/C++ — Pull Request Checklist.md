# C++ — Pull Request Checklist
## C++ — Gold Standard

> Mandatory for all C++ pull requests.
> A PR must not be approved if any required item is not satisfied.

---

## 1. General

- [ ] PR has a clear title and description (what and why).
- [ ] PR scope is small and focused — no unrelated changes.
- [ ] PR references a ticket or story.
- [ ] Breaking changes explicitly documented with `⚠ BREAKING:` prefix.

---

## 2. Architecture Compliance

- [ ] Domain layer has zero external library `#include`s (stdlib only).
- [ ] Domain layer has zero DB/ORM headers.
- [ ] Application layer uses Port interfaces (abstract base classes) — no direct Infrastructure type references.
- [ ] Infrastructure implementations inherit from Application port interfaces — no business logic.
- [ ] No cross-module includes violating dependency rule (enforced via CMake target deps).
- [ ] Any deviation backed by an approved ADR.

---

## 3. CQRS & Use Case Organization

- [ ] New use cases follow Command/Query separation.
- [ ] Handler grouped with its Command/Query/Result — not scattered.
- [ ] No state mutations inside Query handlers.
- [ ] Commands are idempotent or have idempotency key enforcement.

---

## 4. Persistence & Messaging

- [ ] DB row structs live in Infrastructure — not in Domain.
- [ ] Domain objects and DB structs mapped explicitly — no shared types.
- [ ] Migration file added for schema changes.
- [ ] Migrations follow expand-contract pattern.
- [ ] Outbox Pattern used for event publishing.
- [ ] Event consumers are idempotent.
- [ ] Dead-letter handling present for consumers.

---

## 5. Networking & Resilience

- [ ] All outbound HTTP calls use the Core Networking Package.
- [ ] No direct `libcurl`, `cpp-httplib`, or raw socket usage outside the package.
- [ ] Resilience configuration (timeout, retry, circuit breaker) is externalized.
- [ ] No hardcoded timeout or retry values.

---

## 6. Memory Safety

- [ ] No raw owning pointers (`T*`) — `std::unique_ptr`/`std::shared_ptr` used.
- [ ] No `new`/`delete` outside smart pointer construction.
- [ ] RAII used for all resource management.
- [ ] All `[[nodiscard]]` results are handled — no silent discards.
- [ ] No buffer overflows — `std::span` / bounds-checked containers used.

---

## 7. Error Handling

- [ ] `std::expected<T,E>` or `Result<T>` used at application boundaries.
- [ ] No `throw`/`catch` used for control flow.
- [ ] Infrastructure exceptions caught and mapped before crossing layers.
- [ ] API error envelope follows RFC 9457 Problem Details (or project standard).
- [ ] No `abort()` or `std::terminate()` without documented justification.

---

## 8. Concurrency

- [ ] No data races (verified by ThreadSanitizer in CI).
- [ ] All shared state protected by `std::mutex`/`std::shared_mutex` or `std::atomic`.
- [ ] All threads have explicit lifecycle management — no detached threads without documentation.
- [ ] No deadlock potential — lock ordering documented where multiple mutexes acquired.

---

## 9. Security & Privacy

- [ ] No secrets, tokens, or credentials in source or config files.
- [ ] All new endpoints have authorization configured.
- [ ] No public endpoints without documented justification.
- [ ] No PII or sensitive data in logs.
- [ ] New dependencies reviewed for CVEs (Conan audit / vcpkg security feed).

---

## 10. Testing

- [ ] Domain logic covered by unit tests (Google Test/Catch2) — no infrastructure deps required.
- [ ] Use case handlers covered by unit tests with mocked ports (Google Mock).
- [ ] Infrastructure adapters covered by integration tests.
- [ ] API layer covered by HTTP client fixture tests.
- [ ] No skipped tests without linked ticket.
- [ ] Coverage not decreased vs baseline (gcov/llvm-cov).

---

## 11. Sanitizer Checks

- [ ] AddressSanitizer (ASan) build passes.
- [ ] UndefinedBehaviorSanitizer (UBSan) build passes.
- [ ] ThreadSanitizer (TSan) build passes for concurrent code.
- [ ] No `// NOLINT` suppressions without documented justification.

---

## 12. Observability

- [ ] New endpoints/operations emit structured logs with `correlationId`.
- [ ] No PII or secrets in log statements.
- [ ] New operations tracked in metrics.
- [ ] Spans created for significant operations.

---

## 13. Code Quality & Conventions

- [ ] `clang-tidy` passes with zero warnings.
- [ ] `clang-format` check passes.
- [ ] CMake targets correctly declare dependencies (no hidden includes).
- [ ] Naming follows C++ profile of Naming & Conventions Standard.
- [ ] Doxygen comments on all new public classes and methods.
- [ ] No dead code or commented-out logic.
- [ ] No `reinterpret_cast` or `const_cast` without documented justification.

---

## 14. API & Contracts

- [ ] OpenAPI spec updated for new/changed endpoints.
- [ ] New API version created for breaking changes.
- [ ] Event schema versioned for breaking changes.
- [ ] CHANGELOG updated.

---

## 15. AI-Assisted Development

- [ ] AI-generated code follows all architectural standards.
- [ ] AI output reviewed and validated by a human.
- [ ] No sensitive data shared with AI tools.
- [ ] AI-generated memory management patterns verified manually.

---

## Final Declaration

- [ ] I confirm this PR fully complies with the C++ Architecture Standard, FR, NFR.
- [ ] Non-compliant PRs may be rejected regardless of functionality.

---

## Reviewer Notes

- Architecture compliance: ⬜ Yes ⬜ No
- Memory safety reviewed: ⬜ Yes ⬜ No
- Concurrency reviewed: ⬜ Yes ⬜ No
- Tests reviewed: ⬜ Yes ⬜ No
- Security reviewed: ⬜ Yes ⬜ No
- Sanitizer checks: ⬜ Yes ⬜ No
- Ready to merge: ⬜ Yes ⬜ No
