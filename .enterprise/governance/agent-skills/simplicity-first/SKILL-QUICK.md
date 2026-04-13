---
name: simplicity-first
tier: quick
version: "1.0"
description: "Use when writing or reviewing code to avoid premature abstractions, overengineering, and speculative complexity. Implement only what the current requirement demands."
license: Apache-2.0
metadata:
  owner: platform-governance
  source-inspiration: andrej-karpathy-skills (conceptual reference)
---

# Simplicity First — Quick Reference

## Core Rule

> "Good code is code that solves today's problem simply, not tomorrow's problem prematurely."

Implement the minimal code that directly solves the stated requirement.
No features beyond what was asked. No speculative abstractions. No future-proofing.

---

## The Abstraction Rule

Abstract only when **two concrete examples already exist** AND a third is anticipated.

| Situation | Action |
|---|---|
| 1 concrete type exists | Implement directly — no interface, no pattern |
| 2 concrete types exist | Consider abstraction if a third is coming |
| 3+ concrete types exist | Abstract — the pattern is proven |

---

## Red Flags (Stop Immediately)

- Strategy / Factory / Builder pattern with **only one concrete implementation**
- Interface or abstract class created "for future extensibility" with no second use
- Abstraction layer that adds cognitive load but reduces no actual complexity
- Generic utility extracted for "reuse" but called from exactly one place
- Function with 4+ optional parameters when the caller uses 2
- "We might need this later" as justification for any design decision
- Config flags / feature toggles for behavior that doesn't vary today

---

## Correct Patterns

```
✅ Solve today's problem directly
   discount = order.total * 0.10
   final = order.total - discount

❌ Solve tomorrow's imaginary problem
   interface DiscountStrategy { calculate(order): number }
   class PercentageDiscount implements DiscountStrategy { ... }
   class DiscountFactory { static create(type): DiscountStrategy }
   // One discount type exists. Three files. Zero benefit.
```

---

## Surgical Changes Rule

Every changed line must trace directly to the current requirement.

- Do not refactor adjacent code while implementing a feature
- Do not "improve" style, naming, or structure beyond the task scope
- Do not add error handling for scenarios that cannot occur today
- Do not extract helpers for one-time operations

---

## When to Load Tier 2 (SKILL.md)

- Code review reveals systemic overengineering across multiple files
- Architecture discussion about abstractions and extension points
- Deciding between YAGNI vs extensibility trade-offs in design review
