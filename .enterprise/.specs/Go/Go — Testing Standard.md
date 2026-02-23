# Go — Testing Standard
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Go 1.22+

> Defines mandatory testing conventions, patterns, and tooling for Go services.

---

## 1. Test File Conventions

- TS-01: Test files: `{filename}_test.go` in the same package as code under test.
- TS-02: External (black-box) tests: `package {pkg}_test` — test the public API only.
- TS-03: Internal (white-box) tests: `package {pkg}` — access unexported identifiers.
- TS-04: Integration test files use build tag: `//go:build integration` on first line.

---

## 2. Test Naming Convention

- TS-05: Test functions: `Test{TypeOrFunction}_{Scenario}` or `Test{TypeOrFunction}_{Condition}_{Expected}`.

```go
func TestNewOrder_RejectsEmptyItems(t *testing.T) {}
func TestPlaceOrderHandler_Execute_ReturnsOrderID_WhenValid(t *testing.T) {}
func TestOrderRepository_FindByID_ReturnsError_WhenNotFound(t *testing.T) {}
```

- TS-06: Benchmark functions: `Benchmark{Function}_{Scenario}`.
- TS-07: Example functions: `Example{Type}_{Method}()` — with `// Output:` comment.

---

## 3. Table-Driven Tests (Mandatory)

- TS-08: Table-driven tests are **mandatory** for any function with multiple input scenarios.
- TS-09: Test table uses named fields — not positional struct literals.
- TS-10: `t.Run(tc.name, ...)` used for each case — subtests are individually identifiable.

```go
func TestOrder_Place(t *testing.T) {
    tests := []struct {
        name    string
        items   []OrderItem
        wantErr bool
    }{
        {name: "valid items", items: validItems, wantErr: false},
        {name: "empty items", items: []OrderItem{}, wantErr: true},
        {name: "nil items",   items: nil,           wantErr: true},
    }
    for _, tc := range tests {
        t.Run(tc.name, func(t *testing.T) {
            _, err := NewOrder(orderID, customerID, tc.items)
            if tc.wantErr {
                require.Error(t, err)
            } else {
                require.NoError(t, err)
            }
        })
    }
}
```

---

## 4. Assertions

- TS-11: `testify/require` for fatal assertions (test stops on failure).
- TS-12: `testify/assert` for non-fatal assertions (test continues).
- TS-13: `require.NoError(t, err)` — not `if err != nil { t.Fatal(err) }`.
- TS-14: `require.Equal(t, expected, actual)` — expected first, actual second (consistent with testify convention).
- TS-15: `require.ErrorIs(t, err, target)` for sentinel error verification.
- TS-16: `require.ErrorAs(t, err, &target)` for typed error extraction.

---

## 5. Test Helpers

- TS-17: Test helper functions call `t.Helper()` as first line — correct file/line in failure output.
- TS-18: Helpers in `testhelpers_test.go` or `internal/testhelpers/` package.
- TS-19: `newTest{Type}(t, opts...)` pattern for constructing test objects.

```go
func newTestOrder(t *testing.T) *Order {
    t.Helper()
    order, err := NewOrder(testOrderID, testCustomerID, validItems)
    require.NoError(t, err)
    return order
}
```

---

## 6. Mocking

- TS-20: Interfaces mocked via `mockery` — generated mocks in `mocks/` directory.
- TS-21: `mock.AssertExpectations(t)` called at end of every test using mocks — via `t.Cleanup`.
- TS-22: `mock.On("Method", args...).Return(...)` — avoid `mock.Anything` for typed arguments.
- TS-23: Hand-written fakes preferred over mocks for simple port interfaces — less brittle.

```go
type fakeOrderRepository struct {
    orders map[string]*Order
}
func (r *fakeOrderRepository) FindByID(_ context.Context, id OrderID) (*Order, error) {
    if o, ok := r.orders[id.String()]; ok { return o, nil }
    return nil, NotFoundError{Resource: "order", ID: id.String()}
}
```

---

## 7. Race Detector

- TS-24: `-race` flag mandatory in CI test run: `go test -race ./...`.
- TS-25: No `t.Parallel()` without verifying race-free access to shared state.
- TS-26: `t.Parallel()` used on independent subtests to speed up CI.

---

## 8. Integration Tests

- TS-27: Integration tests tagged `//go:build integration` — not run by default.
- TS-28: `testcontainers-go` used for database/broker integration tests.
- TS-29: `TestMain(m *testing.M)` used to start/stop shared containers for the test suite.
- TS-30: `t.Cleanup(func() { container.Terminate(ctx) })` for per-test container cleanup.

---

## 9. Benchmarks

- TS-31: Benchmarks required for hot path changes: `func Benchmark{Name}(b *testing.B)`.
- TS-32: `b.ResetTimer()` called after expensive setup.
- TS-33: `b.ReportAllocs()` called to report allocations.
- TS-34: `benchstat` used to compare benchmark runs in PR descriptions.

```go
func BenchmarkOrderRepository_FindByID(b *testing.B) {
    repo := setupTestRepo(b)
    b.ResetTimer()
    b.ReportAllocs()
    for i := 0; i < b.N; i++ {
        _, _ = repo.FindByID(ctx, testID)
    }
}
```

---

## 10. Coverage

- TS-35: Domain package: >= 90% coverage.
- TS-36: Application/usecase: >= 80% coverage.
- TS-37: Infrastructure adapters: >= 60% (integration tests count).
- TS-38: Coverage report generated: `go test -coverprofile=coverage.out ./... && go tool cover -html=coverage.out`.
- TS-39: Coverage check enforced in CI via `go-coverage-report` or custom threshold script.
