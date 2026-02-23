# Go — Idiomatic Guide
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Go 1.22+

> Defines mandatory Go language idioms, community best practices, and anti-patterns.
> Supplements the Go Architecture Standard.

---

## 1. Core Go Philosophy

- IG-01: Clarity over cleverness — code is read far more than it is written.
- IG-02: Simple is better than complex. Complex is better than complicated.
- IG-03: Errors are values — handle them explicitly, never ignore them.
- IG-04: Concurrency is not parallelism — use goroutines and channels to express concurrency, not for raw speed.

---

## 2. Interface Design

- IG-05: **Accept interfaces, return concrete types** — callers define the interface they need; producers return concrete structs.
- IG-06: Interfaces defined at the point of consumption (caller's package), not where implemented.
- IG-07: Prefer small, single-method interfaces (`io.Reader`, `io.Writer` style) — one method, one purpose.
- IG-08: Interface names: single-method interfaces end with `-er` (`Reader`, `Writer`, `Closer`, `Handler`).
- IG-09: Implicit interface satisfaction — no `var _ MyInterface = (*MyStruct)(nil)` unless explicitly documenting contract.
- IG-10: Embedding interfaces for composition — prefer over large interface definitions.

```go
// Correct: accept interface, return concrete
func ProcessOrder(repo OrderRepository) *OrderResult { ... }

// Wrong: return interface
func ProcessOrder() OrderResultInterface { ... }

// Correct: small interface at consumer
type OrderRepository interface {
    FindByID(ctx context.Context, id OrderID) (*Order, error)
}
```

---

## 3. Error Handling

- IG-11: Every error must be handled — never discard with `_` unless documented.
- IG-12: Errors wrapped with context: `fmt.Errorf("findOrder: %w", err)` at every layer boundary.
- IG-13: Sentinel errors declared as `var ErrNotFound = errors.New("not found")` — use `errors.Is()` to check.
- IG-14: Custom error types implement `error` interface and add structured context:

```go
type NotFoundError struct {
    Resource string
    ID       string
}
func (e NotFoundError) Error() string {
    return fmt.Sprintf("%s %s: not found", e.Resource, e.ID)
}
```

- IG-15: `errors.As()` used to extract typed error information — not type assertions.
- IG-16: `panic` used ONLY for unrecoverable programming errors (nil pointer, index OOB from wrong invariant) — never for domain errors.
- IG-17: `recover()` only in top-level HTTP handlers or main goroutines — never in business logic.
- IG-18: Error strings lowercase, no trailing punctuation: `"order not found"` not `"Order Not Found."`.

---

## 4. Package Design

- IG-19: Package names: short, lowercase, no underscores, no mixedCaps — `order`, `payment`, not `orderService`.
- IG-20: Package per concept — not per layer. `order/` not `models/`.
- IG-21: `internal/` package used to prevent external import of private packages.
- IG-22: Avoid `util`, `common`, `helper` packages — they accumulate unrelated code.
- IG-23: Circular imports forbidden — resolve by extracting a shared interface package.
- IG-24: `init()` functions avoided — use explicit initialization.

---

## 5. Naming Conventions

- IG-25: Exported identifiers: `PascalCase`. Unexported: `camelCase`.
- IG-26: Acronyms in names: `HTTPServer`, `URLParser`, `userID` — consistent case within an identifier.
- IG-27: Test helper functions: `newTestOrder(t)` — pass `*testing.T` and call `t.Helper()`.
- IG-28: Context parameter always first: `func(ctx context.Context, ...)`.
- IG-29: Error return always last: `func() (Result, error)`.
- IG-30: Boolean names: `isValid`, `hasError`, `shouldRetry` — not `valid`, `error`, `retry`.

---

## 6. Concurrency Model

- IG-31: `context.Context` propagated through every call — never stored in struct fields.
- IG-32: `context.Background()` only at program entry points (main, tests). `context.TODO()` as temporary placeholder.
- IG-33: Goroutine lifecycle explicitly managed — every goroutine has a defined owner responsible for stopping it.
- IG-34: Channel direction typed in function signatures: `send chan<- T`, `receive <-chan T`.
- IG-35: Buffered channels sized to known capacity — unbounded goroutine creation via channels forbidden.
- IG-36: `select` with `default` for non-blocking channel operations.
- IG-37: `sync.WaitGroup` used to wait for goroutine completion — `Add(1)` before `go`, `Done()` deferred.
- IG-38: `sync.Once` for lazy initialization of shared resources.
- IG-39: `sync.Mutex` protecting the data, not the code — mutex embedded in the struct that owns the data.
- IG-40: Goroutine leak prevention: every goroutine exits when its `context` is cancelled or its input channel is closed.

```go
// Correct: goroutine with lifecycle
func (w *Worker) Start(ctx context.Context) {
    go func() {
        defer w.wg.Done()
        for {
            select {
            case <-ctx.Done():
                return
            case job := <-w.jobs:
                w.process(job)
            }
        }
    }()
}
```

---

## 7. Struct Design

- IG-41: Constructor functions named `New{Type}(...)` return concrete type, not interface.
- IG-42: Zero value should be useful where possible — design structs so zero value is valid.
- IG-43: Unexported fields with exported methods for encapsulation.
- IG-44: Pointer receivers for methods that mutate state or for large structs. Value receivers for small, immutable types.
- IG-45: Consistent receiver naming — short (1-2 char), same across all methods of a type: `func (o *Order) Cancel()`.

---

## 8. Defer Usage

- IG-46: `defer` used for cleanup (file close, mutex unlock, span end) — not for deferred logic.
- IG-47: `defer` in loops forbidden — always leaks resources until function returns.
- IG-48: `defer mu.Unlock()` immediately after `mu.Lock()` — never defer inside a condition.

---

## 9. Memory & Allocation

- IG-49: Slices pre-allocated with known capacity: `make([]T, 0, n)` — avoid repeated `append` growth.
- IG-50: `sync.Pool` for frequently allocated/released objects on hot paths.
- IG-51: Pointers passed for large structs (>= 3 fields typically) to avoid copy overhead.
- IG-52: Value types for small, immutable types (IDs, coordinates, etc.).

---

## 10. Anti-Patterns (Forbidden)

| Anti-Pattern | Why |
|---|---|
| `interface{}` / `any` without type assertion | Type-unsafe; use generics (Go 1.18+) |
| Returning interface instead of concrete type | Breaks "accept interfaces, return structs" |
| Goroutine without lifecycle owner | Goroutine leak |
| `panic` for domain errors | Breaks error-as-value contract |
| `init()` with side effects | Hidden initialization order |
| `util` / `common` / `helper` packages | Dumping grounds; unclear ownership |
| Ignoring errors with `_` | Silent failure |
| `time.Sleep` for coordination | Brittle; use channels/waitgroups |
