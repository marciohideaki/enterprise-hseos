# PHP — Modern Features Standard

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** PHP 8.3+ modern features — adoption guidance and mandatory patterns

> Defines mandatory rules and patterns for adopting PHP 8.1–8.3 modern language features.
> Supplements the PHP Architecture Standard and PHP Idiomatic Guide.

---

## 1. Readonly Properties e Classes

**Rules MF-PHP-01 through MF-PHP-08**

### MF-PHP-01 — `readonly` Properties (PHP 8.1+)

A `readonly` property can be assigned only once, inside the constructor. Any subsequent write raises an `Error` at runtime. Use `readonly` on individual properties of a mutable class when only those properties are immutable.

```php
declare(strict_types=1);

class UserProfile
{
    public readonly string $email;
    public string $displayName;

    public function __construct(string $email, string $displayName)
    {
        $this->email = $email;        // allowed: first assignment
        $this->displayName = $displayName;
    }

    public function rename(string $newName): void
    {
        $this->displayName = $newName; // allowed: mutable property
        // $this->email = 'new@email.com'; // Error: readonly property
    }
}
```

### MF-PHP-02 — `readonly` Classes (PHP 8.2+)

A `readonly class` declaration makes every property implicitly `readonly`. It also prevents dynamic properties. This is the preferred form for all fully immutable objects.

```php
declare(strict_types=1);

readonly class Money
{
    public function __construct(
        public int $amount,       // implicitly readonly
        public string $currency,  // implicitly readonly
    ) {
        if ($this->amount < 0) {
            throw new \InvalidArgumentException('Amount must be non-negative');
        }
    }

    public function add(Money $other): self
    {
        if ($this->currency !== $other->currency) {
            throw new \DomainException('Currency mismatch');
        }
        return new self($this->amount + $other->amount, $this->currency);
    }
}
```

### MF-PHP-03 — Mandate: Value Objects MUST use `readonly`

Value Objects, DTOs, Commands, and Domain Events represent data that is fixed after construction. They MUST be declared as `readonly class` or have every property individually declared `readonly`.

Non-compliant pattern — PROHIBITED:

```php
// PROHIBITED: Value Object without readonly — allows accidental mutation
class ProductId
{
    public function __construct(
        public string $value  // no readonly — mutable, violates VO semantics
    ) {}
}
```

Compliant pattern — REQUIRED:

```php
declare(strict_types=1);

readonly class ProductId
{
    public function __construct(
        public string $value,
    ) {
        if (trim($value) === '') {
            throw new \InvalidArgumentException('ProductId cannot be blank');
        }
    }

    public function equals(self $other): bool
    {
        return $this->value === $other->value;
    }
}
```

### MF-PHP-04 — Command as `readonly class`

Application layer commands represent an intent that must not change after dispatch. They MUST be `readonly class`.

```php
declare(strict_types=1);

readonly class PlaceOrderCommand
{
    public function __construct(
        public string $customerId,
        public string $productId,
        public int    $quantity,
        public string $currency,
    ) {}
}
```

### MF-PHP-05 — Domain Event as `readonly class`

Domain events are facts about the past — they are immutable by definition.

```php
declare(strict_types=1);

readonly class OrderPlacedEvent
{
    public \DateTimeImmutable $occurredAt;

    public function __construct(
        public string $orderId,
        public string $customerId,
        public int    $totalAmount,
        public string $currency,
    ) {
        $this->occurredAt = new \DateTimeImmutable();
    }
}
```

### MF-PHP-06 — Cloning with Modified Values (`clone with`)

`readonly` does not prevent cloning an object with different values. PHP 8.4 introduced `clone with` for this pattern. For PHP 8.3, create a named factory method instead.

```php
declare(strict_types=1);

readonly class Money
{
    public function __construct(
        public int    $amount,
        public string $currency,
    ) {}

    // PHP 8.3: named factory method as substitute for clone with
    public function withAmount(int $newAmount): self
    {
        return new self($newAmount, $this->currency);
    }

    public function withCurrency(string $newCurrency): self
    {
        return new self($this->amount, $newCurrency);
    }
}

$price    = new Money(1000, 'BRL');
$discount = $price->withAmount(900);
```

### MF-PHP-07 — Deep Readonly Limitation

Arrays stored inside `readonly` properties are not deeply immutable. The array reference is frozen, but elements can be replaced by reassigning the property via `clone`. This is a known PHP limitation.

```php
declare(strict_types=1);

readonly class Cart
{
    /** @param list<string> $itemIds */
    public function __construct(
        public array $itemIds,
    ) {}
}

$cart    = new Cart(['item-1', 'item-2']);
// $cart->itemIds[] = 'item-3'; // Error: cannot modify readonly property
// Correct: produce a new instance
$updated = new Cart([...$cart->itemIds, 'item-3']);
```

### MF-PHP-08 — `readonly` and Interfaces

`readonly class` can implement interfaces and extend abstract classes, but the parent class must also declare all properties as `readonly`. Mixing `readonly` subclasses with mutable parents is PROHIBITED.

```php
declare(strict_types=1);

interface HasId
{
    public function id(): string;
}

readonly class CategoryId implements HasId
{
    public function __construct(private string $value) {}

    public function id(): string
    {
        return $this->value;
    }
}
```

---

## 2. Attributes

**Rules MF-PHP-09 through MF-PHP-16**

### MF-PHP-09 — Attributes Replace Docblock Annotations

PHP 8.0 introduced `#[Attribute]` as a first-class language construct. Attributes are parsed at compile time, are type-safe, and do not require a third-party annotation-parsing library.

New projects MUST NOT use docblock annotations (`@Route`, `@ORM\Column`, etc.). Use PHP Attributes instead.

### MF-PHP-10 — Built-in Framework Attributes

```php
declare(strict_types=1);

use Symfony\Component\Routing\Annotation\Route;
use Symfony\Component\HttpFoundation\JsonResponse;

final class UserController
{
    #[Route('/users', methods: ['GET'], name: 'user.list')]
    public function list(): JsonResponse
    {
        return new JsonResponse(['users' => []]);
    }

    #[Route('/users/{id}', methods: ['GET'], name: 'user.show')]
    public function show(string $id): JsonResponse
    {
        return new JsonResponse(['id' => $id]);
    }
}
```

### MF-PHP-11 — Defining a Custom Attribute

Custom attributes MUST declare which targets they are valid for using `Attribute::TARGET_*` constants.

```php
declare(strict_types=1);

#[Attribute(Attribute::TARGET_PROPERTY)]
final class Validate
{
    public function __construct(
        public readonly string $rule,
        public readonly ?string $message = null,
    ) {}
}
```

### MF-PHP-12 — Reading Attributes via Reflection

```php
declare(strict_types=1);

final class ValidatorResolver
{
    /** @return list<Validate> */
    public function getPropertyRules(object $object, string $property): array
    {
        $ref        = new \ReflectionProperty($object, $property);
        $attributes = $ref->getAttributes(Validate::class);

        return array_map(
            fn(\ReflectionAttribute $a): Validate => $a->newInstance(),
            $attributes
        );
    }
}
```

### MF-PHP-13 — Class-Level Attribute Example (DI Tagging)

```php
declare(strict_types=1);

#[Attribute(Attribute::TARGET_CLASS)]
final class AsEventListener
{
    public function __construct(
        public readonly string $event,
        public readonly int    $priority = 0,
    ) {}
}

#[AsEventListener(event: OrderPlacedEvent::class, priority: 10)]
final class SendOrderConfirmationEmail
{
    public function __invoke(OrderPlacedEvent $event): void
    {
        // send email
    }
}
```

### MF-PHP-14 — Attribute on Method for Authorization

```php
declare(strict_types=1);

#[Attribute(Attribute::TARGET_METHOD)]
final class RequiresRole
{
    public function __construct(
        public readonly string $role,
    ) {}
}

final class ReportController
{
    #[RequiresRole(role: 'ROLE_ADMIN')]
    public function export(): void
    {
        // only admins reach here
    }
}
```

### MF-PHP-15 — Combining Multiple Attributes

```php
declare(strict_types=1);

#[Attribute(Attribute::TARGET_PROPERTY | Attribute::IS_REPEATABLE)]
final class Assert
{
    public function __construct(
        public readonly string $constraint,
        public readonly mixed  $value = null,
    ) {}
}

final class CreateUserInput
{
    #[Assert(constraint: 'notBlank')]
    #[Assert(constraint: 'email')]
    public string $email = '';

    #[Assert(constraint: 'notBlank')]
    #[Assert(constraint: 'minLength', value: 3)]
    public string $name = '';
}
```

### MF-PHP-16 — Rule: No Docblock Annotations in New Code

The following pattern is PROHIBITED in new code:

```php
// PROHIBITED: docblock annotation — requires Doctrine Annotations or similar parser
/**
 * @ORM\Column(type="string", length=255)
 * @Assert\NotBlank()
 */
private string $email;
```

Required pattern:

```php
// REQUIRED: PHP Attribute — no external parser, type-safe
#[ORM\Column(type: 'string', length: 255)]
#[Assert\NotBlank]
private string $email;
```

---

## 3. Named Arguments

**Rules MF-PHP-17 through MF-PHP-22**

### MF-PHP-17 — Named Arguments (PHP 8.0+)

Named arguments allow passing values by parameter name, independent of position. This improves readability for calls with many parameters, especially when several are optional or boolean.

### MF-PHP-18 — Mandatory Use with Built-in Functions

Named arguments MUST be used when calling built-in PHP functions with more than 3 boolean or optional parameters to avoid ambiguity.

Prohibited pattern:

```php
// PROHIBITED: positional booleans — meaning is opaque
$result = array_slice($items, 0, 10, true);
$str    = implode(',', array_unique($list, SORT_STRING));
```

Required pattern:

```php
// REQUIRED: named for clarity
$result = array_slice(array: $items, offset: 0, length: 10, preserve_keys: true);
$words  = str_word_count(string: $sentence, format: 1, characters: '');
```

### MF-PHP-19 — Named Arguments Improve Readability for Constructors

```php
declare(strict_types=1);

readonly class Pagination
{
    public function __construct(
        public int $page,
        public int $perPage,
        public int $total,
    ) {}
}

// Without named arguments — position-dependent, fragile
$p = new Pagination(2, 25, 500);

// With named arguments — self-documenting, order-independent
$p = new Pagination(page: 2, perPage: 25, total: 500);
```

### MF-PHP-20 — Named Arguments with Attributes

When instantiating Attributes with multiple fields, named arguments MUST be used to prevent positional coupling.

```php
#[Route(
    path: '/orders/{id}/invoice',
    methods: ['GET'],
    name: 'order.invoice',
    condition: 'request.isSecure()',
)]
public function invoice(string $id): Response { /* ... */ }
```

### MF-PHP-21 — When NOT to Use Named Arguments

Named arguments MUST NOT be used to compensate for poorly named variables. Extract to a well-named variable instead.

```php
// PROHIBITED: named argument masking a bad variable name
send($to: $x, $subject: $y, $body: $z);

// REQUIRED: rename variables to be meaningful
$recipientEmail = $x;
$emailSubject   = $y;
$emailBody      = $z;
send($recipientEmail, $emailSubject, $emailBody);
```

### MF-PHP-22 — Named Arguments Are Positional in Variadic Functions

Named arguments MUST NOT be mixed with positional arguments in variadic calls — PHP raises an error. Use named arguments consistently when they are used at all in a single call.

```php
declare(strict_types=1);

function tag(string $name, string ...$classes): string
{
    return "<{$name} class=\"" . implode(' ', $classes) . '">';
}

// Valid: all positional
echo tag('div', 'card', 'shadow');

// Valid: name the first, rest variadic (PHP 8.1+)
echo tag(name: 'div', 'card', 'shadow'); // syntax error — PROHIBITED
```

---

## 4. Enums

**Rules MF-PHP-23 through MF-PHP-30**

### MF-PHP-23 — Pure Enums vs. Backed Enums

A **pure enum** has no backing scalar value and is used for internal type enumeration. A **backed enum** associates each case with a `string` or `int` value and is used when the enum is stored, serialized, or transmitted.

```php
declare(strict_types=1);

// Pure enum — no scalar value, internal use only
enum Direction
{
    case North;
    case South;
    case East;
    case West;
}

// Backed enum — string value for DB/JSON persistence
enum Color: string
{
    case Red   = 'red';
    case Green = 'green';
    case Blue  = 'blue';
}

$color = Color::from('red');    // Color::Red
$raw   = Color::Red->value;     // 'red'
$try   = Color::tryFrom('xxx'); // null — no exception
```

### MF-PHP-24 — Rule: Domain Status MUST Be Backed Enums

Domain status fields (e.g., `OrderStatus`, `PaymentStatus`, `SubscriptionStatus`) MUST be backed enums, not plain strings or class constants.

Prohibited pattern:

```php
// PROHIBITED: string constants as pseudo-enum — no type safety
class OrderStatus
{
    const PENDING   = 'pending';
    const CONFIRMED = 'confirmed';
    const CANCELLED = 'cancelled';
}
```

Required pattern:

```php
declare(strict_types=1);

enum OrderStatus: string
{
    case Pending   = 'pending';
    case Confirmed = 'confirmed';
    case Shipped   = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';
}
```

### MF-PHP-25 — Enum Methods for Domain Behaviour

Enums can define methods. Domain logic that depends on the case MUST be expressed as enum methods, not as external `match` blocks scattered throughout the codebase.

```php
declare(strict_types=1);

enum OrderStatus: string
{
    case Pending   = 'pending';
    case Confirmed = 'confirmed';
    case Shipped   = 'shipped';
    case Delivered = 'delivered';
    case Cancelled = 'cancelled';

    public function label(): string
    {
        return match($this) {
            self::Pending   => 'Awaiting confirmation',
            self::Confirmed => 'Confirmed',
            self::Shipped   => 'Shipped',
            self::Delivered => 'Delivered',
            self::Cancelled => 'Cancelled',
        };
    }

    public function isTerminal(): bool
    {
        return match($this) {
            self::Delivered, self::Cancelled => true,
            default                          => false,
        };
    }

    public function canTransitionTo(self $next): bool
    {
        return match($this) {
            self::Pending   => $next === self::Confirmed || $next === self::Cancelled,
            self::Confirmed => $next === self::Shipped   || $next === self::Cancelled,
            self::Shipped   => $next === self::Delivered,
            default         => false,
        };
    }
}
```

### MF-PHP-26 — Enum Implementing an Interface

Enums can implement interfaces. This allows using enum cases wherever the interface is expected, enabling polymorphism.

```php
declare(strict_types=1);

interface HasLabel
{
    public function label(): string;
}

enum PaymentStatus: string implements HasLabel
{
    case Pending   = 'pending';
    case Captured  = 'captured';
    case Refunded  = 'refunded';
    case Failed    = 'failed';

    public function label(): string
    {
        return match($this) {
            self::Pending  => 'Pending payment',
            self::Captured => 'Payment confirmed',
            self::Refunded => 'Refunded',
            self::Failed   => 'Payment failed',
        };
    }
}

function printStatus(HasLabel $status): void
{
    echo $status->label();
}

printStatus(PaymentStatus::Captured); // "Payment confirmed"
```

### MF-PHP-27 — Enum `cases()` for Listing All Values

Use the built-in `cases()` method to enumerate all cases without maintaining a separate array.

```php
declare(strict_types=1);

enum Permission: string
{
    case Read   = 'read';
    case Write  = 'write';
    case Delete = 'delete';
    case Admin  = 'admin';

    /** @return list<string> */
    public static function allValues(): array
    {
        return array_column(self::cases(), 'value');
    }
}

$all = Permission::allValues(); // ['read', 'write', 'delete', 'admin']
```

### MF-PHP-28 — Enums in Match Expressions

Enums are first-class values in `match`. Exhaustiveness checking by static analysers (PHPStan, Psalm) prevents missing cases.

```php
declare(strict_types=1);

function orderStatusColor(OrderStatus $status): string
{
    return match($status) {
        OrderStatus::Pending   => '#f59e0b',
        OrderStatus::Confirmed => '#3b82f6',
        OrderStatus::Shipped   => '#8b5cf6',
        OrderStatus::Delivered => '#10b981',
        OrderStatus::Cancelled => '#ef4444',
    };
}
```

---

## 5. Fibers

**Rules MF-PHP-29 through MF-PHP-34**

### MF-PHP-29 — What Fibers Are

Fibers (PHP 8.1+) are pausable functions — stackful coroutines that can suspend execution with `Fiber::suspend()` and be resumed by the caller. They are the primitive on which event-loop frameworks build async I/O without true OS threads.

Fibers are **low-level primitives**. Application code MUST NOT use the `Fiber` class directly. Use framework-provided abstractions (Revolt, ReactPHP, AMPHP, Laravel Octane).

### MF-PHP-30 — Fiber Basics

```php
declare(strict_types=1);

$fiber = new Fiber(function (): void {
    $value = Fiber::suspend('first suspension');
    echo "Resumed with: {$value}\n";
    Fiber::suspend('second suspension');
    echo "Fiber complete\n";
});

$result1 = $fiber->start();         // 'first suspension'
$result2 = $fiber->resume('hello'); // 'second suspension'
$fiber->resume('world');            // 'Fiber complete'

echo $result1; // first suspension
echo $result2; // second suspension
```

### MF-PHP-31 — When to Use Fibers

Use Fibers only when the underlying framework already runs an event loop that uses them. Do not introduce Fibers into synchronous request-response code.

| Context | Use Fibers? |
|---|---|
| Laravel (FPM, no Octane) | No |
| Laravel Octane + Swoole | Yes, via framework API |
| Symfony with Revolt Runtime | Yes, via Revolt event loop |
| ReactPHP application | Yes, via `react/async` |
| Standard CLI script | No |

### MF-PHP-32 — Revolt Event Loop Integration

```php
declare(strict_types=1);

use Revolt\EventLoop;

EventLoop::queue(function (): void {
    $fiber = new Fiber(function (): void {
        echo "Fiber start\n";
        Fiber::suspend();
        echo "Fiber resumed\n";
    });

    $fiber->start();
    EventLoop::queue(fn() => $fiber->resume());
});

EventLoop::run();
// Output: Fiber start\nFiber resumed
```

### MF-PHP-33 — Fibers and Error Handling

Exceptions thrown inside a fiber propagate to the `start()` or `resume()` call.

```php
declare(strict_types=1);

$fiber = new Fiber(function (): void {
    Fiber::suspend();
    throw new \RuntimeException('Error inside fiber');
});

try {
    $fiber->start();
    $fiber->resume(); // exception propagates here
} catch (\RuntimeException $e) {
    echo $e->getMessage(); // 'Error inside fiber'
}
```

### MF-PHP-34 — Rule: No Raw Fibers in Domain or Application Code

The Domain and Application layers MUST remain free of any `Fiber` references. Fiber usage is an infrastructure concern. If async execution is needed, inject a `TaskDispatcher` interface; the infrastructure layer provides a fiber-based implementation.

---

## 6. Intersection Types and DNF Types

**Rules MF-PHP-35 through MF-PHP-40**

### MF-PHP-35 — Intersection Types (PHP 8.1+)

Intersection types express that a value must satisfy multiple type constraints simultaneously. They use the `&` operator and are only valid with class/interface types — scalar types cannot be intersected.

```php
declare(strict_types=1);

interface Countable
{
    public function count(): int;
}

interface Serializable
{
    public function serialize(): string;
}

function processCollection(Countable&Serializable $collection): string
{
    return "Items: {$collection->count()} | " . $collection->serialize();
}
```

### MF-PHP-36 — Rule: Prefer Intersection Types Over `mixed`

When a parameter must satisfy a known set of interfaces, intersection types MUST be used instead of `mixed` or a documentation-only union. Reduces the need for runtime `instanceof` checks.

```php
// PROHIBITED: mixed hides the actual contract
function handle(mixed $repository): void
{
    assert($repository instanceof Countable);
    assert($repository instanceof \Iterator);
}

// REQUIRED: intersection type enforces the contract at call site
function handle(\Countable&\Iterator $repository): void
{
    foreach ($repository as $item) { /* ... */ }
}
```

### MF-PHP-37 — DNF Types (PHP 8.2+)

Disjunctive Normal Form (DNF) types allow combining union and intersection types. Each intersection group must be wrapped in parentheses: `(A&B)|C`.

```php
declare(strict_types=1);

interface Loggable {}
interface Auditable {}

function store((\Countable&\Iterator)|null $dataset): void
{
    if ($dataset === null) {
        return;
    }

    foreach ($dataset as $item) { /* store item */ }
    echo "Stored {$dataset->count()} items";
}

function audit((Loggable&Auditable)|string $subject): void
{
    if (is_string($subject)) {
        echo "Audit string: {$subject}";
        return;
    }
    // $subject is Loggable&Auditable here
}
```

### MF-PHP-38 — `never` Return Type

`never` declares that a function never returns to the caller — it always throws an exception or calls `exit()`. Static analysers use this to prune dead code.

```php
declare(strict_types=1);

function notFound(string $id): never
{
    throw new \DomainException("Entity not found: {$id}");
}

function abort(int $code): never
{
    http_response_code($code);
    exit();
}
```

### MF-PHP-39 — `true` and `false` as Standalone Types

`true` and `false` can be used as return types to narrow the type beyond `bool`. This improves static analysis precision for functions that always succeed or always fail.

```php
declare(strict_types=1);

function assertNonEmpty(array $items): true
{
    if (empty($items)) {
        throw new \UnderflowException('Collection must not be empty');
    }
    return true;
}

/** @throws \RuntimeException */
function tryDelete(string $path): true|false
{
    return file_exists($path) && unlink($path);
}
```

### MF-PHP-40 — Combining DNF, `never`, and Modern Types

```php
declare(strict_types=1);

interface Repository {}
interface Cacheable {}

function resolve(
    (Repository&Cacheable)|null $repo,
    string                      $id,
): array|never {
    if ($repo === null) {
        throw new \LogicException('Repository not configured');
    }

    $cached = $repo->find($id); // assume method exists via Cacheable
    return $cached ?? [];
}
```

---

## 7. PHP 8.3 Features

**Rules MF-PHP-41 through MF-PHP-46**

### MF-PHP-41 — Typed Class Constants

PHP 8.3 allows declaring a type for class constants. This prevents type coercion and improves IDE/static-analyser support.

```php
declare(strict_types=1);

final class HttpStatus
{
    const int    OK                    = 200;
    const int    CREATED               = 201;
    const int    NOT_FOUND             = 404;
    const int    INTERNAL_SERVER_ERROR = 500;
    const string DEFAULT_CHARSET       = 'UTF-8';
    const float  HTTP_VERSION          = 1.1;
}

interface Configurable
{
    const string VERSION = '1.0'; // typed interface constant (PHP 8.3+)
}
```

### MF-PHP-42 — `json_validate()`

`json_validate()` checks whether a string is valid JSON without parsing it into a PHP structure. Use it for validation pipelines where the decoded value is not needed.

```php
declare(strict_types=1);

function assertValidJson(string $payload): void
{
    if (!json_validate($payload)) {
        throw new \InvalidArgumentException('Payload is not valid JSON');
    }
}

// Contrast with the old pattern — PROHIBITED in new code when decode is not needed
function assertValidJsonOld(string $payload): void
{
    json_decode($payload); // decodes uselessly, wastes memory
    if (json_last_error() !== JSON_ERROR_NONE) {
        throw new \InvalidArgumentException('Payload is not valid JSON');
    }
}
```

### MF-PHP-43 — `#[Override]` Attribute

`#[Override]` signals that a method is intended to override a parent method or interface default. PHP raises an error at compile time if the parent does not declare the method, preventing silent bugs from typos.

```php
declare(strict_types=1);

abstract class BaseRepository
{
    abstract public function find(string $id): ?object;

    public function findAll(): array
    {
        return [];
    }
}

final class InMemoryUserRepository extends BaseRepository
{
    private array $store = [];

    #[Override]
    public function find(string $id): ?object
    {
        return $this->store[$id] ?? null;
    }

    #[Override]
    public function findAll(): array // compile error if parent renames method
    {
        return array_values($this->store);
    }
}
```

### MF-PHP-44 — `array_find()` and `array_find_key()`

PHP 8.4 previewed these; PHP 8.3 does not have them natively — use polyfill patterns. `array_find()` returns the first element for which the predicate is true; `array_find_key()` returns its key.

```php
declare(strict_types=1);

// PHP 8.4+ native usage (document for forward compatibility)
// $first = array_find($users, fn(User $u) => $u->isAdmin());

// PHP 8.3 equivalent — wrap in a named helper
function arrayFind(array $array, callable $predicate): mixed
{
    foreach ($array as $item) {
        if ($predicate($item)) {
            return $item;
        }
    }
    return null;
}

function arrayFindKey(array $array, callable $predicate): int|string|null
{
    foreach ($array as $key => $item) {
        if ($predicate($item)) {
            return $key;
        }
    }
    return null;
}

$admin = arrayFind($users, fn(array $u) => $u['role'] === 'admin');
```

### MF-PHP-45 — `Random\Randomizer` for Secure Randomness

The `Random` extension (PHP 8.2+, stabilised in PHP 8.3) provides `\Random\Randomizer` with pluggable engines. Use `Secure` engine for cryptographic use cases instead of `rand()` or `mt_rand()`.

```php
declare(strict_types=1);

use Random\Engine\Secure;
use Random\Randomizer;

function generateToken(int $length = 32): string
{
    $randomizer = new Randomizer(new Secure());
    return $randomizer->getBytes($length);
}

function generateHexToken(int $bytes = 16): string
{
    $randomizer = new Randomizer(new Secure());
    return bin2hex($randomizer->getBytes($bytes));
}

function pickRandomItems(array $pool, int $count): array
{
    $randomizer = new Randomizer(new Secure());
    return $randomizer->pickArrayKeys($pool, $count);
}
```

### MF-PHP-46 — Multibyte String Improvements

PHP 8.3 added `mb_str_pad()` and stabilised `mb_str_split()`. Use these functions whenever string data may contain multibyte characters (UTF-8). Using single-byte string functions on multibyte data is PROHIBITED.

```php
declare(strict_types=1);

// PROHIBITED: strlen/substr on multibyte strings
$len = strlen('こんにちは'); // returns bytes (15), not characters (5)

// REQUIRED: mb_ functions for multibyte content
$len    = mb_strlen('こんにちは', 'UTF-8');              // 5
$chars  = mb_str_split('こんにちは', 1, 'UTF-8');        // ['こ','ん','に','ち','は']
$padded = mb_str_pad('hello', 10, ' ', STR_PAD_RIGHT, 'UTF-8'); // 'hello     '
$sub    = mb_substr('こんにちは', 1, 3, 'UTF-8');         // 'んにち'
```

---

## Summary Table

| Rule | Feature | Enforcement |
|---|---|---|
| MF-PHP-03 | Value Objects MUST be `readonly` | PHPStan / code review |
| MF-PHP-04 | Commands MUST be `readonly class` | PHPStan / code review |
| MF-PHP-05 | Events MUST be `readonly class` | PHPStan / code review |
| MF-PHP-09 | No docblock annotations in new code | PHPStan / ESLint-PHP |
| MF-PHP-18 | Named args for built-ins with >3 boolean params | Code review |
| MF-PHP-24 | Domain status MUST be backed enum | PHPStan / code review |
| MF-PHP-29 | No raw `Fiber` in domain/application code | PHPStan custom rule |
| MF-PHP-34 | Fiber usage restricted to infrastructure | Architecture review |
| MF-PHP-36 | Intersection types over `mixed` | PHPStan level 8 |
| MF-PHP-42 | `json_validate()` instead of decode+check | Code review |
| MF-PHP-46 | `mb_*` functions for multibyte strings | PHPStan / code review |
