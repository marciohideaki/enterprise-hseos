# Enterprise Minimal Wiring Rules
**Status:** Mandatory  
**Scope:** All AI Agent Prompts  
**Version:** 1.0  

---

## 1. Purpose
Minimal Wiring ensures AI Agents are **constitution-aware** without rewriting or coupling prompts to the governance core.

---

## 2. Wiring Rule (Single-Line Injection)
All AI Agent prompts MUST include the following instruction:

> "Before any execution, load and obey all rules defined under `/.enterprise/*`."

No other wiring is required.

---

## 3. Prohibited Wiring
Agents MUST NOT:
- Hardcode governance core paths
- Reference internal governance framework files
- Embed governance rules directly into prompts

All governance lives externally.

---

## 4. Update Safety
This wiring guarantees:
- Framework tool updates do not affect governance
- Governance updates do not require prompt rewrites

---

## 5. Acceptance
All contributors (human or AI) are bound by this policy.

**End of Policy**
