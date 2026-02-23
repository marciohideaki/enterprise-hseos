# PHP — Testing Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** PHP 8.3+ / PHPUnit 11+

> Defines mandatory testing conventions, patterns, and tooling for PHP services.

---

## 1. Test Naming Convention

- TS-01: Test method names follow: `test_{expected_behavior}_when_{condition}` (snake_case) or use `#[Test]` attribute with descriptive method name.

```php
public function test_rejects_empty_items_when_order_is_created(): void {}
public function test_returns_order_id_when_command_is_valid(): void {}

// Or with attribute:
#[Test]
public function it_rejects_empty_items(): void {}
```

- TS-02: Test class named after class under test + `Test`: `OrderTest`, `PlaceOrderHandlerTest`.
- TS-03: Integration test classes use `Test` suffix with `@group integration` or `#[Group('integration')]`.

---

## 2. Test Structure (AAA)

- TS-04: All tests follow Arrange-Act-Assert — each section separated by a blank line.
- TS-05: One logical assertion per test.
- TS-06: No logic (loops, conditions) in test bodies — extract to helpers or data providers.

```php
#[Test]
public function it_returns_success_on_valid_command(): void
{
    // Arrange
    $command = new PlaceOrderCommand($this->customerId, $this->validItems);
    $this->repository->method('save')->willReturn(Result::ok($this->orderId));

    // Act
    $result = $this->handler->execute($command);

    // Assert
    $this->assertTrue($result->isSuccess());
    $this->assertEquals($this->orderId, $result->getValue());
}
```

---

## 3. Test Framework

- TS-07: PHPUnit 11+ as primary test framework.
- TS-08: Pest PHP as alternative — same coverage requirements apply.
- TS-09: `#[Test]` attribute preferred over `test` prefix for new code (PHPUnit 11+).
- TS-10: `#[DataProvider('methodName')]` used for parameterized tests.

---

## 4. Data Providers

- TS-11: Data providers used for boundary value and equivalence partition testing.
- TS-12: Data provider methods are `public static` and return `array<string, array<mixed>>`.

```php
public static function invalidItemCombinations(): array
{
    return [
        'empty array' => [[]],
        'null value'  => [null],
        'zero qty'    => [[new OrderItem(productId: '1', quantity: 0)]],
    ];
}

#[DataProvider('invalidItemCombinations')]
public function test_rejects_invalid_items(mixed $items): void
{
    $this->expectException(InvalidOrderException::class);
    Order::create($this->orderId, $this->customerId, $items);
}
```

---

## 5. Mocking

- TS-13: PHPUnit mock objects used for port interfaces — `$this->createMock(OrderRepository::class)`.
- TS-14: Mockery as alternative for more expressive mocking syntax.
- TS-15: `$mock->expects($this->once())->method('save')` used for interaction verification.
- TS-16: Mock only what you own — do not mock third-party libraries; wrap them instead.

---

## 6. Integration Tests

- TS-17: Laravel `RefreshDatabase` trait used to reset DB state between tests.
- TS-18: SQLite in-memory database for fast unit-level infrastructure tests (where schema compatible).
- TS-19: Testcontainers PHP used for production-equivalent database integration tests.
- TS-20: `#[Group('integration')]` on all integration test classes — excluded from default test run.
- TS-21: `php artisan test --parallel` used in CI for faster test execution.

---

## 7. Coverage

- TS-22: Domain layer: >= 90% line coverage.
- TS-23: Application layer: >= 80% line coverage.
- TS-24: Infrastructure adapters: >= 60%.
- TS-25: Coverage measured via Xdebug or PCOV — PCOV preferred for CI (faster).
- TS-26: `phpunit --coverage-clover coverage.xml` generates report for CI upload.
- TS-27: Coverage thresholds enforced via `phpunit.xml` `<coverage>` configuration.

```xml
<coverage>
  <include>
    <directory>app</directory>
  </include>
  <report>
    <clover outputFile="coverage.xml"/>
  </report>
</coverage>
```
