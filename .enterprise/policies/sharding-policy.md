# Enterprise Sharding Policy
**Status:** Mandatory  
**Scope:** All documentation, specs, and artifacts produced by humans or Enterprise agents  
**Version:** 1.0  

---

## 1. Purpose
This policy defines **mandatory sharding rules** to prevent:
- Context loss
- Requirement omission
- Cognitive overload
- Silent regressions in large or evolving documents

Sharding is a **governance mechanism**, not an optimization.

---

## 2. When Sharding Is Mandatory
Sharding MUST be applied when **any** of the following conditions are met:

- A document covers multiple domains or bounded contexts
- A document applies to more than one stack or runtime
- A document grows beyond safe cognitive limits
- Iterative edits increase risk of omission or contradiction
- Multiple agents collaborate on the same artifact
- Requirements, rules, or constraints repeat across sections

If in doubt: **SHARD**.

---

## 3. Sharding Model (Canonical)
All sharded documentation MUST follow this model:

### 3.1 Core Invariants
.specs/core/

Contains:
- Organizational principles
- Governance standards
- Quality gates
- Naming conventions

Characteristics:
- Stable
- Low-frequency change
- Read-only for agents

---

### 3.2 Cross-Cutting Concerns
.specs/cross/
Contains:
- Security
- Observability
- Data contracts
- Compliance

Characteristics:
- Mandatory for all stacks
- Cannot be bypassed

---

### 3.3 Stack-Specific Specifications
.specs/stacks/<stack>/
Contains:
- Architecture
- FR / NFR
- Networking
- Templates

Characteristics:
- Isolated per stack
- Cannot weaken core or cross rules

---

### 3.4 Decision Records
.specs/decisions/
Contains:
- ADRs
- Explicit trade-offs
- Exceptions

Characteristics:
- Append-only
- Never silent

---

## 4. Index-First Rule
Every sharded domain MUST include an `index.md` that:

- Explains the purpose of the shard
- Lists all child documents
- Explains how to navigate the content
- Defines ownership if applicable

No orphan shards are allowed.

---

## 5. Zero Requirement Loss Rule
During sharding:

- NO requirement may be removed
- NO constraint may be weakened
- NO content may exist only as a summary

If consolidation occurs:
- Full detail MUST exist in at least one shard
- Summaries may exist only as navigational aids

---

## 6. Agent Enforcement Rules
AI Agents MUST:

- Refuse to operate on oversized unsharded documents
- Propose sharding before modification
- Preserve original meaning verbatim
- Reference governing shards explicitly

Agents MUST NOT:
- Auto-summarize large documents
- Merge shards silently
- Invent structure without explanation

---

## 7. Escalation
If sharding blocks progress:

1. Stop execution
2. Explain why sharding is required
3. Propose shard structure
4. Await approval if needed

---

## 8. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
