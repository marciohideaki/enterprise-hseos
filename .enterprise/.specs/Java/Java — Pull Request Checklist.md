# Java — Pull Request Checklist
## Java / Spring Boot — Gold Standard

> Mandatory for all Java pull requests.
> A PR must not be approved if any required item is not satisfied.

---

## 1. General

- [ ] PR has a clear title and description (what and why).
- [ ] PR scope is small and focused — no unrelated changes.
- [ ] PR references a ticket or story.
- [ ] Breaking changes explicitly documented with `⚠ BREAKING:` prefix.

---

## 2. Architecture Compliance

- [ ] Domain layer has zero Spring annotations (`@Component`, `@Entity`, `@Autowired`, etc.).
- [ ] Domain layer has zero JPA / persistence imports.
- [ ] Application layer uses Port interfaces — no direct Infrastructure type references.
- [ ] Infrastructure adapters implement Application ports — no business logic.
- [ ] No cross-module internal imports introduced.
- [ ] Any deviation backed by an approved ADR.

---

## 3. CQRS & Use Case Organization

- [ ] New use cases follow Command/Query separation.
- [ ] Handler grouped with its Command/Query/Result/Validator — not scattered.
- [ ] No `@Transactional` inside Domain layer.
- [ ] Commands are idempotent or have idempotency key enforcement.

---

## 4. Persistence & Messaging

- [ ] JPA `@Entity` classes live in Infrastructure — not in Domain.
- [ ] Domain objects and JPA entities mapped explicitly (no shared types).
- [ ] Flyway/Liquibase migration script added for schema changes.
- [ ] Migrations follow expand-contract pattern.
- [ ] Outbox Pattern used for event publishing.
- [ ] Event consumers are idempotent.
- [ ] Dead-letter handling present for consumers.

---

## 5. Networking & Resilience

- [ ] All outbound HTTP calls use the Core Networking Package.
- [ ] No direct `RestTemplate`, `WebClient`, or `HttpClient` usage outside the package.
- [ ] Resilience4j configuration (timeout, retry, circuit breaker) is externalized.
- [ ] No hardcoded timeout or retry values.

---

## 6. Error Handling

- [ ] `Result<T>` or equivalent used at application boundaries.
- [ ] No `RuntimeException` used for control flow.
- [ ] Infrastructure exceptions caught and mapped before crossing layers.
- [ ] API error envelope follows RFC 9457 Problem Details (or project standard).

---

## 7. Security & Privacy

- [ ] No secrets, tokens, or credentials in source or config files.
- [ ] All new endpoints have authorization configured.
- [ ] No `permitAll()` without documented justification.
- [ ] No PII or sensitive data in logs.
- [ ] New dependencies reviewed for CVEs.

---

## 8. Testing

- [ ] Domain logic covered by unit tests (JUnit 5 + Mockito).
- [ ] Use case handlers covered by unit tests with mocked ports.
- [ ] Infrastructure adapters covered by integration tests (TestContainers).
- [ ] API layer covered by MockMvc or REST-assured tests.
- [ ] No skipped tests without linked ticket.
- [ ] Coverage not decreased vs baseline.

---

## 9. Observability

- [ ] New endpoints/operations emit structured logs with `correlationId`.
- [ ] No PII or secrets in log statements.
- [ ] New operations tracked in metrics.
- [ ] Spans created for significant operations.

---

## 10. Code Quality & Conventions

- [ ] Checkstyle passes.
- [ ] PMD and SpotBugs pass.
- [ ] ArchUnit architecture tests pass.
- [ ] Naming follows Java profile of Naming & Conventions Standard.
- [ ] Javadoc on all new public classes and methods.
- [ ] No dead code or commented-out logic.

---

## 11. API & Contracts

- [ ] OpenAPI spec updated for new/changed endpoints.
- [ ] New API version created for breaking changes.
- [ ] Event schema versioned for breaking changes.
- [ ] CHANGELOG updated.

---

## 12. AI-Assisted Development

- [ ] AI-generated code follows all architectural standards.
- [ ] AI output reviewed and validated by a human.
- [ ] No sensitive data shared with AI tools.

---

## Final Declaration

- [ ] I confirm this PR fully complies with the Java Architecture Standard, FR, NFR.
- [ ] Non-compliant PRs may be rejected regardless of functionality.

---

## Reviewer Notes

- Architecture compliance: ⬜ Yes ⬜ No
- Tests reviewed: ⬜ Yes ⬜ No
- Security reviewed: ⬜ Yes ⬜ No
- Ready to merge: ⬜ Yes ⬜ No
