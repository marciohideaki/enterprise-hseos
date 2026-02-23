# Advanced Testing Strategy Standard
## Cross-Cutting — Mandatory

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — mandatory for all services with business logic
**Classification:** Cross-Cutting (Mandatory)

> Testing is not a phase — it is a design discipline.
> This standard defines how teams build confidence in software: through a deliberate strategy
> that combines pyramid discipline, TDD, BDD, contract verification, property-based validation,
> mutation scoring, and controlled chaos. Deviations require an approved ADR exception.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Hexagonal & Clean Architecture Standard**
- **Data Contracts & Schema Evolution Standard**
- **Observability Playbook**
- **Security & Identity Standard**
- **Data Governance & LGPD Standard**

---

## 1. Test Pyramid & Ratios

### 1.1 The Mandatory Pyramid

Every service with business logic MUST maintain a test suite that conforms to the following distribution:

| Layer | Target Ratio | Scope |
|---|---|---|
| **Unit** | 70% | Domain logic, application logic — no I/O |
| **Integration** | 20% | Real infrastructure (DB, broker) via Testcontainers |
| **E2E** | 10% | Critical happy paths and regulatory journeys only |

- AT-01: The test pyramid MUST NOT be inverted. A service where E2E count exceeds unit count is in **violation**.
- AT-02: Ratios are measured by test count, tracked per repository. CI reports pyramid shape on every run.
- AT-03: Unit tests MUST NOT perform any I/O — no network calls, no file system access, no database queries.
- AT-04: Unit tests MUST NOT start a container, process, or external service. Isolation is enforced at process boundary.
- AT-05: Integration tests MUST use real infrastructure provisioned via **Testcontainers** — no shared databases, no mocked repositories.
- AT-06: Integration tests MUST be isolated per test run. Each test bootstraps its own schema and tears it down.
- AT-07: E2E tests are limited to: (a) the single most critical happy path per feature, and (b) every journey mandated by a regulatory requirement (LGPD, PCI, SOC 2).
- AT-08: E2E tests MUST NOT be used as a substitute for missing unit or integration tests.

### 1.2 Mandatory Coverage Thresholds

- AT-09: Coverage gates are enforced per architectural layer — not per repository aggregate:

| Layer | Line Coverage | Branch Coverage |
|---|---|---|
| **Domain** | ≥ 90% | ≥ 85% |
| **Application** | ≥ 80% | ≥ 75% |
| **Infrastructure** | ≥ 60% | ≥ 55% |

- AT-10: Line coverage alone is **necessary but not sufficient**. Branch coverage is independently gated. A PR meeting line coverage but failing branch coverage is **blocked**.

---

## 2. TDD — Test-Driven Development

### 2.1 Scope of Mandatory TDD

- AT-11: TDD is **mandatory** for: domain entities, value objects, aggregates, domain services, application use cases, and any code implementing a business rule.
- AT-12: TDD is **not required** for: infrastructure boilerplate, framework configuration, database migrations, generated code, dependency wiring.
- AT-13: A PR that introduces or modifies domain logic without a corresponding failing test written first is **blocked**. The commit history must demonstrate Red-Green-Refactor order (test commit precedes implementation commit).

### 2.2 The Red-Green-Refactor Cycle

The mandatory cycle for every unit of domain/application logic:

1. **Red** — Write a failing test that describes one desired behavior. Run it; confirm it fails for the right reason.
2. **Green** — Write the minimum code to make the test pass. No gold-plating.
3. **Refactor** — Improve the code structure without changing observable behavior. All tests remain green.

- AT-14: Each cycle targets **one behavior**, not one method. A single method may require multiple cycles.
- AT-15: Triangulation is mandatory when generalizing a rule: write at least **3 distinct input/output pairs** before introducing a generalization (loop, formula, conditional).

### 2.3 Test Naming Convention

- AT-16: All test methods MUST follow the naming pattern `Should_<expected_outcome>_When_<condition>` across all stacks.

```csharp
// C# — correct
[Fact]
public void Should_RejectOrder_When_StockIsInsufficient() { ... }

// Java — correct
@Test
void should_RejectOrder_when_StockIsInsufficient() { ... }
```

```go
// Go — correct
func TestOrder_Should_RejectOrder_When_StockIsInsufficient(t *testing.T) { ... }
```

- AT-17: Test names MUST describe **business behavior** — never implementation details.

```csharp
// WRONG — describes implementation
void Should_CallInventoryService_When_OrderIsPlaced() { }

// CORRECT — describes behavior
void Should_RejectOrder_When_StockIsInsufficient() { }
```

- AT-18: One test per behavior. Asserting multiple unrelated outcomes in a single test is **forbidden**.
- AT-19: Test files live adjacent to their subject in unit test projects — not in a flat `tests/` dump.
- AT-20: Tests for domain logic MUST NOT assert on log output, metric emissions, or internal side effects — only on observable state or return values.

---

## 3. BDD — Behavior-Driven Development

### 3.1 Scope of Mandatory BDD

- AT-21: BDD is mandatory for: acceptance tests, regulatory compliance journeys, and all user-facing features visible in product specifications.
- AT-22: BDD scenarios are the source of truth for acceptance criteria. A feature without a passing BDD scenario is not considered done.

### 3.2 Gherkin Format Rules

- AT-23: All acceptance tests MUST be written in Gherkin using the `Given / When / Then` structure.
- AT-24: Scenario language MUST be business-readable — no technical terms, no class names, no stack identifiers inside `.feature` files.

```gherkin
# CORRECT — business language
Feature: Order placement

  Scenario: Customer cannot order out-of-stock item
    Given the item "Wireless Headset" has 0 units in stock
    When a customer attempts to place an order for "Wireless Headset"
    Then the order is rejected
    And the customer receives the message "Item currently unavailable"
```

```gherkin
# WRONG — technical leakage
Scenario: InventoryService returns 409
  Given the DB row stock_quantity = 0
  When POST /orders is called with payload { "sku": "WH-001" }
  Then HTTP 409 is returned
```

- AT-25: One scenario per distinct business behavior. Mega-scenarios with 10+ steps covering multiple outcomes are **forbidden**.
- AT-26: `Background` blocks are permitted only for context shared by all scenarios in a feature — not as a workaround for missing test isolation.
- AT-27: `Scenario Outline` is permitted for data-driven variations of the **same behavior** — not to merge distinct behaviors into one scenario.

### 3.3 File Structure

- AT-28: Feature files MUST reside at `tests/acceptance/features/` — never co-located with unit tests.
- AT-29: BDD scenarios MUST be executable in CI as an acceptance gate. A failing scenario blocks merge, equivalent to a failing unit test.

### 3.4 Framework Mandate by Stack

| Stack | Framework |
|---|---|
| .NET | SpecFlow or Reqnroll |
| Java | Cucumber-JVM |
| Go | godog |
| PHP | Behat |
| Python | behave |
| TypeScript/JS | cucumber-js |

- AT-30: Step definitions MUST NOT contain business logic. They are wiring only — actual logic lives in the domain/application layer being tested.

---

## 4. Contract Testing

### 4.1 Scope of Mandatory Contract Testing

- AT-31: Contract testing is **mandatory** for every integration between services that crosses a process boundary: REST APIs, asynchronous event streams, and gRPC interfaces.
- AT-32: Contract testing is not a substitute for integration tests. It verifies interface compatibility — not functional correctness.

### 4.2 Consumer-Driven Contracts with Pact

- AT-33: **Pact** is the mandatory framework for consumer-driven contract testing across all stacks.
- AT-34: The **consumer** owns and writes the contract. The consumer defines its expectations of the provider.
- AT-35: The **provider** verifies the contract in its own CI pipeline. Provider verification runs on every build targeting a shared or main branch.

```typescript
// TypeScript Consumer — defining a contract
const interaction = {
  state: 'order ORD-001 exists',
  uponReceiving: 'a request for order details',
  withRequest: { method: 'GET', path: '/orders/ORD-001' },
  willRespondWith: {
    status: 200,
    body: { orderId: 'ORD-001', status: 'CONFIRMED' }
  }
};
```

- AT-36: **Pact Broker** is mandatory for contract storage, versioning, and cross-team visibility. No contract may exist only as a local file.
- AT-37: A **failing contract verification in the provider CI pipeline blocks the provider's deploy**. There is no exception without an approved ADR.
- AT-38: Contracts are versioned using semver in the broker as `<consumer-name>/<version>`. Consumers MUST tag the provider version they tested against.
- AT-39: For asynchronous events, Pact message contracts apply. The message schema is the contract — not the broker configuration.
- AT-40: Verification is bidirectional: the consumer asserts it can handle the provider's response; the provider asserts it produces what the consumer expects.

---

## 5. Property-Based Testing

### 5.1 Scope

- AT-41: Property-based testing is mandatory for: Value Objects, pure functions, parsing and serialization logic, and any business rule with mathematical or set-theoretic invariants.
- AT-42: Property-based testing complements — it does not replace — example-based unit tests.

### 5.2 Framework Mandate by Stack

| Stack | Framework |
|---|---|
| .NET | FsCheck |
| Java | jqwik |
| Go | gopter |
| TypeScript | fast-check |
| Python | Hypothesis |
| PHP | php-quickcheck |

### 5.3 Properties to Test

- AT-43: The following property categories MUST be considered for every applicable type:

| Property | Definition | Example |
|---|---|---|
| **Identity** | `f(a) == a` for identity operations | Parse then serialize returns original |
| **Round-trip** | `deserialize(serialize(x)) == x` | JSON codec, Protobuf encoding |
| **Commutativity** | `f(a, b) == f(b, a)` | Order-independent discount accumulation |
| **Associativity** | `f(f(a,b),c) == f(a,f(b,c))` | Tax calculation grouping |
| **Boundary invariants** | Input in valid range always produces valid output | `Money` never negative after valid operations |

```csharp
// C# — FsCheck property: Money round-trip
[Property]
public Property Money_RoundTrip_Serialization(decimal amount) {
    var money = Money.Of(Math.Abs(amount), "BRL");
    var json = JsonSerializer.Serialize(money);
    var restored = JsonSerializer.Deserialize<Money>(json);
    return (restored == money).ToProperty();
}
```

```python
# Python — Hypothesis: price invariant
from hypothesis import given, strategies as st

@given(st.decimals(min_value=0, max_value=1_000_000, places=2))
def test_discount_never_exceeds_price(price):
    product = Product(price=price)
    discounted = product.apply_max_discount()
    assert discounted.price >= Decimal("0.00")
```

- AT-44: A minimum of **100 generated examples** per property. This floor is not configurable downward in CI.
- AT-45: CI runs MUST use a **fixed seed** to ensure reproducibility of failures. The seed is recorded in CI logs.
- AT-46: When a property fails, the framework shrinks the failing input to a minimal counterexample. The minimal case MUST be preserved in the test report and added as a named regression test.
- AT-47: Properties MUST be fast — if generating examples takes more than 5 seconds, the property is split or the generator is optimized.
- AT-48: Property tests live in the same test project as unit tests but in a clearly named subdirectory: `tests/unit/properties/`.

---

## 6. Mutation Testing

### 6.1 Scope and Cadence

- AT-49: Mutation testing runs as a **release gate** and in **weekly CI** — not on every PR. The cost of full mutation analysis is too high for per-PR execution.
- AT-50: Mutation testing is mandatory on **release branches** before any deployment to staging or production.
- AT-51: Mutation testing targets the **domain layer** as primary scope. Application layer is secondary scope.

### 6.2 Framework Mandate by Stack

| Stack | Framework |
|---|---|
| .NET | Stryker.NET |
| Java | PIT (Pitest) |
| Go | go-mutesting |
| TypeScript/JS | Stryker |
| PHP | Infection |
| Python | mutmut |

### 6.3 Scoring Rules

- AT-52: Minimum **mutation score** for the domain layer: **70%**. A release with a domain mutation score below 70% is **blocked**.
- AT-53: Surviving mutants are **not automatically accepted**. Each surviving mutant must be triaged:
  - (a) Add a test that kills the mutant, OR
  - (b) Mark the mutant as **equivalent** with a written justification in the mutation report.
- AT-54: Equivalent mutant justifications are reviewed during release review. Unjustified equivalences block release.

```xml
<!-- .NET Stryker config — stryker-config.json -->
{
  "stryker-config": {
    "mutation-level": "Standard",
    "thresholds": { "high": 80, "low": 70, "break": 70 },
    "reporters": ["html", "json"],
    "project": "src/Domain"
  }
}
```

- AT-55: The mutation score report is stored as a release artifact. Score history MUST be preserved per release tag for trend analysis.

---

## 7. Chaos Engineering

### 7.1 Scope

- AT-56: Chaos Engineering is mandatory for: services with an explicit SLA, services on the critical payment or authentication path, and services that integrate with external providers or message brokers.
- AT-57: Chaos experiments run in **staging only** unless Engineering Leadership explicitly approves a production experiment with a signed runbook.

### 7.2 Experiment Design

- AT-58: Every chaos experiment MUST begin with a written **hypothesis** in the form:
  > "If `<failure condition>` occurs, the system will `<expected behavior>` and the SLA metric `<metric>` will remain within `<threshold>`."
- AT-59: A **steady-state baseline** MUST be established before each experiment. The baseline captures: error rate, p99 latency, throughput, and health check status.
- AT-60: **Automatic rollback** is mandatory. If any health metric deviates more than **20% from the steady-state baseline**, the experiment terminates and the fault is reverted immediately.

### 7.3 Mandatory Experiment Set

Every in-scope service MUST have passing chaos experiments for all of the following fault types:

| Experiment | Fault | Expected Behavior |
|---|---|---|
| Dependency timeout | Downstream call exceeds timeout threshold | Circuit breaker opens; fallback activates |
| Dependency unavailable | Downstream service returns 503/connection refused | Graceful degradation; no data corruption |
| High latency injection | 500ms+ added to downstream calls | Timeout fires; caller is not blocked indefinitely |
| Pod restart | Service instance killed mid-request | In-flight requests fail cleanly; no state corruption |
| Network partition | Intermittent packet loss between services | Retry with backoff; eventual consistency restored |

- AT-61: Chaos experiments are defined as code in `tests/chaos/` using a supported framework.

### 7.4 Framework Options

| Platform | Framework |
|---|---|
| Kubernetes | LitmusChaos |
| AWS | AWS Fault Injection Simulator (FIS) |
| Multi-platform | Chaos Toolkit |
| Local / Docker | Toxiproxy (for network fault injection) |

```yaml
# LitmusChaos experiment — pod failure example
apiVersion: litmuschaos.io/v1alpha1
kind: ChaosEngine
metadata:
  name: order-service-pod-failure
spec:
  appinfo:
    appns: production-staging
    applabel: "app=order-service"
  experiments:
    - name: pod-delete
      spec:
        components:
          env:
            - name: TOTAL_CHAOS_DURATION
              value: "30"
            - name: CHAOS_INTERVAL
              value: "10"
```

- AT-62: Results of each experiment run are logged with: hypothesis, steady-state baseline, actual behavior observed, and pass/fail verdict.
- AT-63: A **failed chaos experiment is a bug**, not an expected outcome. It must be tracked as a defect and fixed before release.
- AT-64: If a chaos experiment reveals an architectural weakness (e.g., missing circuit breaker, absent fallback), an **ADR MUST be created** documenting the finding and the remediation decision.
- AT-65: Chaos experiments are scheduled in CI as a **weekly job** on the staging environment. Results feed into the release health dashboard.

---

## 8. Test Data Management

### 8.1 Data Safety Rules

- AT-66: Test data MUST NEVER contain real PII. This includes: names, CPF/CNPJ, email addresses, phone numbers, addresses, and any data classified under the Data Governance & LGPD Standard.
- AT-67: All PII-shaped test data MUST be synthetically generated using a data generation library or fixture factory. Using production data exports in test environments is a **P0 compliance violation**.

### 8.2 Fixture and Seeding Rules

- AT-68: Test fixtures MUST be **idempotent**. Running the same fixture setup multiple times MUST produce the same initial state — no duplicate records, no state accumulation.
- AT-69: Database seeding for integration tests MUST use **versioned test migrations** tracked in source control. Ad-hoc SQL scripts executed manually are forbidden.
- AT-70: Each test suite owns its own setup and teardown. **Shared mutable fixtures across suites are forbidden**. Test A must not depend on data created by Test B.

### 8.3 Test Data Builders

- AT-71: Aggregates and entities with more than 3 fields MUST have a corresponding **Test Data Builder** to avoid brittle fixture construction.

```csharp
// C# — Test Data Builder for Order aggregate
var order = new OrderBuilder()
    .WithCustomer(CustomerId.New())
    .WithItem("SKU-001", quantity: 2, unitPrice: Money.Of(49.90m, "BRL"))
    .WithStatus(OrderStatus.Draft)
    .Build();
```

```java
// Java — Test Data Builder for Order aggregate
Order order = OrderBuilder.anOrder()
    .withCustomer(CustomerId.generate())
    .withItem("SKU-001", 2, Money.of(new BigDecimal("49.90"), "BRL"))
    .withStatus(OrderStatus.DRAFT)
    .build();
```

- AT-72: Test Data Builders live in a shared test utilities module (e.g., `tests/shared/builders/`) and are versioned alongside the domain model. A change to an aggregate's mandatory fields MUST be reflected in its builder on the same PR.

---

## 9. Testing Anti-Patterns

The following anti-patterns are **forbidden**. CI tooling and code review MUST flag them. Each entry includes what to do instead.

- AT-73 through AT-80 are normative rules. Violation of any of these is equivalent to violating any other rule in this standard.

### 9.1 Anti-Pattern Reference Table

| # | Anti-Pattern | What it looks like | Why it is harmful | Correct Alternative |
|---|---|---|---|---|
| AT-73 | **God Test** | One test method with 50+ assertions covering unrelated behaviors | One failure hides all others; intent is unreadable | Split into focused tests, one behavior per test |
| AT-74 | **Test Interdependence** | Test B passes only if Test A ran first; shared mutable static state | Order-dependent suites hide failures and break parallel execution | Every test sets up and tears down its own state |
| AT-75 | **Mocking Internals** | `mock.Setup(x => x.PrivateHelper())` or using reflection to stub private methods | Tests become coupled to implementation — every refactor breaks tests | Test only through public entry points; refactor internal structure freely |
| AT-76 | **Testing Implementation** | Asserting `mockRepo.Verify(r => r.Save(It.IsAny<Order>()), Times.Once())` instead of outcome | Tests break on any structural change even when behavior is correct | Assert on observable state or return value, not on which methods were called |
| AT-77 | **Flaky Test Tolerance** | A test that sometimes passes and sometimes fails is left in the suite | Flaky tests erode trust in the entire suite; teams learn to ignore failures | A flaky test is a **P1 bug**. It is fixed before any feature work proceeds. If the cause is unknown, the test is quarantined and tracked. |
| AT-78 | **Thread.Sleep in Tests** | `Thread.Sleep(3000)` to wait for an async operation | Adds arbitrary delay, still races in slow CI, masks real timing issues | Use `WaitUntil` with explicit timeout and polling interval; use async/await properly |
| AT-79 | **Magic Numbers in Assertions** | `Assert.Equal(1337, result.Total)` with no explanation | Assertions are opaque; maintenance burden is high | Use named constants: `Assert.Equal(ExpectedOrderTotal, result.Total)` |
| AT-80 | **Assertion Roulette** | Multiple `Assert` statements with no message, failing assertion unidentifiable | Failure output does not indicate which assertion failed or why | Use assertion libraries with descriptive failure messages; add context strings to every assertion |

### 9.2 Flaky Test Protocol (AT-77 Enforcement)

When a flaky test is identified:

1. The test is immediately moved to a `[quarantine]` tag or equivalent isolation mechanism.
2. A defect ticket is created with `P1` priority.
3. No new feature PRs from the owning team are merged until the flaky test is fixed or the root cause is documented with a remediation timeline.
4. The fix is deployed to CI and the test exits quarantine only after 20 consecutive green runs.

```csharp
// WRONG — brittle async wait
[Fact]
public async Task Should_ProcessPayment_When_EventReceived() {
    PublishPaymentEvent();
    Thread.Sleep(3000); // hoping the consumer processed it
    Assert.Equal(PaymentStatus.Confirmed, ReadPaymentStatus());
}

// CORRECT — deterministic wait
[Fact]
public async Task Should_ProcessPayment_When_EventReceived() {
    PublishPaymentEvent();
    await WaitUntilAsync(
        condition: () => ReadPaymentStatus() == PaymentStatus.Confirmed,
        timeout: TimeSpan.FromSeconds(10),
        pollInterval: TimeSpan.FromMilliseconds(200)
    );
    Assert.Equal(PaymentStatus.Confirmed, ReadPaymentStatus());
}
```

---

## 10. CI Integration Requirements

All testing layers MUST be integrated into CI as follows:

| Layer | Trigger | Gate Behavior |
|---|---|---|
| Unit tests | Every commit / PR | Failing unit test blocks merge |
| Integration tests | Every commit / PR | Failing integration test blocks merge |
| BDD acceptance tests | Every commit / PR | Failing scenario blocks merge |
| Contract verification (provider) | Every build on shared branch | Failing contract blocks deploy |
| Property-based tests | Every commit / PR | Failing property blocks merge |
| Mutation testing | Weekly + release branch | Score < 70% on domain blocks release |
| Chaos experiments | Weekly (staging) | Failed experiment creates P1 defect |
| E2E tests | Release branch + post-deploy smoke | Failing E2E blocks promotion to next environment |

---

## 11. Compliance and Exceptions

- Any deviation from a rule in this standard requires an **ADR** in `.enterprise/.specs/decisions/` with:
  - The specific rule(s) being waived
  - The technical justification
  - The compensating control in place
  - The owner and expiry date of the exception

- Violations discovered in PR review that lack an ADR are grounds for **blocking the PR** without further discussion.
- The testing strategy for each service MUST be summarized in that service's architecture specification document, referencing this standard.
