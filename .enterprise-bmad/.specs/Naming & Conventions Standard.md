# Naming & Conventions Standard

**Version:** 2.0

---

## 1. Purpose

This document defines **mandatory naming and convention rules** for all projects.
It is designed to be **multi-stack, AI-safe and architecture-aligned**.

The standard is divided into:
- **Core Semantic Rules** (immutable, shared across all stacks)
- **Stack Profiles** (syntax and tooling adaptations per technology)

---

## 2. Core Semantic Rules (MANDATORY)

These rules apply **equally** to C#, Flutter and React Native.

### 2.1 Language & Semantics

- English is mandatory
- Names must be explicit and intention-revealing
- Avoid abbreviations unless industry-standard
- Verbs express actions; nouns express entities

### 2.2 Architectural Concepts

- Use Case names describe business capabilities
- Commands use present tense (imperative)
- Events use past tense (facts that happened)
- Queries never imply mutation
- Avoid generic names like `Utils`, `Helpers`, `Common`

### 2.3 APIs & Contracts

- Resource-oriented naming
- Explicit versioning
- Field names must be consistent across backend and clients

---

## 3. Backend Profile — C# / .NET

### 3.1 Code Elements

- Namespaces: PascalCase
- Classes: PascalCase
- Methods: PascalCase
- Properties: PascalCase
- Variables/parameters: camelCase

### 3.2 Files & Folders

- Files: PascalCase.cs
- Folders: PascalCase

### 3.3 Events

- Event classes: `OrderPlaced`
- Event properties: PascalCase

---

## 4. Mobile Profile — Flutter / Dart

### 4.1 Code Elements

- Classes: PascalCase
- Methods/functions: camelCase
- Variables: camelCase

### 4.2 Files & Folders

- Files: snake_case.dart
- Folders: snake_case

### 4.3 Widgets

- Widgets: PascalCase
- Widget files: snake_case.dart

---

## 5. Frontend Profile — React Native / TypeScript

### 5.1 Code Elements

- Components: PascalCase
- Hooks: camelCase starting with `use`
- Functions/variables: camelCase

### 5.2 Files & Folders

- Components: PascalCase.tsx
- Hooks/utils: camelCase.ts
- Folders: kebab-case

---

## 6. AI Enforcement Rules

- AI agents must select the correct **stack profile** before generating code
- Mixing conventions across stacks is forbidden
- Semantic rules always override stylistic preferences

---

## Summary

This standard ensures **semantic consistency across products and stacks**, while respecting
**language-specific idioms and tooling expectations**.

It is designed to be enforceable by humans, CI pipelines and AI agents.