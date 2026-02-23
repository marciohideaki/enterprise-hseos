# Enterprise Documentation Policy
**Status:** Mandatory  
**Scope:** All documentation produced or modified by humans or Enterprise agents  
**Version:** 1.0  

---

## 1. Purpose
This policy defines **how documentation is written, structured, versioned, and governed** in an Enterprise environment.

Documentation is not a byproduct — it is a **first-class engineering artifact** and a **source of truth**.

---

## 2. Core Principles
All documentation MUST be:

- **Explicit** — no implied meaning
- **Complete** — no missing assumptions
- **Traceable** — linked to requirements, code, or decisions
- **Versionable** — suitable for Git history and PR review
- **Durable** — usable months or years later
- **Enterprise-grade** — production, compliance, and audit ready

Brevity is acceptable. Ambiguity is not.

---

## 3. Documentation as Code
Documentation MUST follow the same discipline as code:

- Stored in GitHub
- Reviewed via pull requests
- Changes are diffable
- Ownership is clear
- History is preserved

If it cannot be reviewed like code, it does not belong in the system.

---

## 4. Canonical Documentation Structure
Documentation MUST reside in predictable locations:

- `.specs/core/` → Organizational invariants
- `.specs/cross/` → Cross-cutting concerns
- `.specs/stacks/<stack>/` → Stack-specific specs
- `.specs/decisions/` → ADRs
- `/.enterprise/` → Enterprise governance, policies, agent rules

Agents MUST NOT create ad-hoc documentation paths.

---

## 5. Writing Standards
All documentation MUST:

- Use clear, unambiguous language
- Define terms on first use
- Avoid overloaded terminology
- Separate concerns cleanly
- Prefer structured sections over prose blocks
- Use lists, tables, and headings to reduce ambiguity

---

## 6. No “Shallow Documentation”
The following are forbidden:

- High-level statements without detail
- “TBD” left unresolved
- Hand-wavy explanations
- Diagrams without textual explanation
- Documentation that cannot be acted upon

If detail is required for correct execution, it MUST exist.

---

## 7. Sharding Enforcement
Large or complex documentation MUST follow the **Enterprise Sharding Policy**.

Agents MUST:
- Refuse to modify oversized unsharded documents
- Propose sharding before extension
- Maintain an index.md for navigation

---

## 8. Documentation ↔ Code ↔ Decision Traceability
Documentation MUST explicitly reference:

- Requirements (FR/NFR)
- Architecture sections
- Code modules or services
- ADRs where decisions exist

Every non-trivial implementation MUST be traceable back to documentation and decisions.

---

## 9. Change Management
Any change to documentation MUST:

- Preserve existing meaning
- Explicitly state what changed
- Avoid silent rewrites
- Trigger ADRs when:
  - Semantics change
  - Requirements are altered
  - Constraints are weakened or strengthened

---

## 10. Agent Enforcement Rules
AI Agents MUST:

- Treat documentation as authoritative
- Refuse to invent undocumented behavior
- Update documentation alongside code
- Escalate conflicts instead of resolving silently

AI Agents MUST NOT:
- Summarize away detail
- Replace documentation with chat output
- Modify standards without approval

---

## 11. Review & Quality Bar
Documentation is considered acceptable ONLY if:

- A reviewer can execute or validate work based on it
- Assumptions are explicit
- Scope and limits are clear
- It aligns with Enterprise governance

If documentation cannot support execution, it is incomplete.

---

## 12. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
