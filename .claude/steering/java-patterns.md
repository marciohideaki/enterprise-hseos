---
inclusion: fileMatch
fileMatchPattern: "**/*.java"
description: Java idioms and standards — auto-loaded when editing Java files
---

# Java Patterns — Auto-Loaded for *.java Files

> Loaded automatically when editing Java source files.
> For full Java standard: `.enterprise/.specs/Java/_INDEX.md`

## Naming Conventions (Java)
- Classes/interfaces: `PascalCase`
- Methods/variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE`
- Packages: `lowercase.dot.separated`
- Test classes: `FooTest` or `FooIT` (integration)

## Hexagonal Architecture (mandatory — see ADR-0001)
```
domain/        ← pure business logic, no framework deps
application/   ← use cases, ports (interfaces)
infrastructure/ ← adapters (JPA, REST, messaging)
api/           ← HTTP controllers (thin, delegates to application)
```

## Immutability
```java
// CORRECT: records for value objects (Java 14+)
public record Money(BigDecimal amount, Currency currency) {}

// CORRECT: immutable collections
List<Item> items = List.copyOf(mutableList);

// AVOID: mutable value objects
```

## Error Handling
- Domain exceptions extend `DomainException` (unchecked)
- Infrastructure exceptions wrapped at adapter boundary
- Never swallow `InterruptedException`
- Log at boundary — not in domain

## Testing
- Unit: JUnit 5 + Mockito + AssertJ
- Integration: `@SpringBootTest` with Testcontainers
- Naming: `methodName_scenario_expectedResult()`
- Minimum coverage: domain ≥ 90%, application ≥ 80%

## Load Full Java Standard When
- Designing a new microservice
- Configuring Spring Boot or build toolchain
- Setting up Gradle/Maven multi-module
