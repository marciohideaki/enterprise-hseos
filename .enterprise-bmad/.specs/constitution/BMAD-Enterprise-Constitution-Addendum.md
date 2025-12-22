# BMAD Enterprise Constitution — Addendum
**Version:** 1.0  
**Status:** Active  
**Scope:** Documentation precedence, sharding authority, and agent resolution rules  
**Parent Document:** BMAD Enterprise Constitution (BEC)

---

## 1. Purpose
This Addendum defines:
- Canonical precedence rules between documents
- Official classification of existing documentation into BMAD shards
- Conflict resolution rules for BMAD Agents

This document is mandatory for all agents operating in this repository.

---

## 2. Document Precedence Rules (Hard Authority Order)

When multiple documents appear to define the same concern, agents MUST apply the following precedence order (top = strongest authority):

1. **BMAD Enterprise Constitution**
2. **BMAD Enterprise Constitution – Addendum**
3. **Core Governance Standards**
4. **Cross-Cutting Standards**
5. **Stack-Specific Standards**
6. **ADRs (Decision Records)**
7. **Templates & Examples**
8. **Generated Artifacts (agent or human)**

Rules:
- Lower-precedence documents MUST NOT override higher-precedence ones.
- ADRs may override stack or cross standards ONLY if explicitly approved and versioned.
- Templates NEVER override standards.

---

## 3. Canonical Sharding Model

All documentation MUST be classified into one (and only one) of the following shards.

### 3.1 Core (Organizational Invariants)
Path:
.specs/core/

Includes (authoritative examples):
- Engineering Governance Standard
- Engineering Playbook
- Quality Gates & Compliance Standard
- Git Flow & Release Governance Standard
- Naming & Conventions Standard
- Deprecation & Sunset Policy
- Agent Rules Standard

Characteristics:
- Stable, low-change frequency
- Read by ALL agents before any work
- Never auto-modified by agents

---

### 3.2 Cross-Cutting Concerns
Path:
.specs/cross/

Includes:
- Security & Identity Standard
- Observability Playbook
- Data Contracts & Schema Evolution Standard
- Code & API Documentation Standard

Characteristics:
- Mandatory application across all stacks
- Agents MUST assume applicability unless explicitly excluded
- Violations require ADR

---

### 3.3 Stack-Specific Standards
Path:
.specs/stacks/<stack>/

Includes (per stack):
- Architecture Standard
- Functional Requirements (FR)
- Non-Functional Requirements (NFR)
- Core Networking Specification
- Feature / Module / Service Templates
- PR Checklists

Stacks currently recognized:
- dotnet
- flutter
- react-native

Rules:
- Agents MUST stay within their stack boundary
- No cross-stack leakage without explicit instruction
- Stack standards cannot weaken core or cross standards

---

### 3.4 Decision Records (ADR)
Path:
.specs/decisions/

Includes:
- Architectural decisions
- Security posture changes
- Performance-impacting changes
- Breaking changes
- Governance exceptions

Rules:
- ADRs are append-only
- ADRs MUST NOT silently rewrite standards
- ADRs require explicit linkage to affected standards

---

## 4. Conflict Resolution Rules for Agents

When an agent detects conflict:

1. STOP autonomous execution
2. Identify conflicting documents
3. Apply precedence rules
4. Generate one of the following:
   - Clarification request
   - ADR draft
   - Explicit deviation report

Agents MUST NEVER:
- Guess intent
- “Average” conflicting rules
- Pick the easiest implementation

---

## 5. Sharding Enforcement Rules

### 5.1 Mandatory Sharding Triggers
Agents MUST shard when:
- A document covers multiple bounded contexts
- A document applies to multiple stacks
- A document grows beyond safe cognitive limits
- Repeated edits introduce risk of omission

### 5.2 Sharding Constraints
- No content deletion
- No requirement weakening
- No summarization-only replacement
- All shards must be reachable via index.md

---

## 6. Agent Operating Safety Guarantees

Agents MUST:
- Read core invariants first
- Apply cross-cutting standards automatically
- Reference governing documents in outputs
- Produce merge-ready artifacts

Agents MUST NOT:
- Introduce undocumented assumptions
- Reduce compliance or observability
- Alter architecture boundaries silently
- Optimize for speed over rigor

---

## 7. Ownership and Change Control

This Addendum is owned by:
- Engineering Leadership
- Platform Architecture Owners

Changes require:
- Explicit PR
- Review approval
- Version bump

---

## 8. Acceptance
All contributors (human or AI) are bound by this Addendum.

**End of Addendum**
