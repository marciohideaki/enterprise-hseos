# C++ — Idiomatic Guide
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** C++20 / C++23

> Defines mandatory C++ language idioms, modern feature usage, and community best practices.
> Supplements the C++ Architecture Standard.

---

## 1. Modern C++ Feature Adoption

- IG-01: C++20 is the minimum standard for all new services (`set(CMAKE_CXX_STANDARD 20)` minimum).
- IG-02: C++23 features used where compiler support is confirmed and ADR-approved.
- IG-03: `constexpr` used for all compile-time computable values and functions — prefer over runtime evaluation.
- IG-04: `consteval` (C++20) used for functions that MUST be evaluated at compile time.
- IG-05: `constinit` (C++20) used for variables with constant initialization but runtime mutation.
- IG-06: Structured bindings (C++17) used for tuple/pair decomposition: `auto [key, value] = map.find(...)`.
- IG-07: `std::expected<T, E>` (C++23) or custom `Result<T, E>` used for error propagation — no exceptions for control flow.
- IG-08: `std::span<T>` used instead of raw pointer + size pairs.
- IG-09: `std::string_view` used for read-only string parameters — no unnecessary string copies.
- IG-10: Range-based algorithms (`std::ranges::sort`, `std::ranges::find_if`) preferred over iterator-based.

```cpp
// constexpr
constexpr int MaxRetries = 3;
constexpr bool IsValidPort(int port) { return port > 0 && port < 65536; }

// std::span
void ProcessItems(std::span<const OrderItem> items) { /* no copy */ }

// std::expected (C++23)
std::expected<Order, OrderError> CreateOrder(OrderId id, std::span<OrderItem> items) {
    if (items.empty()) return std::unexpected(OrderError::EmptyItems);
    return Order{id, items};
}
```

---

## 2. Resource Management (RAII)

- IG-11: RAII mandatory for ALL resources — constructor acquires, destructor releases.
- IG-12: **Rule of Zero**: prefer types that need no custom destructor/copy/move — use smart pointers and standard containers.
- IG-13: **Rule of Five**: if any of destructor, copy constructor, copy assignment, move constructor, move assignment is defined — define or delete ALL five.
- IG-14: `std::unique_ptr<T>` for exclusive ownership — default choice for heap allocation.
- IG-15: `std::shared_ptr<T>` only for genuinely shared ownership — document why sharing is needed.
- IG-16: `std::weak_ptr<T>` for non-owning observer references to `shared_ptr`.
- IG-17: Raw owning pointers (`T*`) forbidden — no `new`/`delete` outside smart pointer construction.
- IG-18: `std::make_unique<T>()` and `std::make_shared<T>()` — never `new T()` directly.

```cpp
// Rule of Zero — smart pointer handles lifetime
class OrderRepository {
    std::unique_ptr<DatabaseConnection> conn_;
public:
    explicit OrderRepository(std::unique_ptr<DatabaseConnection> conn)
        : conn_(std::move(conn)) {}
    // No destructor, copy, or move needed — Rule of Zero
};
```

---

## 3. Move Semantics & Value Categories

- IG-19: `std::move()` used when transferring ownership of a resource to another object.
- IG-20: Perfect forwarding with `std::forward<T>()` in template functions accepting universal references.
- IG-21: Pass by value + move for sink parameters (constructor/setter taking ownership).
- IG-22: Pass by `const T&` for read-only access to large objects.
- IG-23: Pass by value for small, cheaply-copyable types (int, bool, `std::string_view`).
- IG-24: Return values by value — rely on NRVO/RVO — no `std::move` in return statements (inhibits RVO).

```cpp
// Sink parameter: pass by value + move
class Order {
    std::string customerId_;
public:
    explicit Order(std::string customerId)    // pass by value
        : customerId_(std::move(customerId)) {} // move into member
};

// Perfect forwarding in template
template<typename T>
void Enqueue(T&& item) {
    queue_.push_back(std::forward<T>(item));
}
```

---

## 4. Concepts (C++20)

- IG-25: Concepts used instead of SFINAE for template constraints — clearer error messages.
- IG-26: Standard concepts preferred: `std::integral`, `std::floating_point`, `std::same_as`, `std::derived_from`, `std::invocable`.
- IG-27: Custom concepts defined for domain-specific constraints.
- IG-28: `requires` clause in function signatures for constraints.

```cpp
// Concept for domain event
template<typename T>
concept DomainEvent = requires(T e) {
    { e.EventType() } -> std::convertible_to<std::string>;
    { e.AggregateId() } -> std::convertible_to<std::string>;
    { e.OccurredAt() } -> std::same_as<std::chrono::system_clock::time_point>;
};

// Usage
template<DomainEvent E>
void Publish(E&& event) { /* ... */ }
```

---

## 5. Error Handling

- IG-29: `std::expected<T, E>` (C++23) for recoverable errors — compile-time checked.
- IG-30: Custom `Result<T, E>` (C++20) as `std::expected` backport for C++20 codebases.
- IG-31: Exceptions reserved for truly unrecoverable, unexpected situations.
- IG-32: `[[nodiscard]]` mandatory on all functions returning `Result`/`expected` — compiler enforces check.
- IG-33: `noexcept` specified on all functions that provably never throw.
- IG-34: Exception specifications: strong exception guarantee for domain operations, basic guarantee minimum.

```cpp
[[nodiscard]] std::expected<OrderId, OrderError>
PlaceOrder(const PlaceOrderCommand& cmd) noexcept;
```

---

## 6. Concurrency (C++20)

- IG-35: `std::jthread` (C++20) preferred over `std::thread` — automatic join on destruction.
- IG-36: `std::stop_token` / `std::stop_source` used for cooperative cancellation.
- IG-37: `std::atomic<T>` for lock-free shared state — `memory_order` specified explicitly with comment.
- IG-38: `std::mutex` + `std::lock_guard` / `std::unique_lock` for mutual exclusion.
- IG-39: `std::scoped_lock` (C++17) for acquiring multiple mutexes deadlock-free.
- IG-40: Mutex embedded in the struct it protects — not a separate global.
- IG-41: `std::latch`, `std::barrier` (C++20) for thread synchronization at known points.
- IG-42: `std::counting_semaphore` (C++20) for resource pool management.
- IG-43: Coroutines (C++20) via `co_await`/`co_yield` for async IO — with ADR documenting framework choice.

```cpp
// std::jthread with stop_token
std::jthread worker([](std::stop_token st) {
    while (!st.stop_requested()) {
        ProcessNextItem();
    }
}); // automatically joined at scope exit
```

---

## 7. Type Safety

- IG-44: `reinterpret_cast` forbidden without documented justification.
- IG-45: `const_cast` forbidden without documented justification.
- IG-46: C-style casts `(int)x` forbidden — use `static_cast`, `dynamic_cast`, `const_cast` explicitly.
- IG-47: `dynamic_cast` only with `std::polymorphic` types — check return value for nullptr.
- IG-48: `std::variant` used for discriminated unions — replacing raw `union`.
- IG-49: `std::optional<T>` used for optional values — no sentinel values or nullable pointers for optionals.

---

## 8. Anti-Patterns (Forbidden)

| Anti-Pattern | Rule |
|---|---|
| Raw owning `T*` pointer | IG-17 |
| `new` / `delete` directly | IG-18 |
| C-style cast | IG-46 |
| `reinterpret_cast` without justification | IG-44 |
| SFINAE over Concepts | IG-25 |
| `std::thread` without join | IG-35 |
| Exception for control flow | IG-31 |
| Unchecked `Result`/`expected` | IG-32 |
| Global mutable state | Architecture Standard |
