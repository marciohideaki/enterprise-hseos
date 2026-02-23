# Java — Service / Module Template
## DDD-Ready — Gold Standard / State-of-the-Art

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** Java 21+ / Spring Boot 3+

> Reference structure and minimal scaffolding for a Java/Spring Boot service.
> Complies with Java Architecture Standard, FR, and NFR.

---

## 1. Project Layout

```text
{service-name}/
  src/
    main/java/com/{company}/{service}/
      api/
        controller/
          {Feature}Controller.java
        contract/
          request/
            {UseCaseName}Request.java
          response/
            {UseCaseName}Response.java
        advice/
          GlobalExceptionHandler.java
        filter/
          CorrelationIdFilter.java
      application/
        port/
          in/
            {UseCaseName}UseCase.java          ← interface (Port In)
          out/
            {Feature}Repository.java           ← interface (Port Out)
            {Feature}EventPublisher.java        ← interface (Port Out)
        usecase/
          {feature}/
            {UseCaseName}Command.java
            {UseCaseName}Handler.java          ← implements UseCase interface
            {UseCaseName}Result.java
            {UseCaseName}Validator.java
        shared/
          result/
            Result.java
            NetworkError.java
      domain/
        model/
          {Feature}.java                       ← Aggregate root
          {Feature}Id.java                     ← Value Object
          {RelatedEntity}.java
        event/
          {FactName}.java                      ← Domain Event (record)
        service/
          {Feature}DomainService.java
        exception/
          {Feature}Exception.java
      infrastructure/
        persistence/
          entity/
            {Feature}JpaEntity.java
          repository/
            {Feature}JpaRepository.java        ← Spring Data interface
            {Feature}RepositoryAdapter.java    ← implements Port Out
          mapper/
            {Feature}PersistenceMapper.java
        messaging/
          outbox/
            OutboxMessage.java
            OutboxRepository.java
            OutboxDispatcher.java
          consumer/
            {EventName}Consumer.java
          producer/
            {Feature}EventPublisherAdapter.java
        readmodel/
          projection/
            {Feature}ProjectionHandler.java
          store/
            {Feature}ReadStore.java
        cache/
          {Feature}CacheDecorator.java
        integration/
          client/
            {ExternalService}NetworkClient.java
          adapter/
            {ExternalService}Adapter.java
        config/
          SecurityConfig.java
          PersistenceConfig.java
          MessagingConfig.java
          ObservabilityConfig.java
  src/
    test/java/com/{company}/{service}/
      domain/
        {Feature}Test.java
        {Feature}DomainServiceTest.java
      application/
        {UseCaseName}HandlerTest.java
      infrastructure/
        {Feature}RepositoryAdapterIT.java      ← TestContainers
        {Feature}ConsumerIT.java
      api/
        {Feature}ControllerTest.java           ← MockMvc
  src/
    main/resources/
      application.yml
      application-local.yml
      db/migration/                            ← Flyway scripts
  docs/
    ADR/
    runbooks/
    Architecture.md
    Contracts.md
  pom.xml  (or build.gradle)
  .editorconfig
  checkstyle.xml
```

---

## 2. Key Abstractions

### 2.1 Result Type

```java
public sealed interface Result<T> permits Result.Success, Result.Failure {
    record Success<T>(T value) implements Result<T> {}
    record Failure<T>(AppError error) implements Result<T> {}

    static <T> Result<T> ok(T value) { return new Success<>(value); }
    static <T> Result<T> fail(AppError error) { return new Failure<>(error); }
    boolean isSuccess();
}

public record AppError(String code, String message) {}
```

### 2.2 Domain Event

```java
public interface DomainEvent {
    UUID eventId();
    Instant occurredAt();
    String eventType();
    String aggregateId();
    int schemaVersion();
}

// Example
public record OrderPlaced(
    UUID eventId,
    Instant occurredAt,
    String orderId,
    String customerId,
    int schemaVersion
) implements DomainEvent {
    public String eventType() { return "OrderPlaced"; }
}
```

### 2.3 Outbox Record

```java
@Entity
@Table(name = "outbox_messages")
public class OutboxMessage {
    @Id UUID id;
    String eventType;
    String aggregateId;
    String payload;           // JSON
    Instant createdAt;
    Instant processedAt;      // null = pending
    int attemptCount;
    String lastError;
}
```

### 2.4 Port In / Use Case Interface

```java
public interface PlaceOrderUseCase {
    Result<OrderId> execute(PlaceOrderCommand command);
}

// Handler implements the port
@Component
@Transactional
public class PlaceOrderHandler implements PlaceOrderUseCase {
    private final OrderRepository orderRepository;
    private final OrderEventPublisher eventPublisher;

    @Override
    public Result<OrderId> execute(PlaceOrderCommand command) {
        // 1. Validate
        // 2. Load/create aggregate
        // 3. Enforce invariants
        // 4. Persist via port
        // 5. Publish events via port
        // 6. Return result
    }
}
```

### 2.5 Aggregate Root Pattern

```java
public class Order {
    private OrderId id;
    private OrderStatus status;
    private List<DomainEvent> domainEvents = new ArrayList<>();

    public static Order place(OrderId id, CustomerId customerId, List<OrderItem> items) {
        // validate invariants
        var order = new Order(id, customerId, items);
        order.domainEvents.add(new OrderPlaced(...));
        return order;
    }

    public List<DomainEvent> pullDomainEvents() {
        var events = List.copyOf(domainEvents);
        domainEvents.clear();
        return events;
    }
    // No setters — behavior methods only
}
```

---

## 3. API Conventions

```java
@RestController
@RequestMapping("/v1/orders")
@RequiredArgsConstructor
public class OrderController {

    private final PlaceOrderUseCase placeOrderUseCase;

    @PostMapping
    public ResponseEntity<OrderResponse> placeOrder(
            @Valid @RequestBody PlaceOrderRequest request,
            @RequestHeader(value = "X-Correlation-Id", required = false) String correlationId) {

        var command = OrderMapper.toCommand(request);
        var result = placeOrderUseCase.execute(command);

        return result instanceof Result.Success<OrderId> success
            ? ResponseEntity.status(201).body(new OrderResponse(success.value().toString()))
            : ResponseEntity.badRequest().body(/* error envelope */);
    }
}
```

---

## 4. Testing Template

### Domain Tests (pure unit)
```java
@Test void should_reject_empty_order_items() {
    assertThatThrownBy(() -> Order.place(id, customerId, List.of()))
        .isInstanceOf(InvalidOrderException.class);
}
```

### Application Tests (mocked ports)
```java
@Test void should_return_order_id_on_valid_command() {
    given(orderRepository.save(any())).willReturn(Result.ok(orderId));
    var result = handler.execute(validCommand);
    assertThat(result.isSuccess()).isTrue();
}
```

### Infrastructure Tests (TestContainers)
```java
@Testcontainers
@SpringBootTest
class OrderRepositoryAdapterIT {
    @Container static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16");
    // ...
}
```

---

## 5. Mandatory CI Gates

- Build passes (`mvn verify` or `./gradlew build`)
- Unit tests pass
- Integration tests pass
- Checkstyle + PMD + SpotBugs pass
- ArchUnit architecture tests pass
- OWASP dependency check passes
