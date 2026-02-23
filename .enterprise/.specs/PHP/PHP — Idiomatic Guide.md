# PHP — Idiomatic Guide
## Gold Standard / State-of-the-Art Backend Engineering

**Version:** 1.0
**Status:** Canonical / Normative
**Runtime:** PHP 8.3+

> Defines mandatory PHP language idioms, modern feature usage, and community best practices.
> Supplements the PHP Architecture Standard.

---

## 1. Modern PHP Feature Adoption

- IG-01: PHP 8.3 is the minimum version for all new services.
- IG-02: `declare(strict_types=1)` mandatory on every PHP file — no implicit type coercion.
- IG-03: `readonly class` (PHP 8.2+) used for Value Objects and immutable DTOs.
- IG-04: `readonly` properties (PHP 8.1+) used for immutable fields in non-readonly classes.
- IG-05: Constructor property promotion (PHP 8.0+) used for simple constructor assignments.
- IG-06: Named arguments (PHP 8.0+) used when calling functions with many parameters or when argument order is unclear.
- IG-07: `match` expression (PHP 8.0+) preferred over `switch` for value-returning logic.
- IG-08: Enums (PHP 8.1+) used for all fixed sets of values — no class constants as pseudo-enums.
- IG-09: First-class callable syntax (PHP 8.1+) `strlen(...)` used instead of `Closure::fromCallable('strlen')`.
- IG-10: Fibers (PHP 8.1+) used for cooperative multitasking where applicable (Laravel Octane, Swoole).

```php
declare(strict_types=1);

// readonly class for Value Object
readonly class OrderId
{
    public function __construct(
        public readonly string $value,
    ) {
        if (empty($value)) {
            throw new \InvalidArgumentException('OrderId cannot be empty');
        }
    }
}

// Enum for fixed values
enum OrderStatus: string
{
    case Pending   = 'pending';
    case Confirmed = 'confirmed';
    case Cancelled = 'cancelled';

    public function label(): string
    {
        return match($this) {
            self::Pending   => 'Awaiting confirmation',
            self::Confirmed => 'Confirmed',
            self::Cancelled => 'Cancelled',
        };
    }
}
```

---

## 2. Type System

- IG-11: All function parameters and return types must be typed — no untyped signatures.
- IG-12: Union types (PHP 8.0+) used instead of docblock `@param int|string`: `int|string $id`.
- IG-13: Intersection types (PHP 8.1+) for type constraints: `Countable&Iterator $collection`.
- IG-14: `never` return type for functions that always throw or exit.
- IG-15: `mixed` type used only when truly mixed — document why in PHPDoc.
- IG-16: Nullable types `?string` used instead of `string|null` for simple nullable parameters.
- IG-17: DNF (Disjunctive Normal Form) types (PHP 8.2+) for complex type expressions: `(Countable&Iterator)|null`.

---

## 3. Immutability

- IG-18: `readonly class` for all Value Objects and immutable data carriers.
- IG-19: Wither methods (immutable update pattern) used instead of setters:

```php
readonly class Money
{
    public function __construct(
        public readonly int $amount,
        public readonly string $currency,
    ) {}

    public function withAmount(int $amount): self
    {
        return new self($amount, $this->currency);
    }
}
```

- IG-20: No public non-readonly properties on domain objects.

---

## 4. Error Handling

- IG-21: Custom exception hierarchy: one base exception per bounded context, typed subtypes per error.
- IG-22: `Throwable` caught at layer boundaries — both `Exception` and `Error`.
- IG-23: `@` error suppression operator forbidden — use proper exception handling.
- IG-24: Exception messages actionable — include the problematic value and context.
- IG-25: `finally` used for cleanup when `try/catch` is present.
- IG-26: Infrastructure exceptions caught and translated to domain exceptions at layer boundary.

---

## 5. Null Handling

- IG-27: Null coalescing operator `??` used for default values: `$value = $input ?? 'default'`.
- IG-28: Null coalescing assignment `??=` used for lazy initialization.
- IG-29: Nullsafe operator `?->` used for optional chaining: `$order?->getCustomer()?->getName()`.
- IG-30: Null returns avoided at application boundaries — use `Result<T>` or throw.
- IG-31: `null` parameters avoided — use `?TypeName` only when absence is meaningful.

---

## 6. Arrays & Collections

- IG-32: Typed collections (DTOs with array properties typed as `array<int, OrderItem>` in PHPDoc) preferred over raw arrays.
- IG-33: `array_map`, `array_filter`, `array_reduce` preferred over manual loops for transformations.
- IG-34: Spread operator `...$items` used for array unpacking.
- IG-35: Laravel Collections or `illuminate/collections` used for complex array manipulation in application layer.
- IG-36: `count($array) > 0` replaced by `!empty($array)` or `$array !== []`.

---

## 7. Concurrency (Fibers & Async)

- IG-37: Fibers (PHP 8.1+) used for cooperative multitasking — not preemptive.
- IG-38: Laravel Octane (Swoole/RoadRunner) used for high-throughput services — requires statelessness review.
- IG-39: Shared mutable state avoided between requests in Octane/Swoole environments — no static properties holding request state.
- IG-40: `ReactPHP` or `Amp` used for event-loop based async where full async is needed.

---

## 8. PSR Compliance

- IG-41: PSR-1: Class names in `StudlyCaps`, methods in `camelCase`, constants in `UPPER_CASE`.
- IG-42: PSR-4: Namespace maps 1:1 to directory structure.
- IG-43: PSR-12: Extended coding style — enforced via PHP-CS-Fixer.
- IG-44: PSR-7: HTTP Message Interface used for HTTP abstractions.
- IG-45: PSR-11: Container interface used for DI — no framework-specific container in domain/application.

---

## 9. Anti-Patterns (Forbidden)

| Anti-Pattern | Why |
|---|---|
| Missing `declare(strict_types=1)` | Silent type coercion bugs |
| `@` error suppression | Hides errors silently |
| Untyped function signatures | Defeats static analysis |
| `static` properties for request state | Shared state in Octane/Swoole |
| Class constants as pseudo-enums | Use PHP 8.1 Enums |
| `isset()` to check nullable | Use null coalescing instead |
| Raw array instead of typed DTO | No type safety |
