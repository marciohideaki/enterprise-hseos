# Go — Pull Request Checklist
## Go — Gold Standard

> Mandatory for all Go pull requests.
> A PR must not be approved if any required item is not satisfied.

---

## 1. General

- [ ] PR has a clear title and description (what and why).
- [ ] PR scope is small and focused — no unrelated changes.
- [ ] PR references a ticket or story.
- [ ] Breaking changes explicitly documented with `⚠ BREAKING:` prefix.

---

## 2. Architecture Compliance

- [ ] Domain layer has zero external library imports (stdlib only).
- [ ] Domain layer has zero DB/ORM imports.
- [ ] Application layer uses Port interfaces — no direct Infrastructure type references.
- [ ] Infrastructure adapters implement Application ports — no business logic.
- [ ] No cross-module internal imports introduced.
- [ ] Any deviation backed by an approved ADR.

---

## 3. CQRS & Use Case Organization

- [ ] New use cases follow Command/Query separation.
- [ ] Handler grouped with its Command/Query/Result — not scattered.
- [ ] No state mutations inside Query handlers.
- [ ] Commands are idempotent or have idempotency key enforcement.

---

## 4. Persistence & Messaging

- [ ] SQL row structs live in Infrastructure — not in Domain.
- [ ] Domain objects and DB structs mapped explicitly.
- [ ] Migration file added for schema changes (`goose` or `golang-migrate`).
- [ ] Migrations follow expand-contract pattern.
- [ ] Outbox Pattern used for event publishing.
- [ ] Event consumers are idempotent.
- [ ] Dead-letter handling present for consumers.

---

## 5. Networking & Resilience

- [ ] All outbound HTTP calls use the Core Networking Package.
- [ ] No direct `http.Get` / `http.Client{}` outside the package.
- [ ] Resilience configuration (timeout, retry, circuit breaker) is externalized.
- [ ] No hardcoded timeout or retry values.
- [ ] `context.WithTimeout` used for all external calls.

---

## 6. Error Handling

- [ ] `Result[T]` or typed errors used at application boundaries.
- [ ] No `panic` used for control flow.
- [ ] Errors wrapped with `fmt.Errorf("context: %w", err)` at layer boundaries.
- [ ] API error envelope follows RFC 9457 Problem Details (or project standard).
- [ ] All returned errors checked — no `_` discards without justification.

---

## 7. Concurrency

- [ ] No data races (verified by `-race` flag in CI).
- [ ] All goroutines have explicit lifecycle management (WaitGroup, context cancellation).
- [ ] No goroutine leaks.
- [ ] Shared state protected by mutex or channel.

---

## 8. Security & Privacy

- [ ] No secrets, tokens, or credentials in source or config files.
- [ ] All new endpoints have authorization configured.
- [ ] No public endpoints without documented justification.
- [ ] No PII or sensitive data in logs.
- [ ] New dependencies reviewed for CVEs (`govulncheck`).

---

## 9. Testing

- [ ] Domain logic covered by unit tests — no external deps required.
- [ ] Use case handlers covered by unit tests with mocked ports.
- [ ] Infrastructure adapters covered by integration tests (testcontainers-go).
- [ ] API layer covered by `net/http/httptest` tests.
- [ ] No skipped tests without linked ticket.
- [ ] Coverage not decreased vs baseline.

---

## 10. Observability

- [ ] New endpoints/operations emit structured logs with `correlationId`.
- [ ] No PII or secrets in log statements.
- [ ] New operations tracked in metrics.
- [ ] Spans created for significant operations.

---

## 11. Code Quality & Conventions

- [ ] `golangci-lint` passes with zero warnings.
- [ ] `go vet` passes.
- [ ] `go-arch-lint` architecture checks pass.
- [ ] Naming follows Go profile of Naming & Conventions Standard.
- [ ] GoDoc comments on all exported types and functions.
- [ ] No dead code or commented-out logic.

---

## 12. API & Contracts

- [ ] OpenAPI spec updated for new/changed endpoints.
- [ ] New API version created for breaking changes.
- [ ] Event schema versioned for breaking changes.
- [ ] CHANGELOG updated.

---

## 13. AI-Assisted Development

- [ ] AI-generated code follows all architectural standards.
- [ ] AI output reviewed and validated by a human.
- [ ] No sensitive data shared with AI tools.

---

## Final Declaration

- [ ] I confirm this PR fully complies with the Go Architecture Standard, FR, NFR.
- [ ] Non-compliant PRs may be rejected regardless of functionality.

---

## Reviewer Notes

- Architecture compliance: ⬜ Yes ⬜ No
- Tests reviewed: ⬜ Yes ⬜ No
- Security reviewed: ⬜ Yes ⬜ No
- Race condition check: ⬜ Yes ⬜ No
- Ready to merge: ⬜ Yes ⬜ No
