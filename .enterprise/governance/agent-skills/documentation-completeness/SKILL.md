---
name: documentation-completeness
description: Validate documentation coverage for public code, APIs, architecture, and decision records.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Documentation Completeness

## When to use
Use this skill when:
- reviewing a PR that introduces or modifies public code
- generating documentation for new classes, methods, or APIs
- auditing a module's documentation coverage
- validating OpenAPI/Swagger specifications

---

## 1. Code Documentation Rules

### 1.1 Universal Rules
- DOC-01: All **public** classes, interfaces, functions, and methods MUST have documentation comments.
- DOC-02: Documentation MUST describe **what** and **why** — not **how** (implementation details belong in code).
- DOC-03: **Domain concepts** (aggregates, value objects, domain events, use cases) MUST include a business-level description, not just a technical one.
- DOC-04: Parameters MUST be documented when their purpose is not obvious from the name alone.
- DOC-05: Return values MUST be documented when non-trivial.
- DOC-06: Error conditions / exceptions / failure modes MUST be documented.
- DOC-07: Deprecated members MUST carry a deprecation notice with: reason, since version, and migration path.
- DOC-08: AI-generated code MUST be reviewed and documented — "generated" is not a substitute for documentation.

### 1.2 C# / .NET
- DOC-09: All public members MUST use XML documentation comments (`///`).
- DOC-10: Minimum required tags: `<summary>`. Add `<param>`, `<returns>`, `<exception>` when applicable.
- DOC-11: `<summary>` MUST be a complete sentence describing behavior from the caller's perspective.
- DOC-12: Internal and private members MAY use inline comments (`//`) for complex logic only.

### 1.3 Flutter / Dart
- DOC-13: All public members MUST use DartDoc comments (`///`).
- DOC-14: First line MUST be a single-sentence summary ending in a period.
- DOC-15: Multi-line docs use `///` on each line.
- DOC-16: Widget constructors MUST document their parameters, especially required ones.

### 1.4 TypeScript / React Native
- DOC-17: All exported functions, components, hooks, and types MUST use TSDoc (`/** ... */`).
- DOC-18: Component props MUST be documented — each prop with its purpose and constraints.
- DOC-19: Custom hooks MUST document their return value and side effects.
- DOC-20: Generic type parameters MUST be documented when non-obvious.

### 1.5 Java
- DOC-21: All public members MUST use Javadoc (`/** ... */`).
- DOC-22: Required tags: `@param`, `@return`, `@throws` for all applicable members.
- DOC-23: Class-level Javadoc MUST describe the class responsibility and its domain role.

### 1.6 Go
- DOC-24: All exported identifiers MUST have Go doc comments (line comment starting with identifier name).
- DOC-25: Package-level doc comment MUST exist in each package.
- DOC-26: Interface documentation MUST describe the contract, not the implementation.

### 1.7 PHP
- DOC-27: All public members MUST use PHPDoc (`/** ... */`).
- DOC-28: Type hints in PHPDoc MUST be consistent with PHP type declarations.

### 1.8 C++
- DOC-29: All public classes and functions MUST use Doxygen-compatible comments.
- DOC-30: Required tags: `@brief`, `@param`, `@return`, `@throws` where applicable.

---

## 2. API Documentation Rules

### 2.1 HTTP REST APIs
- DOC-31: Every public HTTP endpoint MUST be documented in an OpenAPI/Swagger specification.
- DOC-32: Each endpoint MUST document:
  - summary (one line) and description (expanded)
  - all path, query, and header parameters with types and descriptions
  - request body schema with field descriptions
  - all response schemas (success + error) with field descriptions
  - all possible HTTP status codes with meanings
- DOC-33: Error response envelope MUST be consistent and documented.
- DOC-34: Authentication requirements MUST be documented per endpoint.
- DOC-35: Swagger/OpenAPI MUST be enabled in development and staging; optional in production.

### 2.2 gRPC / Protocol Buffers
- DOC-36: All services, RPCs, messages, and fields MUST have doc comments in `.proto` files.
- DOC-37: Enum values MUST be documented with their meaning.

### 2.3 Event / Message Schemas
- DOC-38: All event types MUST have a description of the business fact they represent.
- DOC-39: All event payload fields MUST be described.
- DOC-40: `schemaVersion` change history MUST be documented alongside the schema.

---

## 3. Architecture Documentation Rules

- DOC-41: Services MUST maintain an architecture document describing their domain responsibility and layer structure.
- DOC-42: Architecture documents MUST reference the applicable stack standard and this document.
- DOC-43: Significant architectural changes MUST update the architecture document as part of the same PR.
- DOC-44: README MUST be updated whenever setup steps, configuration, environment variables, or running instructions change.

---

## 4. What Does NOT Need Documentation

- Private implementation methods where the code is self-explanatory
- Auto-generated code (migrations, proto-generated stubs) — document the source, not the generated output
- Test setup helpers and fixtures (internal to test project)
- Simple property accessors (getters/setters with no logic)

---

## Examples

✅ Good (C#):
```csharp
/// <summary>
/// Places a new order for the specified customer.
/// Validates inventory availability before committing.
/// </summary>
/// <param name="command">The order placement command with items and shipping details.</param>
/// <returns>The identifier of the newly created order.</returns>
/// <exception cref="InsufficientInventoryException">Thrown when one or more items are out of stock.</exception>
public async Task<OrderId> HandleAsync(PlaceOrderCommand command)
```

✅ Good (TypeScript):
```typescript
/**
 * Hook for managing order list state with pagination and filtering.
 * @returns orders array, loading state, error state, and pagination controls.
 */
export function useOrderList(filters: OrderFilters): OrderListState
```

❌ Bad: Public class with no doc comment.
❌ Bad: `/// Gets the order.` — restates the method name, adds no value.
❌ Bad: OpenAPI endpoint with no parameter descriptions and no error responses documented.
