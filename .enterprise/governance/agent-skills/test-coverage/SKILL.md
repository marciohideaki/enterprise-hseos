---
name: test-coverage
description: "Use when auditing test coverage completeness, test pyramid violations, or test quality across a module, service, or pull request"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Test Coverage

## When to use
Use this skill when:
- reviewing a PR for test adequacy
- generating tests for new code
- auditing a module's test coverage
- establishing coverage baselines for a new service

---

## 1. Coverage Thresholds

- TC-01: Overall line/branch coverage MUST NOT decrease on a PR — the baseline is the pre-PR measurement.
- TC-02: **Domain layer** coverage target: ≥ 90% (business logic is the highest-value target).
- TC-03: **Application layer** coverage target: ≥ 80% (use case orchestration must be tested).
- TC-04: **Infrastructure layer** coverage target: ≥ 60% (adapters tested via integration tests, not unit).
- TC-05: **Delivery/API layer** coverage target: ≥ 70% (contract and integration tests cover most of this).
- TC-06: Coverage targets are minimums — teams should aspire to higher where feasible.
- TC-07: Coverage exclusions (generated code, migrations, DI setup) MUST be explicitly configured and documented.

---

## 2. Test Pyramid

### 2.1 Unit Tests (Base — highest volume)
- TC-08: Domain layer MUST be covered primarily by unit tests — no infrastructure dependencies.
- TC-09: Application layer use cases MUST have unit tests using mocked ports (interfaces).
- TC-10: Each command handler, query handler, and domain service MUST have at minimum one unit test.
- TC-11: All domain invariants MUST have explicit tests covering valid and invalid states.
- TC-12: Edge cases and error paths MUST be tested, not just happy paths.

### 2.2 Integration Tests (Middle — moderate volume)
- TC-13: Each infrastructure adapter (repository, event publisher, HTTP client) MUST have integration tests against real or containerized dependencies.
- TC-14: Database integration tests MUST cover create, read, update, and transactional boundaries.
- TC-15: Outbox pattern and event publishing MUST be integration-tested.

### 2.3 Contract Tests (Middle — targeted)
- TC-16: New or changed HTTP API endpoints SHOULD have contract tests verifying request/response shape.
- TC-17: New or changed event schemas SHOULD have schema validation tests in CI.
- TC-18: Consumer-driven contract tests are recommended for services with multiple known consumers.

### 2.4 End-to-End Tests (Top — low volume, high confidence)
- TC-19: Critical user journeys SHOULD have end-to-end tests.
- TC-20: E2E tests MUST NOT be the primary coverage strategy — they are the last resort.

---

## 3. Test Quality Standards

- TC-21: Test names MUST be descriptive and follow a naming convention:
  - `Given_<state>_When_<action>_Then_<outcome>` (xUnit style)
  - `should_<behavior>_when_<condition>` (BDD style)
  - Either is acceptable; consistency within a project is mandatory.
- TC-22: Each test MUST verify **one logical behavior** — avoid multi-assertion tests that obscure failure location.
- TC-23: Tests MUST be **deterministic** — same input always produces same output:
  - No random data without seeded generators
  - No `DateTime.Now` / `new Date()` without injectable clock abstraction
  - No network calls without mocks or test doubles
- TC-24: Tests MUST NOT depend on execution order — each test is self-contained.
- TC-25: No skipped or `@Ignore`/`[Skip]` tests without a linked ticket explaining why.
- TC-26: No commented-out tests — delete them or restore them.

---

## 4. Test Data Management

- TC-27: Test data MUST use builders, factories, or fixtures — avoid large inline object literals.
- TC-28: Test data MUST NOT contain real PII — use synthetic data generators.
- TC-29: Database state MUST be reset between integration tests (transaction rollback, test containers, or seed scripts).

---

## 5. Stack-Specific Tooling Reference

| Stack | Unit Test Framework | Coverage Tool | Integration |
|---|---|---|---|
| C# / .NET | xUnit, NUnit | Coverlet | TestContainers.NET |
| Flutter / Dart | flutter_test | lcov | integration_test |
| React Native / TS | Jest | Istanbul/c8 | Detox, Supertest |
| Java | JUnit 5, TestNG | JaCoCo | TestContainers |
| Go | testing (stdlib) | go test -cover | TestContainers-go |
| PHP | PHPUnit | Xdebug/PCOV | DBUnit, Pest |

---

## 6. Test Generation Guidance

When generating tests for new code, follow this order:
1. Identify the **unit under test** and its dependencies
2. Write tests for **domain invariants first** (no mocks needed)
3. Write tests for **happy path** of use case handlers
4. Write tests for **error paths** and edge cases
5. Write integration tests for infrastructure adapters

Minimum test for a command handler:
- Happy path (valid input → expected outcome)
- Validation failure (invalid input → typed error)
- Domain rule violation (valid input, but business rule prevents it)

---

## Examples

✅ Good: `PlaceOrderHandler` has tests for: valid order, out-of-stock item, invalid customer, duplicate idempotency key.
✅ Good: `OrderRepository` has integration tests with TestContainers verifying save, find, and transactional rollback.

❌ Bad: New `ProcessPaymentHandler` with no tests — "will add later".
❌ Bad: Test named `Test1()` that asserts 5 unrelated things.
❌ Bad: Coverage at 45% after PR — below domain layer threshold.
