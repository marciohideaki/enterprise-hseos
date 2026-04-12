---
name: systematic-debugging
tier: full
version: "1.0"
description: "Use when diagnosing a bug, investigating an error, or troubleshooting unexpected behavior before applying any fix"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
  inspired-by: superpowers/skills/systematic-debugging
---

# Systematic Debugging — Full Protocol

> Tier 2: complete 4-phase root cause investigation protocol with evidence requirements and escalation gates.

---

## Iron Law

```
NEVER apply a fix without confirming root cause.
Symptom fixes are failure — they mask problems and create technical debt.
If you don't understand WHY the fix works, it's not a fix.
```

---

## Phase 1 — Root Cause Investigation

### 1.1 Read the Error
- Read the full error message, stack trace, and log output
- Note: exact exception type, file, line number, message
- Do NOT skim — the answer is usually in the error

### 1.2 Reproduce Consistently
- Reproduce the failure in isolation before changing any code
- If you cannot reproduce: the bug context is unknown — escalate
- Document: exact steps, inputs, environment

### 1.3 Gather Evidence
For each affected component:
```bash
# Recent changes (prime suspect)
git log --oneline -10
git diff HEAD~1

# Relevant logs
# Check structured logs, error output, and state dumps

# Test isolation
# Run the smallest test that exercises the failure
```

### 1.4 Trace Data Flow
- Follow the data from entry point to failure point
- Document the flow as you trace it
- Identify the exact point where state diverges from expectation

### 1.5 Isolate
- Can you reproduce in a minimal test case (5 lines)?
- Minimal reproduction = high confidence in root cause

---

## Phase 2 — Pattern Analysis

After gathering evidence, look for:

| Pattern | What It Suggests |
|---------|-----------------|
| Bug appeared after specific commit | Root cause is in that diff |
| Intermittent failure | Race condition, timing issue, or environmental dependency |
| Works locally, fails in CI | Environment difference (env vars, versions, filesystem) |
| All tests pass, behavior wrong | Tests don't cover the actual scenario |
| Multiple components affected | Likely a shared state or contract violation |
| Recent dependency upgrade | Dependency introduced breaking change |

---

## Phase 3 — Hypothesis & Testing

### 3.1 Form One Hypothesis
State it explicitly:
```
Hypothesis: The failure is caused by [specific cause] in [specific location]
because [evidence that supports this].
```

One hypothesis at a time. Testing multiple hypotheses simultaneously produces ambiguous results.

### 3.2 Minimal Test
Test the hypothesis with the smallest possible change:
- Add a targeted assertion (do not refactor while debugging)
- Use a temporary log if assertions aren't possible
- Document: hypothesis → test → result

### 3.3 Confirm Before Fixing
The hypothesis is confirmed when:
- The minimal test proves the cause (not just that the symptom disappears)
- You can explain WHY the bug occurred in one sentence

---

## Phase 4 — Implementation

### 4.1 Apply Minimal Fix
- Fix only what the confirmed root cause requires
- Do not refactor, clean up, or "improve" adjacent code during a bug fix
- A bug fix is not a refactor opportunity

### 4.2 Verify
```
- [ ] Original failure no longer reproduces
- [ ] Minimal test from Phase 3 now passes
- [ ] Full test suite passes
- [ ] No new failures introduced
```

### 4.3 Document
- Commit message should explain WHAT was fixed and WHY
- If the bug was non-obvious: add it to the second brain gotchas

---

## Attempt Limit Protocol

| Attempt # | Agent Action |
|-----------|-------------|
| 1 | Apply fix based on confirmed hypothesis |
| 2 | Re-examine — broaden evidence gathering scope |
| 3 | **STOP. Do not attempt Fix #4.** |

**On 3rd failure, escalate to:**
- CIPHER — if root cause is architectural or cross-cutting
- Human owner — if root cause requires trade-off or business decision

**Rationale:** Three failures indicate the agent's mental model of the system is incorrect. Additional fixes will likely be wrong too. Fresh architectural perspective is required.

---

## Common Rationalization Traps

| Rationalization | Why It's Wrong |
|----------------|---------------|
| "Let me just try this quick fix" | Without root cause, quick fixes create new bugs |
| "The tests pass, so it's fixed" | Tests may not cover the actual failure path |
| "It's probably environment-specific" | Environment bugs have root causes too |
| "This worked before, so it should work now" | Context changes — investigate why it stopped working |
| "Adding a try/catch will stabilize it" | Swallowing an exception hides root cause forever |

---

## Red Flags — Stop Immediately

- You're modifying tests to pass rather than fixing implementation
- You added a guard clause without understanding what it's guarding against
- The fix works but you can't explain why
- You're on your 3rd different approach
- You're changing multiple unrelated things hoping one helps
- You copied a fix from a similar-looking issue without validating it applies

---

---

## Prove-It Pattern (Bug Fix Protocol)

Antes de declarar um bug corrigido, o agente DEVE executar este ciclo:

```
1. Bug Report → escrever teste de repro que FALHA (confirma que o bug existe)
2. Implementar o fix
3. Teste de repro PASSA (confirma que o fix funciona)
4. Suite completa PASSA (confirma que não houve regressão)
```

**Racionalização a bloquear:** "Acho que corrigi" — não está corrigido até o teste de repro passar.

**Por que escrever o teste antes do fix:**
- Confirma que o bug é reproduzível (não foi environment-specific)
- Garante que o fix resolve exatamente o bug reportado (não um bug adjacente)
- Cria guard automático contra regressão futura
- Torna o root cause verificável por qualquer revisor

**Se não for possível escrever teste automatizado:** documentar o passo a passo manual de reprodução e o resultado esperado antes e depois — e incluir no PR description.

---

## Relationship to Other Skills

- `test-coverage` — ensure the bug is covered by a test after fixing
- `pr-review` — include root cause analysis in PR description
- `escalation-rules` §5 — attempt limit and escalation protocol
- `spec-driven` — if root cause reveals a spec gap, create a spec update
