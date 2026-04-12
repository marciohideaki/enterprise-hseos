---
name: naming-conventions
tier: quick
version: "1.0.0"
description: "Use when reviewing code, file names, or API identifiers for compliance with naming standards"
---

# Naming Conventions — Quick Check

> Tier 1: use when reviewing or generating code names across any stack.
> Load SKILL.md (Tier 2) for full stack profiles and semantic rules.

---

## Universal Rules (all stacks)
- [ ] Names in English — no Portuguese, Spanish, or other languages
- [ ] No abbreviations unless universally known (`id`, `url`, `dto`, `api`)
- [ ] No generic names: `Utils`, `Helper`, `Manager`, `Common`, `Data`, `Info`
- [ ] Commands named in imperative form: `PlaceOrder`, `CancelSubscription`
- [ ] Events named in past tense: `OrderPlaced`, `SubscriptionCancelled`
- [ ] Queries named as noun/interrogative: `GetOrderById`, `ListActiveUsers`

## C# / .NET
- [ ] Classes, methods, properties: `PascalCase`
- [ ] Private fields: `_camelCase`
- [ ] Local variables, parameters: `camelCase`
- [ ] Interfaces prefixed with `I`: `IOrderRepository`
- [ ] Async methods suffixed with `Async`: `GetOrderAsync`

## Flutter / Dart
- [ ] Classes, enums: `PascalCase`
- [ ] Variables, functions, parameters: `camelCase`
- [ ] Files and folders: `snake_case`
- [ ] Private members: `_camelCase`

## React Native / TypeScript
- [ ] Components: `PascalCase`
- [ ] Hooks: `useCamelCase`
- [ ] Variables, functions: `camelCase`
- [ ] Folders: `kebab-case`
- [ ] Types and Interfaces: `PascalCase`

## Java
- [ ] Classes, interfaces, enums: `PascalCase`
- [ ] Methods, variables: `camelCase`
- [ ] Constants: `UPPER_SNAKE_CASE`
- [ ] Packages: `lowercase.dotted`

## Go
- [ ] Exported identifiers: `PascalCase`
- [ ] Unexported identifiers: `camelCase`
- [ ] Interfaces: descriptive noun, not `-er` suffix unless idiomatic (`Reader`, `Writer`)
- [ ] Files: `snake_case.go`

---

## Verdict

**PASS** → all naming follows conventions.
**FAIL** → violations found — load `SKILL.md` (Tier 2) for full rules and fix guidance.
