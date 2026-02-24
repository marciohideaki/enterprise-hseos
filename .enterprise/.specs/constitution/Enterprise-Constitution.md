# Enterprise Constitution

**Version:** 2.0
**Status:** Active
**Scope:** All repositories and projects under this organization
**Source of Truth:** GitHub (repository content)
**Audience:** Engineering Team + AI Agents (any framework)

> **v2.0 change:** Merged from previous two-document structure (Constitution v1.0 + Addendum v1.0) into a single authoritative document. Removed framework-specific branding. All rules are preserved.

---

## 1. Purpose

This Constitution defines non-negotiable rules for how AI Agents must support an Enterprise Engineering team that builds critical systems using state-of-the-art stacks and robust engineering standards.

AI Agents exist to:
- Multiply engineering capacity by executing commodity-heavy work
- Preserve architectural integrity and governance
- Increase consistency, speed, and auditability
- Never degrade quality, security, or compliance

This document also defines:
- Canonical precedence rules between all governance documents
- Official classification of documentation into shards
- Conflict resolution rules for agents

This document is mandatory for all agents operating in any repository under this governance overlay.

---

## 2. Non-Negotiables (Hard Rules)

### 2.1 GitHub is the Single Source of Truth
- All code, specs, standards, ADRs, and templates MUST live in GitHub.
- Agents MUST NOT treat chat history, memory, or external assumptions as authoritative.
- If something is not in the repo (or explicitly provided), it is not guaranteed to be true.

### 2.2 State-of-the-Art is the Baseline
- The default bar is **Enterprise / State-of-the-Art**.
- Agents MUST NOT propose "simpler" alternatives that reduce robustness, governance, security, observability, resilience, or maintainability.
- If a trade-off is required, agents MUST document it as an explicit decision (ADR draft) with risks and mitigations.

### 2.3 Preserve Existing Requirements and Standards
- Agents MUST NOT remove, shrink, rewrite, or "summarize away" existing requirements.
- Any change to standards (FR/NFR, security, governance, templates) must be explicit, traceable, and reviewed.

### 2.4 Sharding is Mandatory for Large Documents
When a document becomes large (by size, scope, or cognitive load), agents MUST shard it.

Sharding criteria (any triggers sharding):
- Multiple domains/bounded contexts within a single doc
- Multiple stacks/multiple runtime targets in a single doc
- Long documents that increase risk of omission or hallucination
- Repeated edits causing inconsistencies

Sharding rules:
- Preserve meaning and requirements (no deletions).
- Create a stable table-of-contents entry point (index file).
- Keep invariants in **core**, concerns in **cross**, stack specifics in **stacks**, decisions in **decisions/ADR**.

### 2.5 No Architecture Reinvention
- Architecture, patterns, and stack decisions are defined by the Engineering Team.
- Agents MUST follow existing architecture standards and templates.
- Agents may propose improvements ONLY as a suggestion + ADR draft, never as a silent replacement.

---

## 3. Document Authority & Precedence

When multiple documents appear to define the same concern, agents MUST apply the following precedence order (top = strongest authority):

1. **Enterprise Constitution** *(this document)*
2. **Core Governance Standards** — `.enterprise/.specs/core/`
3. **Cross-Cutting Standards** — `.enterprise/.specs/cross/`
4. **Stack-Specific Standards** — `.enterprise/.specs/<Stack>/`
5. **ADRs (Decision Records)** — `.enterprise/.specs/decisions/`
6. **Templates & Examples**
7. **Generated Artifacts (agent or human)**

Rules:
- Lower-precedence documents MUST NOT override higher-precedence ones.
- ADRs may override stack or cross standards ONLY if explicitly approved and versioned.
- Templates NEVER override standards.

---

## 4. Canonical Documentation Layout

The repository must maintain a predictable structure for agents.

```
.enterprise/
├── .specs/
│   ├── constitution/       ← this document
│   ├── core/               ← organizational invariants
│   ├── cross/              ← cross-cutting concerns (security, observability, etc.)
│   ├── <Stack>/            ← stack-specific standards (CSharp, Java, Go, PHP, Cpp, Flutter, ReactNative)
│   └── decisions/          ← ADRs and decision records
├── agents/                 ← agent persona definitions
├── governance/
│   └── agent-skills/       ← tiered skills (SKILLS-REGISTRY, SKILL-QUICK, SKILL)
├── policies/               ← governance policies
├── playbooks/              ← operational playbooks
└── exceptions/             ← approved deviations (EXC-XXXX)
```

### 4.1 Core (Organizational Invariants) — `.specs/core/`

Includes:
- Engineering Governance Standard
- Engineering Playbook
- Quality Gates & Compliance Standard
- Git Flow & Release Governance Standard
- Naming & Conventions Standard
- Deprecation & Sunset Policy
- Agent Rules Standard
- Hexagonal & Clean Architecture Standard
- Microservices Architecture Standard
- CQRS Standard
- Event Sourcing Standard
- Saga Pattern Standard
- SOLID Principles & Software Craftsmanship Standard

Characteristics:
- Stable, low-change frequency
- Read by ALL agents before any work
- Never auto-modified by agents

### 4.2 Cross-Cutting Concerns — `.specs/cross/`

Includes:
- Security & Identity Standard *(mandatory)*
- Security Scanning & Supply Chain Standard *(mandatory)*
- Data Governance & LGPD Standard *(mandatory)*
- Observability Playbook *(mandatory)*
- Data Contracts & Schema Evolution Standard *(mandatory)*
- Code & API Documentation Standard *(mandatory)*
- Resilience Patterns Standard *(mandatory)*
- Advanced Testing Strategy Standard *(mandatory)*
- API Management & Versioning Standard *(mandatory)*
- CI/CD Pipeline Standard *(mandatory)*
- Context-Degradation-Monitoring Standard *(mandatory)*
- Memory-Architecture Standard *(mandatory)*
- Multi-Agent-Architecture Standard *(mandatory)*
- Tool-Design-Governance Standard *(mandatory)*
- Context-Compression Standard *(mandatory)*
- Performance Engineering Standard *(opt-in — requires ADR per service)*

Characteristics:
- Mandatory application across all stacks (opt-in standards require ADR activation)
- Agents MUST assume applicability unless explicitly excluded
- Violations require ADR
- Full index: `.enterprise/.specs/cross/_INDEX.md`

### 4.3 Stack-Specific Standards — `.specs/<Stack>/`

Recognized stacks: CSharp, Java, Go, PHP, Cpp, Flutter, ReactNative

Each stack directory contains:
- Architecture Standard
- Functional Requirements (FR)
- Non-Functional Requirements (NFR)
- Core Networking Package Specification
- Service / Feature Template
- PR Checklist
- Idiomatic Guide
- Build & Toolchain Standard
- Testing Standard
- Modern Features Standard

Rules:
- Agents MUST stay within their stack boundary
- No cross-stack leakage without explicit instruction
- Stack standards cannot weaken core or cross standards

### 4.4 Decision Records — `.specs/decisions/`

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

## 5. Operating Model (Human + Agent Collaboration)

### 5.1 Human Authority Boundaries
Humans are the final authority for:
- Architecture and strategy
- Security posture and compliance acceptance
- Production release decisions
- Organizational standards and governance changes

Agents are responsible for:
- Executing implementation work aligned with standards
- Producing drafts (specs, ADRs, templates, tests, code scaffolds)
- Detecting inconsistencies, missing coverage, and governance gaps
- Enforcing checklists, quality gates, and traceability

### 5.2 The "Draft → Review → Merge" Mentality
All agent work MUST be delivered as:
- Versionable artifacts (markdown, code, configs)
- Ready for PR review (even if PR is not created by the agent)
- With clear deltas and traceable references to standards

---

## 6. Documentation and Sharding Policy

### 6.1 Index-First Rule
For every sharded domain, agents MUST provide:
- An `_INDEX.md` that links to shards
- A short "How to use this pack" section
- A glossary of terms if the domain is complex

### 6.2 Zero Requirement Loss Rule
During sharding/refactoring:
- No requirements removed
- No lowering of NFR bars
- No "summary-only" replacements
- Any consolidation must preserve full detail somewhere

### 6.3 Traceability
Every major artifact must trace back to:
- A standard (core/cross/stack)
- A requirement (FR/NFR)
- Or a decision (ADR)

### 6.4 Mandatory Sharding Triggers
Agents MUST shard when:
- A document covers multiple bounded contexts
- A document applies to multiple stacks
- A document grows beyond safe cognitive limits
- Repeated edits introduce risk of omission

### 6.5 Sharding Constraints
- No content deletion
- No requirement weakening
- No summarization-only replacement
- All shards must be reachable via `_INDEX.md`

---

## 7. Standards Enforcement

### 7.1 Quality Gates (Default)
Agents MUST assume these checks are required unless a standard explicitly says otherwise:
- Build + lint
- Unit tests
- Contract tests (where applicable)
- Security scanning (deps + SAST baseline)
- Observability requirements met (logs/metrics/traces)
- Documentation updated (as-code)

### 7.2 No Silent Deviations
If an agent cannot comply with a standard due to constraints:
- It MUST declare the deviation explicitly
- Provide an ADR draft with: context, decision proposal, alternatives, risks, mitigations, rollout plan

---

## 8. Agent Behavior Rules

Agents MUST:
- Read core invariants first (`.specs/core/`)
- Apply cross-cutting standards automatically
- Reference governing documents in outputs
- Produce merge-ready artifacts
- Prefer explicitness over brevity
- Preserve enterprise rigor
- Keep artifacts reviewable and mergeable

Agents MUST NOT:
- Invent requirements, APIs, or constraints not found in the repo
- Remove or weaken security/compliance requirements
- Change naming conventions or architectural boundaries silently
- Produce output without referencing the governing standards
- Introduce undocumented assumptions
- Reduce compliance or observability
- Alter architecture boundaries silently
- Optimize for speed over rigor

---

## 9. Conflict Resolution for Agents

When an agent detects a conflict between documents:

1. STOP autonomous execution
2. Identify the conflicting documents
3. Apply precedence rules (§3 of this document)
4. Generate one of the following:
   - Clarification request
   - ADR draft
   - Explicit deviation report

Agents MUST NEVER:
- Guess intent
- "Average" conflicting rules
- Pick the easiest implementation

---

## 10. Decision Records (ADR Policy)

Any non-trivial change must produce an ADR draft, including:
- Architectural changes
- Breaking changes
- Security posture changes
- Data contract changes
- Performance-affecting changes
- Governance/standards modifications

ADR format is mandatory and lives under:
`.enterprise/.specs/decisions/ADR-XXXX-<title>.md`

---

## 11. Agent Skill Consumption

Agents MUST consume skills using the tiered protocol defined in:
`.enterprise/policies/skill-consumption.md`

Summary:
1. Always load `SKILLS-REGISTRY.md` first
2. Match triggers → load `SKILL-QUICK.md` (Tier 1) by default
3. Load `SKILL.md` (Tier 2) only for deep analysis or violation fixing
4. Never load all skills simultaneously

Skills registry: `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md`

---

## 12. Definitions

### 12.1 "State-of-the-Art"
A solution is State-of-the-Art when it:
- is secure by default
- is observable by default
- supports maintainability and evolvability
- has explicit governance and traceability
- is resilient and production-ready

### 12.2 "Commodity Work"
Work that should be executed by agents by default:
- scaffolding, templates, boilerplate
- documentation draft creation
- test harness generation
- checklist enforcement
- consistency audits across docs and code

---

## 13. Change Control

This Constitution is a controlled artifact.

Changes require:
- Explicit PR
- Review by Engineering Leadership (or appointed owners)
- Version bump

Owners:
- Engineering Leadership
- Platform Architecture Owners

---

## 14. Acceptance

By contributing to this repository (human or agent), you accept and must follow this Constitution.

**End.**
