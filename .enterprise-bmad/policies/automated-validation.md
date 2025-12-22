# Enterprise Automated Validation Rules
**Status:** Mandatory  
**Scope:** All BMAD Agent outputs  
**Version:** 1.0  

---

## 1. Purpose
Automated Validation ensures **agent outputs are structurally compliant**, even before human review.

Validation failures invalidate the output.

---

## 2. Mandatory Validation Rules

### 2.1 Governance References
All outputs MUST reference:
- Constitution
- Applicable policies
- Governing specs or ADRs

Missing references = invalid output.

---

### 2.2 Artifact Type Validation
Each output MUST clearly declare:
- Artifact type (PRD, Architecture, Code, ADR, Doc)
- Scope
- Governing documents

Implicit artifacts are forbidden.

---

### 2.3 Sharding Validation
If output:
- touches multiple domains
- affects multiple stacks
- exceeds safe limits

Then:
- Sharding MUST be present
- index.md MUST exist

Otherwise: invalid.

---

### 2.4 ADR Validation
If ADR is required:
- ADR file MUST exist
- ADR structure MUST be complete
- ADR status MUST be explicit

Missing or incomplete ADR = invalid.

---

## 3. Failure Handling
If validation fails:
- Output MUST be rejected
- Execution MUST stop
- Escalation is mandatory

---

## 4. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
