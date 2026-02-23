# C++ — Testing Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** C++20 | Google Test 1.14+ / Catch2 3+

> Defines mandatory testing conventions, patterns, and tooling for C++ services.

---

## 1. Test Naming Convention

- TS-01: Test names follow: `TEST(TypeName, BehaviorUnderCondition)`.

```cpp
TEST(Order, RejectsEmptyItemsWhenCreated) {}
TEST(PlaceOrderHandler, ReturnsOrderIdWhenCommandIsValid) {}
TEST(OrderRepository, ThrowsWhenOrderNotFound) {}
```

- TS-02: Test fixture class named `{TypeName}Test`: `class OrderTest : public ::testing::Test`.
- TS-03: Fixture tests: `TEST_F(OrderTest, CancelsWhenPending)`.
- TS-04: Parameterized tests: `TEST_P(OrderTest, RejectsInvalidItems)` with `INSTANTIATE_TEST_SUITE_P`.

---

## 2. Test Structure (AAA)

- TS-05: Arrange-Act-Assert structure with blank line separation.
- TS-06: One logical assertion per test — multiple `EXPECT_*` for related state is acceptable.
- TS-07: `ASSERT_*` used when failure makes further assertions meaningless (null pointer, etc.).
- TS-08: `EXPECT_*` used for non-fatal assertions that allow test to continue.

```cpp
TEST_F(PlaceOrderHandlerTest, ReturnsSuccessOnValidCommand) {
    // Arrange
    auto command = PlaceOrderCommand{customerId_, validItems_};
    EXPECT_CALL(*mockRepo_, Save(testing::_))
        .WillOnce(testing::Return(Result<OrderId>::Ok(orderId_)));

    // Act
    auto result = handler_->Execute(command);

    // Assert
    EXPECT_TRUE(result.IsSuccess());
    EXPECT_EQ(result.Value(), orderId_);
}
```

---

## 3. Fixtures

- TS-09: `SetUp()` and `TearDown()` used for per-test initialization/cleanup.
- TS-10: `SetUpTestSuite()` / `TearDownTestSuite()` for expensive shared state (DB connections).
- TS-11: RAII objects in fixtures — no manual cleanup in `TearDown` when destructor suffices.

```cpp
class OrderHandlerTest : public ::testing::Test {
protected:
    void SetUp() override {
        mockRepo_ = std::make_shared<MockOrderRepository>();
        handler_  = std::make_unique<PlaceOrderHandler>(mockRepo_, mockPublisher_);
    }
    std::shared_ptr<MockOrderRepository> mockRepo_;
    std::unique_ptr<PlaceOrderHandler>   handler_;
};
```

---

## 4. Parameterized Tests

- TS-12: `INSTANTIATE_TEST_SUITE_P` with `testing::Values` / `testing::ValuesIn` for parameterized domain tests.

```cpp
class OrderItemValidationTest : public ::testing::TestWithParam<int> {};

TEST_P(OrderItemValidationTest, RejectsInvalidQuantity) {
    EXPECT_THROW(OrderItem::Create(productId, GetParam()), InvalidQuantityException);
}

INSTANTIATE_TEST_SUITE_P(
    InvalidQuantities,
    OrderItemValidationTest,
    testing::Values(0, -1, -100, std::numeric_limits<int>::min())
);
```

---

## 5. Mocking (Google Mock)

- TS-13: `MOCK_METHOD` macro used for mock generation.
- TS-14: `EXPECT_CALL` set up before the action — not after.
- TS-15: `testing::Return`, `testing::Invoke`, `testing::Throw` used for mock behavior.
- TS-16: `testing::StrictMock<T>` used when unexpected calls should fail the test.
- TS-17: `testing::NiceMock<T>` used when irrelevant calls should be silently ignored.

```cpp
class MockOrderRepository : public IOrderRepository {
public:
    MOCK_METHOD(Result<Order>, FindById, (const OrderId& id), (override));
    MOCK_METHOD(Result<OrderId>, Save, (const Order& order), (override));
};
```

---

## 6. Integration Tests

- TS-18: Integration tests in separate CMake target: `add_executable(integration_tests ...)`.
- TS-19: Testcontainers-cpp or embedded test infrastructure used.
- TS-20: Integration test names use `IT` suffix in test suite: `TEST(OrderRepositoryIT, PersistsAndRetrieves)`.

---

## 7. Coverage

- TS-21: Coverage measured via `gcov` (GCC) or `llvm-cov` (Clang).
- TS-22: `lcov` used to generate HTML coverage reports.
- TS-23: Domain layer: >= 90% line coverage.
- TS-24: Application layer: >= 80% line coverage.
- TS-25: Coverage thresholds enforced in CI via `lcov --fail-under-lines`.

---

## 8. Benchmarks (Google Benchmark)

- TS-26: Google Benchmark used for performance-sensitive code.
- TS-27: Benchmark binaries separate from test binaries — dedicated `benchmarks/` CMake target.
- TS-28: `benchmark::DoNotOptimize(result)` used to prevent dead-code elimination.
- TS-29: PR description includes before/after benchmark output for hot path changes.

```cpp
static void BM_OrderRepository_FindById(benchmark::State& state) {
    auto repo = SetupTestRepository();
    for (auto _ : state) {
        auto result = repo->FindById(testId);
        benchmark::DoNotOptimize(result);
    }
}
BENCHMARK(BM_OrderRepository_FindById)->Unit(benchmark::kMicrosecond);
```
