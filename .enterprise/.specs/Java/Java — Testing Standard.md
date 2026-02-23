# Java — Testing Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Java 21+ / JUnit 5

> Defines mandatory testing conventions, patterns, and tooling for Java services.

---

## 1. Test Naming Convention

- TS-01: Test method names follow: `should_{expectedBehavior}_when_{condition}`.

```java
@Test void should_rejectEmptyItems_when_orderIsCreated() { }
@Test void should_returnOrderId_when_commandIsValid() { }
@Test void should_throwException_when_customerNotFound() { }
```

- TS-02: Test class named after the class under test with `Test` suffix: `OrderTest`, `PlaceOrderHandlerTest`.
- TS-03: Integration test classes use `IT` suffix: `OrderRepositoryAdapterIT`.
- TS-04: `@DisplayName` used for complex scenarios where method name is insufficient.

---

## 2. Test Structure (AAA)

- TS-05: All tests follow Arrange-Act-Assert (AAA) — each section separated by a blank line.
- TS-06: One logical assertion per test — do not assert unrelated state in same test.
- TS-07: No logic (loops, conditions) in test bodies — extract to helper methods if needed.

```java
@Test
void should_returnOrderId_when_commandIsValid() {
    // Arrange
    var command = new PlaceOrderCommand(customerId, items);
    given(orderRepository.save(any())).willReturn(Result.ok(orderId));

    // Act
    var result = handler.execute(command);

    // Assert
    assertThat(result.isSuccess()).isTrue();
    assertThat(result.value()).isEqualTo(orderId);
}
```

---

## 3. Test Organization with @Nested

- TS-08: `@Nested` classes group tests by scenario or feature.

```java
class OrderTest {
    @Nested class WhenPlacingOrder {
        @Test void should_createOrder_when_itemsAreValid() {}
        @Test void should_reject_when_itemsAreEmpty() {}
    }
    @Nested class WhenCancellingOrder {
        @Test void should_cancel_when_orderIsPending() {}
    }
}
```

---

## 4. Parameterized Tests

- TS-09: `@ParameterizedTest` + `@MethodSource` / `@CsvSource` / `@EnumSource` mandatory for boundary value and equivalence partition testing.
- TS-10: `@ValueSource` for simple single-parameter tests.

```java
@ParameterizedTest
@MethodSource("invalidItemCombinations")
void should_reject_when_itemsAreInvalid(List<OrderItem> items) {
    assertThatThrownBy(() -> Order.place(orderId, customerId, items))
        .isInstanceOf(InvalidOrderException.class);
}

static Stream<Arguments> invalidItemCombinations() {
    return Stream.of(
        arguments(List.of()),
        arguments((List<OrderItem>) null)
    );
}
```

---

## 5. Assertion Library

- TS-11: AssertJ used for all assertions — no raw JUnit `assertEquals`/`assertTrue`.
- TS-12: `assertThat(result).isInstanceOf(Result.Success.class)` — use type-safe assertions.
- TS-13: `assertThatThrownBy(() -> ...)` for exception verification — no `@Test(expected=...)`.
- TS-14: `assertThatCode(() -> ...).doesNotThrowAnyException()` for verifying no exceptions.

---

## 6. Mocking

- TS-15: Mockito used for mocking — `@ExtendWith(MockitoExtension.class)`.
- TS-16: `given(...).willReturn(...)` (BDDMockito) preferred over `when(...).thenReturn(...)`.
- TS-17: `@Mock` for collaborators, `@InjectMocks` forbidden — use constructor injection in tests.
- TS-18: `verify(mock, times(1)).method(...)` used for interaction verification — only when interaction IS the behavior under test.
- TS-19: `@Captor` used to capture arguments for complex verification.

```java
@ExtendWith(MockitoExtension.class)
class PlaceOrderHandlerTest {
    @Mock OrderRepository orderRepository;
    @Mock OrderEventPublisher eventPublisher;
    PlaceOrderHandler handler;

    @BeforeEach void setUp() {
        handler = new PlaceOrderHandler(orderRepository, eventPublisher);
    }
}
```

---

## 7. Test Data

- TS-20: Test data builders (or factory methods on test classes) used — no scattered `new Order(...)` across tests.
- TS-21: Randomized IDs used in test data — not hardcoded `"1"` or `"test-id"`.
- TS-22: `@BeforeEach` for common setup — `@BeforeAll` only for expensive shared state (TestContainers).

---

## 8. Integration Tests

- TS-23: TestContainers used for all infrastructure integration tests — no H2/embedded dbs for production-equivalent testing.
- TS-24: `@Container static` on TestContainers instances — shared per test class, not per test.
- TS-25: `@Transactional` on integration tests that mutate state — automatic rollback between tests.
- TS-26: `@SpringBootTest(webEnvironment = RANDOM_PORT)` for API integration tests.

---

## 9. Coverage Requirements

- TS-27: Domain layer: >= 90% line coverage.
- TS-28: Application layer: >= 80% line coverage.
- TS-29: Infrastructure adapters: >= 60% line coverage (integration tests count).
- TS-30: Coverage enforced via JaCoCo in CI — build fails if thresholds not met.
- TS-31: Coverage exclusions (generated code, config classes) declared explicitly in JaCoCo config.

---

## 10. Architecture Tests (ArchUnit)

- TS-32: ArchUnit rules verify layer dependencies — committed in `src/test/` as `ArchitectureTest.java`.
- TS-33: Mandatory ArchUnit rules:
  - Domain has no imports from `infrastructure`, `application`, `api` packages.
  - `@Entity` classes live only in `infrastructure.persistence`.
  - `@RestController` classes live only in `api.controller`.
  - `@Transactional` not present on Domain layer classes.

```java
@AnalyzeClasses(packages = "com.example.service")
class ArchitectureTest {
    @ArchTest
    static final ArchRule domain_must_be_independent =
        noClasses().that().resideInAPackage("..domain..")
            .should().dependOnClassesThat()
            .resideInAnyPackage("..infrastructure..", "..application..", "..api..");
}
```

---

## 11. Performance Tests (JMH)

- TS-34: JMH benchmarks required for hot path changes (activates Performance Engineering Standard).
- TS-35: JMH benchmarks live in `src/jmh/java/` — separate source set.
- TS-36: Minimum JMH config: 5 warmup iterations, 10 measurement iterations, `Mode.AverageTime`.
