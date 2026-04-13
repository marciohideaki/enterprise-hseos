---
name: simplicity-first
tier: full
version: "1.0"
description: "Use when writing or reviewing code to avoid premature abstractions, overengineering, and speculative complexity. Implement only what the current requirement demands."
license: Apache-2.0
metadata:
  owner: platform-governance
  source-inspiration: andrej-karpathy-skills (conceptual reference)
---

# Simplicity First

## When to use
Use this skill when:
- implementing any feature, fix, or task before writing code
- reviewing code for unnecessary abstractions or premature complexity
- deciding whether to extract a helper, create an interface, or add a parameter
- evaluating a design proposal for speculative elements

---

## 1. Core Principle

> "Good code is code that solves today's problem simply, not tomorrow's problem prematurely."

The goal is not to write clever code. It is to write the minimum code that makes the requirement true — verifiable by tests, readable by humans, changeable without ceremony.

Complexity has a real cost:
- Cognitive load for the next developer (often you, in 3 months)
- Test surface to maintain
- More code = more places for bugs
- Abstraction premature = abstraction wrong (requirements will change before the pattern is needed)

---

## 2. The Abstraction Rule

> Abstract only when two concrete examples already exist AND a third is anticipated.

**One type:** implement directly.
**Two types:** notice the duplication, do not abstract yet.
**Three types:** the pattern is proven — abstract now.

This rule prevents the most common LLM-era failure: abstracting a single use case into a framework.

### Example

```
# Requirement: apply 10% discount to orders

✅ Simple — solves today
def apply_discount(order):
    return order.total * 0.90

❌ Premature — solves an imaginary future
class DiscountStrategy(ABC):
    @abstractmethod
    def calculate(self, order) -> float: ...

class PercentageDiscount(DiscountStrategy):
    def __init__(self, rate: float): self.rate = rate
    def calculate(self, order): return order.total * (1 - self.rate)

class DiscountFactory:
    @staticmethod
    def create(type: str) -> DiscountStrategy:
        if type == 'percentage': return PercentageDiscount(0.10)
        raise ValueError(f"Unknown discount type: {type}")

# Cost: 4 classes, 3 files, Strategy pattern — for one discount type.
# When the second type arrives, the abstraction will likely be wrong anyway.
```

---

## 3. Surgical Changes

Every changed line must trace directly to the current requirement.

**Prohibited when fixing a bug:**
- Renaming variables for style preferences
- Extracting methods "while you're in here"
- Reformatting code in unrelated functions
- Adding logging to adjacent methods

**Prohibited when implementing a feature:**
- Refactoring existing code that works
- Adding error handling for scenarios that cannot occur given current callers
- Generalizing a parameter "in case"

If refactoring is genuinely needed, it belongs in a **separate commit** with its own justification. Never bundle structural changes with behavioral changes — they produce unreviable PRs.

---

## 4. Think Before Coding

Before writing any code, make assumptions and confusions explicit:

1. Restate the requirement in your own words
2. List your assumptions ("I assume X means Y")
3. Identify any vague terms ("export data" — what format? which fields? size limit?)
4. Request resolution for ambiguities — do not silently pick an interpretation

This is not a spec process (that is `spec-driven`). This is a one-minute qualification before any implementation, including small tasks.

---

## 5. Complexity Cost Framework

When tempted to add complexity, evaluate:

| Question | If NO → don't add |
|---|---|
| Does a second concrete use case exist today? | Interface / abstraction |
| Will the caller vary this parameter? | Optional parameter |
| Is this called from more than one place? | Extracted helper |
| Does this fail in a way that's currently reachable? | Error handling |
| Is this configuration varied across environments? | Config flag |

---

## 6. Racionalizações Comuns

| Racionalização | Realidade |
|---|---|
| "Vamos precisar disso depois" | YAGNI. Quando precisar, o design será diferente mesmo. |
| "É mais limpo com uma interface" | Limpeza tem custo. Uma abstração prematura é um bug futuro. |
| "Refatorei enquanto estava mexendo" | Mudanças comportamentais e estruturais não pertencem ao mesmo commit. |
| "O padrão Strategy é mais extensível" | Extensível para o quê? Se não há segundo caso, é especulação. |
| "Só vou extrair essa função pequena" | Uma função extraída de um único caller não reduz complexidade — a move. |

---

## 7. Sinais de Alerta (Red Flags)

- Strategy / Factory / Builder com uma implementação só
- Interface criada sem dois implementadores concretos existentes
- Abstração que não simplifica o caso de uso atual do caller
- Helper extraído chamado de um único lugar
- Função com 4+ parâmetros opcionais quando caller usa 2
- Comentário "// TODO: add other types" como justificativa para design
- Config flag para comportamento que não varia hoje
- Refactoring bundled com bug fix no mesmo commit

---

## 8. Verificação (Exit Criteria)

- [ ] Cada arquivo modificado tem justificativa direta no requirement
- [ ] Nenhuma abstração nova existe sem dois casos de uso concretos
- [ ] Nenhum parâmetro opcional foi adicionado sem caller que o use
- [ ] Helpers extraídos são chamados de pelo menos dois locais distintos
- [ ] Refactoring estrutural (se necessário) está em commit separado
- [ ] O diff implementa exatamente o que foi pedido — nem mais, nem menos

---

## Relationship to Other Skills

- **`spec-driven`** — Simplicity First aplica-se dentro de cada task do spec; spec define o que implementar, Simplicity First define como não implementar a mais
- **`systematic-debugging`** §4.1 — "Apply Minimal Fix" é Surgical Changes aplicado a bug fixes
- **`pr-review`** — Red flag: refactoring bundled com feature/fix é motivo de REJECTED
- **`verification-before-completion`** — Gate 1 (Functional Correctness) verifica que o código faz o que foi pedido; Simplicity First verifica que não faz além disso
