# Java — Modern Features Standard

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** Java 21+ (LTS) modern features — adoption guidance and mandatory patterns

> This document defines **mandatory guidance for adopting Java 21+ modern features**.
> It complements the Java Architecture Standard and the Java Idiomatic Guide.
> All rules are normative unless explicitly marked as guidance.

---

## Referenced Platform Standards (MANDATORY)

- **Java Architecture Standard**
- **Java — Idiomatic Guide**
- **Java — Non-Functional Requirements (NFR)**
- **Java — Build & Toolchain Standard**
- **Resilience Patterns Standard**
- **Observability Playbook**

---

## 1. Virtual Threads / Project Loom

### MF-JV-01 — Virtual Threads Are the Default Concurrency Model for I/O-Bound Work

Virtual Threads (JEP 444, GA in Java 21) are the mandatory solution for I/O-bound concurrency in new services. They replace reactive programming (WebFlux, RxJava) in the majority of use cases. Reactive programming must only be introduced when Virtual Threads are demonstrably insufficient and documented in an ADR.

### MF-JV-02 — When to Use Virtual Threads

Use Virtual Threads for all I/O-bound workloads:

- Outbound HTTP calls (REST, gRPC, GraphQL clients)
- Database queries (JDBC, R2DBC fallback)
- File I/O and stream processing
- Message broker consumers (Kafka, RabbitMQ)
- Any operation where the thread blocks waiting for external I/O

### MF-JV-03 — When NOT to Use Virtual Threads

Do NOT use Virtual Threads for:

- **CPU-bound computation**: use platform threads (`Executors.newFixedThreadPool`), ForkJoinPool, or parallel streams.
- **Hot paths with zero-allocation requirements**: the carrier thread mechanism and scheduler introduce overhead incompatible with zero-GC paths.
- **JNI-heavy code**: native calls pin the carrier thread — profile before enabling.

### MF-JV-04 — Thread Creation API

```java
// Preferred: named virtual thread factory
Thread vt = Thread.ofVirtual()
    .name("order-processor-", 0)
    .start(() -> processOrder(orderId));

// Preferred: executor for managed lifecycle
ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();
executor.submit(() -> fetchFromDatabase(query));
```

### MF-JV-05 — Spring Boot 3.2+ Integration

Virtual Threads MUST be enabled in all Spring Boot 3.2+ services handling I/O-bound requests. Disable only with a documented reason in the service's ADR.

```yaml
# application.yml — mandatory for Spring Boot 3.2+ services
spring:
  threads:
    virtual:
      enabled: true
```

With `spring.threads.virtual.enabled=true`, Spring Boot automatically configures:
- Tomcat to use virtual threads per request
- `@Async` tasks on virtual threads
- `@Scheduled` tasks on virtual threads

### MF-JV-06 — Pinning Problem: Avoid `synchronized` in Virtual Thread Code

`synchronized` blocks pin the virtual thread to the carrier platform thread, defeating the scalability benefit. This is the most common Virtual Threads pitfall.

**Rule**: Replace `synchronized` with `ReentrantLock` in any code that may execute on a virtual thread.

```java
// FORBIDDEN — pins carrier thread
public synchronized void processPayment(PaymentCommand cmd) {
    // I/O call here will block the entire carrier thread
    gateway.charge(cmd);
}

// CORRECT — virtual-thread-friendly
private final ReentrantLock lock = new ReentrantLock();

public void processPayment(PaymentCommand cmd) {
    lock.lock();
    try {
        gateway.charge(cmd);
    } finally {
        lock.unlock();
    }
}
```

### MF-JV-07 — Detect Pinning in CI

Enable JVM pinning diagnostic flags in CI test suites to detect regressions:

```
-Djdk.tracePinnedThreads=full
```

Pinning events logged during tests MUST be treated as build warnings. Pinning in hot paths MUST be treated as build failures (configure via custom agent or test listener).

### MF-JV-08 — Do Not Pool Virtual Threads

Virtual Threads are cheap (sub-millisecond creation, ~1KB stack). Thread pools exist to limit resource consumption with expensive platform threads. Pooling virtual threads is an anti-pattern.

**Forbidden**:
```java
// FORBIDDEN — pools virtual threads, negates their purpose
Executors.newFixedThreadPool(200, Thread.ofVirtual().factory());
```

**Correct**: use `newVirtualThreadPerTaskExecutor()` and control concurrency at the task/semaphore level if needed.

### MF-JV-09 — Migrating from CompletableFuture to Virtual Threads

Virtual Threads allow replacing `CompletableFuture` chains with sequential, readable code. Prefer this migration when the async chain is I/O-bound and not event-driven.

```java
// BEFORE — CompletableFuture chain
CompletableFuture<OrderSummary> summary = fetchUser(userId)
    .thenCombine(fetchOrders(userId), (user, orders) -> buildSummary(user, orders));

// AFTER — virtual threads with StructuredTaskScope (see Section 2)
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var userTask   = scope.fork(() -> fetchUser(userId));
    var ordersTask = scope.fork(() -> fetchOrders(userId));
    scope.join().throwIfFailed();
    return buildSummary(userTask.get(), ordersTask.get());
}
```

### MF-JV-10 — Observability with Virtual Threads

Virtual Threads carry `ThreadLocal` values but the semantics differ under heavy reuse. Use `ScopedValue` (see MF-JV-17) for trace context propagation in virtual thread code. MDC (Mapped Diagnostic Context) must be explicitly set/cleared per virtual thread task.

```java
ExecutorService exec = Executors.newVirtualThreadPerTaskExecutor();
exec.submit(() -> {
    MDC.put("traceId", TraceContext.current().traceId());
    try {
        processRequest(request);
    } finally {
        MDC.clear(); // mandatory: virtual threads may be reused internally
    }
});
```

---

## 2. Structured Concurrency

### MF-JV-11 — Structured Concurrency Is the Mandatory Model for Parallel Subtasks

JEP 453 (standard in Java 21, preview in earlier versions). When a logical operation spawns parallel subtasks, those subtasks MUST be managed within a `StructuredTaskScope`. Unmanaged fire-and-forget subtasks inside request scopes are forbidden.

### MF-JV-12 — ShutdownOnFailure: Fail Fast on Any Subtask Error

Use `ShutdownOnFailure` when ALL subtasks must succeed. If any subtask fails, remaining subtasks are cancelled automatically.

```java
UserProfile loadUserProfile(UserId id) throws InterruptedException, ExecutionException {
    try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
        var userTask    = scope.fork(() -> userRepository.findById(id));
        var settingsTask = scope.fork(() -> settingsService.load(id));
        var permissionsTask = scope.fork(() -> permissionService.load(id));

        scope.join().throwIfFailed();

        return new UserProfile(userTask.get(), settingsTask.get(), permissionsTask.get());
    }
}
```

### MF-JV-13 — ShutdownOnSuccess: First Result Wins

Use `ShutdownOnSuccess` when ONE successful result is sufficient. Remaining subtasks are cancelled automatically once the first succeeds.

```java
String resolveConfig(String key) throws InterruptedException {
    try (var scope = new StructuredTaskScope.ShutdownOnSuccess<String>()) {
        scope.fork(() -> remoteConfigService.get(key));
        scope.fork(() -> localConfigCache.get(key));

        scope.join();
        return scope.result();
    }
}
```

### MF-JV-14 — Lifetime Rule: Subtasks Must Not Outlive Their Scope

The `try-with-resources` block enforces the lifetime rule: subtasks are always awaited or cancelled before the scope exits. This eliminates the "lost task" class of bugs endemic to manual `ExecutorService` usage.

Rule: every `StructuredTaskScope` MUST be used in a `try-with-resources` block. No scope may be stored as a field or passed out of the creating method.

### MF-JV-15 — Timeout on Structured Scopes

Apply deadlines to scopes to enforce SLO compliance on composite operations:

```java
try (var scope = new StructuredTaskScope.ShutdownOnFailure()) {
    var task = scope.fork(() -> externalApi.call(request));

    scope.joinUntil(Instant.now().plusMillis(500)); // 500ms SLO
    scope.throwIfFailed();

    return task.get();
}
```

### MF-JV-16 — Error Handling: Never Swallow Scope Exceptions

`scope.throwIfFailed()` MUST always be called after `scope.join()` when using `ShutdownOnFailure`. Silently ignoring failures violates the fail-fast principle and hides subtask errors from the caller.

### MF-JV-17 — ScopedValue: Replace ThreadLocal in Virtual Thread Code

`ScopedValue` (JEP 446, preview Java 21) provides immutable, scope-bound values that are safe and efficient in virtual thread contexts. Use `ScopedValue` instead of `ThreadLocal` for request-scoped context (trace IDs, tenant IDs, security principals).

```java
// Declaration (static, shared)
static final ScopedValue<TenantId> CURRENT_TENANT = ScopedValue.newInstance();

// Binding per request
ScopedValue.where(CURRENT_TENANT, tenantId).run(() -> {
    // All code in this block — including subtasks forked via StructuredTaskScope
    // — can read CURRENT_TENANT.get() safely
    processRequest(request);
});

// Reading (anywhere in the call tree)
TenantId tenant = CURRENT_TENANT.get();
```

### MF-JV-18 — Spring Integration

As of Spring Framework 6.1+, `@Async` methods with virtual threads enabled use virtual threads automatically. For custom `StructuredTaskScope` usage within Spring beans, inject no executor — create scopes locally within the method using `try-with-resources`. Spring's transaction context is NOT automatically propagated to forked subtasks; transaction boundaries must remain on the coordinating thread.

---

## 3. GraalVM Native Image

### MF-JV-19 — When to Use GraalVM Native Image

GraalVM Native Image is mandatory for the following deployment targets:

- **Serverless functions**: AWS Lambda, Google Cloud Run, Azure Functions (startup < 100ms requirement)
- **CLI tools** distributed as standalone binaries
- **Sidecar containers** where memory footprint is the primary constraint

For all other long-running services, native image is optional and requires an ADR.

### MF-JV-20 — When NOT to Use GraalVM Native Image

Do NOT use native image when:

- The service depends on runtime reflection that cannot be fully enumerated (e.g., dynamic plugin loading, runtime code generation via CGLIB without Spring AOT).
- The service requires JIT warmup for throughput (high-volume, long-running services where JIT-optimized code outperforms AOT after warmup).
- The native build time exceeds CI budget for the team's release cadence.

### MF-JV-21 — Spring Boot 3 Native Build

```bash
# Build native container image (Spring Boot 3 + Buildpacks)
./mvnw -Pnative spring-boot:build-image

# Or with GraalVM native-image directly
./mvnw -Pnative native:compile
```

The `native` profile MUST be defined in `pom.xml` and MUST NOT be the default profile. Feature branch CI pipelines MUST NOT run native compilation — reserve native builds for release branches and scheduled nightly jobs.

### MF-JV-22 — Reflection Hints Are Mandatory

Any class accessed via reflection at runtime must be registered. Use Spring AOT-generated hints where available; add manual hints for libraries not yet compatible.

```java
// On the Spring Boot application class or a @Configuration class
@RegisterReflectionForBinding({
    OrderResponse.class,
    PaymentResponse.class,
    ErrorResponse.class
})
@SpringBootApplication
public class OrderServiceApplication { ... }
```

For non-Spring reflection, provide `src/main/resources/META-INF/native-image/reflect-config.json`:

```json
[
  {
    "name": "com.example.infra.legacy.LegacyAdapter",
    "allDeclaredMethods": true,
    "allDeclaredFields": true
  }
]
```

### MF-JV-23 — Native Compatibility Test Suite

The full test suite MUST pass against the native binary before a native release artifact is promoted. JVM test passage alone is insufficient.

```bash
# Run tests against native binary
./mvnw -Pnative test
```

Native test failures that pass on JVM indicate missing reflection/serialization hints and MUST be resolved before release.

### MF-JV-24 — Serialization Configuration

Java serialization (`Serializable`) is largely unsupported in native image. Use only explicit serialization frameworks (Jackson, Protobuf, Avro) with AOT-registered type hints. Native image with default Java serialization is forbidden.

### MF-JV-25 — Dynamic Agents and Bytecode Generation

Runtime bytecode manipulation (CGLIB subclass proxies, ASM dynamic generation, Byte Buddy without graal support) is forbidden in services targeting native image. Use Spring AOT proxies (interface-based) or Micronaut's compile-time DI as alternatives.

### MF-JV-26 — Benchmark Requirement Before Adopting Native

Before adopting native image for a service, a documented benchmark comparing the following MUST be included in the ADR:

| Metric | JVM (baseline) | Native |
|---|---|---|
| Startup time | _ms | _ms |
| Heap at idle | _MB | _MB |
| p99 latency (warm) | _ms | _ms |
| Throughput (req/s) | _ | _ |

Native image must show a measurable advantage on the metrics that motivated adoption.

---

## 4. Records and Sealed Classes

### MF-JV-27 — Records Are Mandatory for DTOs and Value Objects

`record` is the mandatory type for:

- API request/response bodies
- Application layer Commands and Queries
- Domain Value Objects without behavior
- Internal data transfer between layers

Regular classes MUST be used for Domain Aggregates and any type requiring mutable state or rich behavior.

### MF-JV-28 — Records Are Immutable by Design

Records provide automatic `equals`, `hashCode`, `toString`, and accessor methods. No setters are generated or permitted. All components are `final`. This is the correct default for data carriers.

```java
// Value Object
public record Money(BigDecimal amount, Currency currency) {
    // Compact constructor for validation
    public Money {
        Objects.requireNonNull(amount, "amount must not be null");
        Objects.requireNonNull(currency, "currency must not be null");
        if (amount.compareTo(BigDecimal.ZERO) < 0) {
            throw new IllegalArgumentException("amount must not be negative");
        }
    }
}
```

### MF-JV-29 — Compact Constructors for Validation

Validation logic in records MUST use compact constructors (no parameter list). Validation must be exhaustive: postcondition is that a record instance is always valid.

```java
public record EmailAddress(String value) {
    private static final Pattern PATTERN = Pattern.compile("^[\\w.+-]+@[\\w-]+\\.[\\w.]+$");

    public EmailAddress {
        Objects.requireNonNull(value, "email must not be null");
        if (!PATTERN.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid email: " + value);
        }
        value = value.toLowerCase(); // normalization is allowed in compact constructors
    }
}
```

### MF-JV-30 — Sealed Classes for Closed Type Hierarchies

Use `sealed` + `permits` whenever a type hierarchy must be **closed** — when the set of subtypes is known at compile time and must not be extended externally.

**Mandatory use cases**: domain event types, error/result types, state machine states, discriminated unions.

```java
public sealed interface PaymentResult permits PaymentResult.Success, PaymentResult.Failure {
    record Success(TransactionId transactionId, Money amount) implements PaymentResult {}
    record Failure(String reason, ErrorCode code)             implements PaymentResult {}
}
```

### MF-JV-31 — Pattern Matching Switch on Sealed Types

Every `switch` on a sealed type MUST be exhaustive. The compiler enforces this — do not add a default branch to suppress exhaustiveness checking on sealed types (it defeats the purpose).

```java
String describe(PaymentResult result) {
    return switch (result) {
        case PaymentResult.Success s -> "Charged %s for %s".formatted(s.transactionId(), s.amount());
        case PaymentResult.Failure f -> "Payment failed: %s [%s]".formatted(f.reason(), f.code());
        // No default — compiler enforces exhaustiveness on sealed types
    };
}
```

### MF-JV-32 — Result Type Pattern

Services returning fallible results MUST use a sealed `Result` type instead of checked exceptions for expected failures (domain errors). Unchecked exceptions are reserved for unexpected infrastructure failures.

```java
public sealed interface Result<T> permits Result.Ok, Result.Err {
    record Ok<T>(T value)          implements Result<T> {}
    record Err<T>(DomainError error) implements Result<T> {}

    static <T> Result<T> ok(T value)           { return new Ok<>(value); }
    static <T> Result<T> err(DomainError error) { return new Err<>(error); }
}
```

### MF-JV-33 — Forbidden: Open Inheritance for Closed Domains

Using open `abstract class` or `interface` (without `sealed`) for a type hierarchy that is conceptually closed is forbidden. If the set of subtypes is known and bounded, it MUST be sealed.

### MF-JV-34 — Records in Jackson / JPA

Records are compatible with Jackson 2.12+ without additional configuration for serialization. For JPA projections, records are supported as interface-free projections in Spring Data JPA. Hibernate 6+ supports records as embeddable types with `@Embeddable`. Verify version compatibility before use.

---

## 5. Pattern Matching (Advanced)

### MF-JV-35 — Pattern Matching for instanceof: Eliminate Explicit Casts

Pattern matching for `instanceof` (GA Java 16) eliminates the cast-after-check pattern. Explicit casting after an `instanceof` check is forbidden.

```java
// FORBIDDEN — redundant cast
if (event instanceof OrderPlaced) {
    OrderPlaced placed = (OrderPlaced) event;
    handleOrderPlaced(placed);
}

// CORRECT — pattern variable bound in condition
if (event instanceof OrderPlaced placed) {
    handleOrderPlaced(placed);
}
```

### MF-JV-36 — Switch Patterns with Guarded Patterns (`when`)

Switch expressions support guarded patterns (Java 21) using `when` clauses. Use them to consolidate type dispatch and condition checks into a single switch.

```java
String classify(Object value) {
    return switch (value) {
        case Integer i when i < 0   -> "negative integer";
        case Integer i when i == 0  -> "zero";
        case Integer i              -> "positive integer: " + i;
        case String s when s.isBlank() -> "blank string";
        case String s               -> "string: " + s;
        case null                   -> "null";
        default                     -> "other: " + value.getClass().getSimpleName();
    };
}
```

### MF-JV-37 — Mandatory Use of Switch Pattern for Type-Based Dispatch

When a method performs dispatch based on the runtime type of a parameter, it MUST use a `switch` pattern expression. `if-else instanceof` chains with more than two branches are forbidden.

**Forbidden pattern** (3+ branches):
```java
// FORBIDDEN — instanceof chain with 3+ branches
if (cmd instanceof CreateOrder c) { ... }
else if (cmd instanceof CancelOrder c) { ... }
else if (cmd instanceof UpdateOrder c) { ... }
```

**Correct**:
```java
// CORRECT — switch pattern
return switch (cmd) {
    case CreateOrder  c -> handleCreate(c);
    case CancelOrder  c -> handleCancel(c);
    case UpdateOrder  c -> handleUpdate(c);
};
```

### MF-JV-38 — Deconstruction Patterns for Records

Java 21 preview (standard in later versions) supports record deconstruction in `switch` and `instanceof`. Use deconstruction to extract record components directly in the pattern.

```java
// Record deconstruction in switch (Java 21+ preview)
double area(Shape shape) {
    return switch (shape) {
        case Circle(var radius)         -> Math.PI * radius * radius;
        case Rectangle(var w, var h)    -> w * h;
        case Triangle(var b, var h)     -> 0.5 * b * h;
    };
}
```

Enable preview features explicitly in `pom.xml` and document the Java version required for graduation to standard.

### MF-JV-39 — Anti-Pattern: Reflective Type Dispatch

Using `getClass().getName()` or reflection to dispatch on types is forbidden. All type dispatch must use `instanceof` pattern matching or `switch` patterns.

### MF-JV-40 — Null Handling in Switch Patterns

Java 21 `switch` patterns support explicit `case null` branches. Use `case null` to handle null inputs explicitly rather than relying on `NullPointerException`. At API boundaries, null inputs MUST be rejected before reaching domain logic.

---

## 6. String Templates

### MF-JV-41 — String Templates (JEP 430 / Preview)

String Templates provide type-safe interpolation. The `STR` processor is available as a preview feature in Java 21+. Adoption in production code requires the target Java version to have graduated the feature from preview.

```java
// STR processor — basic interpolation (Java 21 preview)
String message = STR."Order \{orderId} confirmed for customer \{customerId}";
String json    = STR."""
    {
      "orderId": "\{orderId}",
      "status":  "\{status}"
    }
    """;
```

Rule: do not use String Templates in production code while they remain in preview unless the project's Java version policy explicitly allows preview features (must be documented in ADR).

### MF-JV-42 — FMT Processor for Localized Formatting

The `FMT` processor interprets format specifiers (`%s`, `%d`, etc.) within template expressions, enabling locale-aware formatting without `String.format` boilerplate.

```java
double total = 1234.567;
String report = FMT."Total: %,.2f\{total} USD";
// Output: "Total: 1,234.57 USD"
```

### MF-JV-43 — Security: String Templates Prevent Structural Injection

The `RAW` processor returns a `StringTemplate` object (not a `String`), allowing libraries to process the template structurally before rendering. This enables SQL and HTML libraries to parameterize inputs automatically, structurally preventing injection.

```java
// Future pattern — SQL library using RAW processor
// (illustrative; requires library support)
PreparedStatement stmt = DB.query(RAW."SELECT * FROM orders WHERE id = \{orderId}");
// The library receives template + values separately — orderId is never concatenated
```

Adoption of injection-safe template processors MUST be preferred over manual parameterization when the target library supports it.

### MF-JV-44 — Until Graduation: Use Text Blocks and `formatted()`

While String Templates remain in preview, multi-line strings use text blocks and interpolation uses `formatted()`:

```java
String body = """
    {
      "orderId": "%s",
      "amount":  "%.2f",
      "currency": "%s"
    }
    """.formatted(orderId, amount, currency);
```

---

## 7. Framework Choice: Spring Boot vs. Quarkus vs. Micronaut

### MF-JV-45 — Spring Boot 3.3+ Is the Default Enterprise Framework

Spring Boot 3.3+ is the **mandatory default** for new Java services unless an ADR explicitly approves an alternative. Rationale:

- Largest Java ecosystem and community.
- Full GraalVM native image support via Spring AOT.
- First-class Virtual Threads support (`spring.threads.virtual.enabled=true`).
- Aligned with Jakarta EE 10 namespace.
- Team expertise investment is maximized across services.

### MF-JV-46 — Quarkus 3+: Approved for Cloud-Native First Services

Quarkus 3+ is an approved alternative when:

- Startup time is the primary SLO (< 50ms cold start in serverless).
- Native image is a hard requirement and the team has demonstrated native-build expertise.
- The service is greenfield and has no dependency on Spring-specific libraries.

Quarkus selection requires an ADR and approval by the platform team.

```bash
# Quarkus native build
./mvnw package -Pnative -Dquarkus.native.container-build=true
```

### MF-JV-47 — Micronaut 4+: Approved for Compile-Time DI Scenarios

Micronaut 4+ is an approved alternative when:

- Compile-time dependency injection is required (no reflection-based DI) without the full GraalVM native overhead.
- IoT, embedded, or edge deployment targets with severe memory constraints.
- The team has documented experience with Micronaut.

Micronaut selection requires an ADR.

### MF-JV-48 — Forbidden: Jakarta EE Without a Framework

Jakarta EE (Servlet API, CDI, JAX-RS) without a supporting framework is **forbidden** for new services. Rationale: raw Jakarta EE deployment lacks the observability, configuration, testing, and cloud-native integration that application frameworks provide. Existing services using Jakarta EE directly must include a migration path to a supported framework in their service roadmap ADR.

Framework selection MUST be consistent within a bounded context. Mixed frameworks across services in the same domain require explicit justification in the domain's ADR.

---

## Appendix A — Rule Summary Table

| Rule ID | Summary | Enforcement |
|---|---|---|
| MF-JV-01 | Virtual Threads are the default for I/O-bound concurrency | Mandatory |
| MF-JV-02 | Use VT for HTTP, DB, file, broker I/O | Mandatory |
| MF-JV-03 | Do not use VT for CPU-bound or zero-alloc hot paths | Mandatory |
| MF-JV-04 | Use `Thread.ofVirtual()` or `newVirtualThreadPerTaskExecutor()` | Mandatory |
| MF-JV-05 | Enable `spring.threads.virtual.enabled=true` in Spring Boot 3.2+ | Mandatory |
| MF-JV-06 | Replace `synchronized` with `ReentrantLock` in VT code | Mandatory |
| MF-JV-07 | Enable pinning detection in CI (`-Djdk.tracePinnedThreads=full`) | Mandatory |
| MF-JV-08 | Do not pool virtual threads | Mandatory |
| MF-JV-09 | Prefer VT + StructuredTaskScope over CompletableFuture chains | Guidance |
| MF-JV-10 | Clear MDC explicitly per virtual thread task | Mandatory |
| MF-JV-11 | Parallel subtasks must use `StructuredTaskScope` | Mandatory |
| MF-JV-12 | Use `ShutdownOnFailure` when all subtasks must succeed | Mandatory |
| MF-JV-13 | Use `ShutdownOnSuccess` for first-wins parallel fan-out | Guidance |
| MF-JV-14 | `StructuredTaskScope` must be used in `try-with-resources` | Mandatory |
| MF-JV-15 | Apply `joinUntil` deadline to enforce SLOs on composite calls | Mandatory |
| MF-JV-16 | Always call `throwIfFailed()` after `join()` | Mandatory |
| MF-JV-17 | Use `ScopedValue` instead of `ThreadLocal` in VT code | Mandatory |
| MF-JV-18 | Transaction boundaries must remain on coordinating thread | Mandatory |
| MF-JV-19 | Native image is mandatory for serverless and CLI tools | Mandatory |
| MF-JV-20 | Do not use native image for JIT-dependent long-running services | Mandatory |
| MF-JV-21 | Native profile must not be the default Maven profile | Mandatory |
| MF-JV-22 | Register all reflective types with `@RegisterReflectionForBinding` or `reflect-config.json` | Mandatory |
| MF-JV-23 | Test suite must pass against native binary before release | Mandatory |
| MF-JV-24 | Java serialization forbidden in native image services | Mandatory |
| MF-JV-25 | Runtime bytecode generation forbidden in native image services | Mandatory |
| MF-JV-26 | Benchmark JVM vs. native before adoption — document in ADR | Mandatory |
| MF-JV-27 | Use `record` for DTOs, Value Objects, Commands, Queries | Mandatory |
| MF-JV-28 | Records are always immutable — no setters | Mandatory |
| MF-JV-29 | Use compact constructors for record validation | Mandatory |
| MF-JV-30 | Use `sealed` for closed type hierarchies | Mandatory |
| MF-JV-31 | Switch on sealed types must be exhaustive — no default branch | Mandatory |
| MF-JV-32 | Use `Result<T>` sealed type for expected domain failures | Mandatory |
| MF-JV-33 | Open inheritance forbidden for conceptually closed domains | Mandatory |
| MF-JV-34 | Verify Jackson / JPA compatibility when using records | Guidance |
| MF-JV-35 | Eliminate explicit casts — use pattern matching `instanceof` | Mandatory |
| MF-JV-36 | Use guarded `when` patterns in `switch` expressions | Guidance |
| MF-JV-37 | Use `switch` pattern for type dispatch with 3+ branches | Mandatory |
| MF-JV-38 | Use record deconstruction patterns where available | Guidance |
| MF-JV-39 | Reflective type dispatch (`getClass()`) is forbidden | Mandatory |
| MF-JV-40 | Handle `null` explicitly with `case null` in switch patterns | Mandatory |
| MF-JV-41 | String Templates are production-ready only after preview graduation | Mandatory |
| MF-JV-42 | Use `FMT` processor for locale-aware formatted output | Guidance |
| MF-JV-43 | Prefer injection-safe template processors when available | Guidance |
| MF-JV-44 | Use text blocks + `formatted()` until String Templates graduate | Mandatory |
| MF-JV-45 | Spring Boot 3.3+ is the default framework | Mandatory |
| MF-JV-46 | Quarkus requires ADR approval | Mandatory |
| MF-JV-47 | Micronaut requires ADR approval | Mandatory |
| MF-JV-48 | Raw Jakarta EE without framework is forbidden for new services | Mandatory |

---

## Appendix B — ADR Triggers

The following decisions MUST be documented as Architecture Decision Records (ADRs):

- Adopting reactive programming instead of Virtual Threads (MF-JV-01)
- Disabling `spring.threads.virtual.enabled` (MF-JV-05)
- Adopting GraalVM Native Image for a long-running service (MF-JV-20)
- Allowing preview features in production code (MF-JV-41)
- Choosing Quarkus instead of Spring Boot (MF-JV-46)
- Choosing Micronaut instead of Spring Boot (MF-JV-47)
- Mixed frameworks within a bounded context (MF-JV-48)
