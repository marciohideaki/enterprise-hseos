# PHP — Service / Module Template
## DDD-Ready — Gold Standard / State-of-the-Art

**Version:** 1.0
**Scope:** Generic / Project-agnostic
**Runtime:** PHP 8.3+ / Laravel 11+ or Symfony 7+

> Reference structure and minimal scaffolding for a PHP/Laravel or PHP/Symfony service.
> Complies with PHP Architecture Standard, FR, and NFR.

---

## 1. Project Layout

```text
{service-name}/
  app/
    Api/
      Controller/
        {Feature}Controller.php
      Request/
        {UseCaseName}Request.php
      Resource/
        {UseCaseName}Resource.php
      Middleware/
        CorrelationIdMiddleware.php
    Application/
      Port/
        In/
          {UseCaseName}UseCase.php          ← interface
        Out/
          {Feature}Repository.php           ← interface
          {Feature}EventPublisher.php       ← interface
      UseCase/
        {Feature}/
          {UseCaseName}Command.php
          {UseCaseName}Handler.php
          {UseCaseName}Result.php
          {UseCaseName}Validator.php
      Shared/
        Result/
          Result.php
          AppError.php
    Domain/
      Model/
        {Feature}.php                       ← Aggregate root
        {Feature}Id.php                     ← Value Object (readonly class)
      Event/
        {FactName}.php                      ← Domain Event (readonly class)
      Service/
        {Feature}DomainService.php
      Exception/
        {Feature}Exception.php
    Infrastructure/
      Persistence/
        Eloquent/
          {Feature}Model.php               ← Eloquent model
          {Feature}RepositoryAdapter.php   ← implements Port Out
          {Feature}Mapper.php
      Messaging/
        Outbox/
          OutboxMessage.php
          OutboxDispatcher.php
        Consumer/
          {EventName}Consumer.php
        Producer/
          {Feature}EventPublisherAdapter.php
      Cache/
        {Feature}CacheDecorator.php
      Integration/
        Client/
          {ExternalService}NetworkClient.php
        Adapter/
          {ExternalService}Adapter.php
      Config/
        AppServiceProvider.php
  tests/
    Unit/
      Domain/
        {Feature}Test.php
      Application/
        {UseCaseName}HandlerTest.php
    Integration/
      Infrastructure/
        {Feature}RepositoryAdapterTest.php
    Feature/
      Api/
        {Feature}ControllerTest.php
  database/
    migrations/
  docs/
    ADR/
  composer.json
  phpstan.neon
  phpcs.xml
  .deptrac.yaml
```

---

## 2. Key Abstractions

### 2.1 Value Object (readonly class)

```php
readonly class {Feature}Id
{
    public function __construct(
        public readonly string $value,
    ) {
        if (empty($value)) {
            throw new \InvalidArgumentException('{Feature}Id cannot be empty');
        }
    }

    public static function generate(): self
    {
        return new self(\Ramsey\Uuid\Uuid::uuid4()->toString());
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
```

### 2.2 Domain Event

```php
readonly class {FactName}
{
    public function __construct(
        public readonly string $eventId,
        public readonly \DateTimeImmutable $occurredAt,
        public readonly string $aggregateId,
        public readonly int $schemaVersion = 1,
    ) {}

    public function eventType(): string
    {
        return '{FactName}';
    }
}
```

### 2.3 Aggregate Root

```php
final class {Feature}
{
    private array $domainEvents = [];

    private function __construct(
        private readonly {Feature}Id $id,
        private {Feature}Status $status,
        // ... other state
    ) {}

    public static function create({Feature}Id $id, /* params */): self
    {
        $instance = new self($id, {Feature}Status::ACTIVE);
        $instance->domainEvents[] = new {FactName}(
            eventId: \Ramsey\Uuid\Uuid::uuid4()->toString(),
            occurredAt: new \DateTimeImmutable(),
            aggregateId: (string) $id,
        );
        return $instance;
    }

    /** @return array<object> */
    public function pullDomainEvents(): array
    {
        $events = $this->domainEvents;
        $this->domainEvents = [];
        return $events;
    }

    // Behavior methods only — no setters
}
```

### 2.4 Port In / Use Case Interface

```php
interface {UseCaseName}UseCase
{
    public function execute({UseCaseName}Command $command): Result;
}
```

### 2.5 Use Case Handler

```php
final class {UseCaseName}Handler implements {UseCaseName}UseCase
{
    public function __construct(
        private readonly {Feature}Repository $repository,
        private readonly {Feature}EventPublisher $eventPublisher,
    ) {}

    public function execute({UseCaseName}Command $command): Result
    {
        // 1. Validate
        // 2. Load/create aggregate
        // 3. Enforce invariants
        // 4. Persist via port
        // 5. Publish events via port
        // 6. Return result
        return Result::ok(/* value */);
    }
}
```

### 2.6 Result Type

```php
/**
 * @template T
 */
readonly class Result
{
    private function __construct(
        private readonly mixed $value,
        private readonly ?AppError $error,
    ) {}

    /** @return self<T> */
    public static function ok(mixed $value): self
    {
        return new self($value, null);
    }

    public static function fail(AppError $error): self
    {
        return new self(null, $error);
    }

    public function isSuccess(): bool { return $this->error === null; }
    public function getValue(): mixed { return $this->value; }
    public function getError(): ?AppError { return $this->error; }
}

readonly class AppError
{
    public function __construct(
        public readonly string $code,
        public readonly string $message,
    ) {}
}
```

---

## 3. API Conventions

```php
final class {Feature}Controller extends Controller
{
    public function __construct(
        private readonly {UseCaseName}UseCase $useCase,
    ) {}

    public function store({UseCaseName}Request $request): JsonResponse
    {
        $command = new {UseCaseName}Command(
            // map from $request->validated()
        );

        $result = $this->useCase->execute($command);

        if (!$result->isSuccess()) {
            return response()->json([
                'type'   => 'https://example.com/errors/' . $result->getError()->code,
                'title'  => $result->getError()->message,
                'status' => 422,
            ], 422);
        }

        return response()->json($result->getValue(), 201);
    }
}
```

---

## 4. Testing Template

### Domain Tests (pure unit)
```php
public function test_throws_when_invariant_violated(): void
{
    $this->expectException({Feature}Exception::class);
    {Feature}::create({Feature}Id::generate(), /* invalid params */);
}
```

### Application Tests (mocked ports)
```php
public function test_returns_success_on_valid_command(): void
{
    $this->repository->method('save')->willReturn(Result::ok($id));
    $result = $this->handler->execute($this->validCommand);
    $this->assertTrue($result->isSuccess());
}
```

### Infrastructure Tests (database)
```php
/** @test */
public function it_persists_and_retrieves_aggregate(): void
{
    // Uses in-memory SQLite or Testcontainers
    $adapter = new {Feature}RepositoryAdapter($this->connection);
    $adapter->save($this->aggregate);
    $found = $adapter->findById($this->aggregate->getId());
    $this->assertNotNull($found);
}
```

---

## 5. Mandatory CI Gates

- Build passes (`composer install`, `php artisan optimize`)
- Unit tests pass (`phpunit --testsuite=Unit`)
- Integration tests pass (`phpunit --testsuite=Integration`)
- PHPStan level 8+ passes
- PHP_CodeSniffer (PSR-12) passes
- Deptrac / PHPArkitect architecture rules pass
- `composer audit` OWASP dependency check passes
