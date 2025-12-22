# Enterprise Minimal Wiring Rules
**Status:** Mandatory  
**Scope:** All BMAD Agent Prompts  
**Version:** 1.0  

---

## 1. Purpose
Minimal Wiring ensures BMAD Agents are **constitution-aware** without rewriting or coupling prompts to the BMAD core.

---

## 2. Wiring Rule (Single-Line Injection)
All BMAD Agent prompts MUST include the following instruction:

> "Before any execution, load and obey all rules defined under `/enterprise-bmad/*`."

No other wiring is required.

---

## 3. Prohibited Wiring
Agents MUST NOT:
- Hardcode BMAD core paths
- Reference internal BMAD framework files
- Embed governance rules directly into prompts

All governance lives externally.

---

## 4. Update Safety
This wiring guarantees:
- BMAD framework updates do not affect governance
- Governance updates do not require prompt rewrites

---

## 5. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
