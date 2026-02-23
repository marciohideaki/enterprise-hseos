# Java — Idiomatic Guide
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** Java 21+

> Defines mandatory Java language idioms, modern feature usage, and community best practices.
> Supplements the Java Architecture Standard.

---

## 1. Modern Java Feature Adoption

- IG-01: Java 21 is the minimum supported version for all new services — no new code targets < 21.
- IG-02: Records (`record`) used for DTOs, Value Objects, and Command/Query types — no boilerplate POJOs.
- IG-03: Sealed classes (`sealed`/`permits`) used for closed type hierarchies — replacing open inheritance.
- IG-04: Pattern matching (`instanceof`, `switch` expressions) used over manual casting.
- IG-05: Text blocks (triple-quote strings) used for multi-line strings (SQL, JSON templates, HTML).
- IG-06: `var` used for local variable type inference where type is obvious from RHS — never for method signatures.
- IG-07: Switch expressions (arrow form) preferred over switch statements.

---

## 2. Immutability & Value Semantics

- IG-08: Prefer immutable types — `final` fields, records, `Collections.unmodifiableList`.
- IG-09: Never return mutable collections from domain methods — use `List.copyOf`, `Map.copyOf`, `Set.copyOf`.
- IG-10: Domain Value Objects implemented as `record` — no setters.
- IG-11: Builder pattern used for complex object construction (Lombok `@Builder` in Infrastructure/Application only — never in Domain).
- IG-12: `Collections.emptyList()` / `List.of()` for empty/fixed collections — never `new ArrayList<>()` where mutation is not needed.

---

## 3. Optional Usage

- IG-13: `Optional<T>` used ONLY for method return types where absence is a meaningful outcome.
- IG-14: `Optional` NEVER used as a field type, constructor parameter, or method parameter.
- IG-15: `Optional.get()` without `isPresent()` check is forbidden — use `orElseThrow()`, `orElse()`, `map()`, `ifPresent()`.
- IG-16: `Optional.orElseThrow()` preferred over `orElse(null)` — null returns forbidden at application boundaries.

```java
// Correct
Optional<Order> findById(OrderId id);
Order order = findById(id).orElseThrow(() -> new OrderNotFoundException(id));

// Forbidden
Optional<String> name; // as a field
void process(Optional<Command> cmd); // as a parameter
```

---

## 4. Stream API

- IG-17: Streams are stateless — no side effects inside `map()`, `filter()`, `flatMap()`.
- IG-18: Avoid `collect(toList())` when `toUnmodifiableList()` is appropriate.
- IG-19: Parallel streams forbidden without explicit performance justification and benchmark.
- IG-20: Streams not used for simple iteration where a `for` loop is clearer — readability over cleverness.
- IG-21: `Collectors.groupingBy`, `partitioningBy` preferred over manual map building.

---

## 5. Functional Interfaces & Lambdas

- IG-22: Prefer method references over lambdas when the lambda only delegates to an existing method.
- IG-23: Use standard functional interfaces (`Predicate<T>`, `Function<T,R>`, `Supplier<T>`, `Consumer<T>`) — do not create custom functional interfaces when a standard one exists.
- IG-24: Lambdas capturing mutable variables forbidden — use effectively final variables only.

---

## 6. Concurrency Model (Java 21)

- IG-25: Virtual Threads (`Thread.ofVirtual()`) used for IO-bound work — replacing traditional thread pools for blocking IO.
- IG-26: Carrier thread pinning avoided — no `synchronized` blocks inside virtual-thread-executed code; use `ReentrantLock`.
- IG-27: `ExecutorService` via `Executors.newVirtualThreadPerTaskExecutor()` for IO-bound task pools.
- IG-28: `ForkJoinPool` (parallel stream, `CompletableFuture`) used ONLY for CPU-bound work.
- IG-29: `CompletableFuture` used for async composition — chained with `thenApply`, `thenCompose`, `exceptionally`.
- IG-30: `CountDownLatch`, `Semaphore`, `CyclicBarrier` used for explicit coordination — not `Thread.sleep`.
- IG-31: Structured Concurrency (`StructuredTaskScope`, JEP 453) used in Java 21+ for scoped parallel tasks.
- IG-32: Thread-local state avoided with virtual threads — use scoped values (`ScopedValue`, JEP 446).

```java
// Virtual Thread executor — IO-bound
try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
    Future<Order> f = executor.submit(() -> orderRepository.findById(id));
}

// Structured Concurrency — parallel with scope
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    Future<Order>    order    = scope.fork(() -> orderRepo.findById(id));
    Future<Customer> customer = scope.fork(() -> customerRepo.findById(custId));
    scope.join().throwIfFailed();
    return new OrderView(order.get(), customer.get());
}
```

---

## 7. Error Handling Idioms

- IG-33: Checked exceptions used ONLY for recoverable conditions the caller can meaningfully handle.
- IG-34: Unchecked exceptions (`RuntimeException`) used for programming errors and unrecoverable state.
- IG-35: Custom exception hierarchy: one base exception per bounded context, typed subtypes for specific errors.
- IG-36: Exception messages are actionable — include the problematic value and context.
- IG-37: `multi-catch` (`catch (FooException | BarException e)`) used to avoid duplicated handler bodies.
- IG-38: `try-with-resources` mandatory for all `AutoCloseable` resources — no manual `finally` close.
- IG-39: Infrastructure exceptions caught and translated to domain/application exceptions at layer boundary — never re-thrown raw.

---

## 8. Null Handling

- IG-40: Null parameters forbidden at public API boundaries — use `Optional`, require non-null, or use `@NonNull`.
- IG-41: `Objects.requireNonNull(param, "param must not be null")` used in constructor/method guards.
- IG-42: Return `Optional.empty()` instead of `null` from query methods.
- IG-43: `@Nullable` / `@NonNull` annotations (JSR-305 or JSpecify) used consistently on all public API parameters and return types.

---

## 9. String Handling

- IG-44: Text blocks used for multi-line string literals — no `\n` concatenation.
- IG-45: `String.formatted()` or `String.format()` used — no `+` concatenation in non-trivial strings.
- IG-46: `StringBuilder` used only inside tight loops — elsewhere prefer `String.formatted`.
- IG-47: `String.isBlank()` preferred over `s.trim().isEmpty()`.

---

## 10. Collection Best Practices

- IG-48: Factory methods preferred: `List.of(...)`, `Map.of(...)`, `Set.of(...)`.
- IG-49: `Map.entry()` / `Map.ofEntries()` for building maps with many entries.
- IG-50: `EnumMap` used when key is an enum — better performance than `HashMap`.
- IG-51: `ConcurrentHashMap` used for thread-shared maps — never synchronizing on `HashMap`.

---

## Anti-Patterns (Forbidden)

| Anti-Pattern | Why |
|---|---|
| `Optional` as field type | Serialization issues, non-standard usage |
| `Optional.get()` without guard | NullPointerException risk |
| Side effects in streams | Unpredictable behavior, non-reentrant |
| Parallel streams without benchmark | Unknown performance impact |
| Null returns from query methods | Breaks caller contract |
| `synchronized` in virtual-thread code | Carrier thread pinning |
| `Thread.sleep` for coordination | Brittle timing dependency |
