# Enterprise Exceptions Policy
**Status:** Controlled  
**Scope:** Explicitly approved deviations only  
**Version:** 1.0  

---

## 1. Purpose
Exceptions exist to allow **conscious, temporary, and auditable deviations** from standards.

No undocumented exception is valid.

---

## 2. What Qualifies as an Exception
An exception is:
- A deviation from a standard, policy, or constraint
- Explicitly approved
- Time-bound or scope-bound

---

## 3. Mandatory Exception Structure
All exceptions MUST be documented and include:

- Context
- Affected standards
- Reason for exception
- Risk assessment
- Mitigations
- Expiration condition or review date

---

## 4. Canonical Location
All exceptions MUST live under:

/.enterprise/exceptions/

Naming:
EXC-XXXX-<short-title>.md

---

## 5. Agent Rules
AI Agents MUST:

- Refuse execution if an exception is required but missing
- Treat expired exceptions as invalid
- Never self-approve exceptions

AI Agents MUST NOT:
- Encode exceptions in code
- Treat exceptions as implied
- Extend exceptions silently

---

## 6. Expiration & Review
All exceptions MUST:
- Have a review date
- Be explicitly renewed or closed

Expired exceptions are invalid.

---

## 7. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
