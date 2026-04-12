---
name: threat-modeling
tier: quick
version: "1.0"
description: "Use when assessing security threats, trust boundaries, or abuse paths in a new or changed system"
---

# Threat Modeling — Quick Reference

> Tier 1: Load when user explicitly requests a threat model or AppSec analysis.
> Load SKILL.md (Tier 2) for full 8-step methodology, risk tables, and output template.

> ⚠️ EXPLICIT REQUEST ONLY — never auto-load for general security or architecture reviews.

---

## Activation Gate

Only proceed if the user explicitly requested ONE of:
- Threat model / threat modeling
- AppSec / application security analysis
- Abuse path enumeration
- Attack surface assessment

**Do NOT activate for:** general code review, architecture discussion, PR review, or security best practices questions.

---

## 8-Step Workflow (Summary)

| Step | Action |
|---|---|
| 1. **Scope** | Map components, data stores, integrations from repo evidence only |
| 2. **Boundaries & Assets** | Trust boundaries (auth, encryption, protocols) + risk assets (creds, PII, compute, audit logs) |
| 3. **Calibrate** | Realistic attacker capabilities tied to exposure; note non-capabilities explicitly |
| 4. **Enumerate Threats** | Abuse paths → attacker goals → impacted assets |
| 5. **Prioritize** | Qualitative likelihood × impact with explicit one-line justification per finding |
| 6. **Validate with User** | **MANDATORY STOP** — summarize key assumptions, ask 1–3 targeted questions, wait |
| 7. **Mitigations** | Tied to specific components; distinguish existing vs. recommended controls |
| 8. **Quality Check** | All entry points covered? Runtime/CI separated? Output: `<repo-name>-threat-model.md` |

---

## Risk Classification

| Level | Examples |
|---|---|
| **Critical** | Pre-auth RCE, auth bypass, cross-tenant access, credential theft, sandbox escape |
| **High** | Targeted DoS on critical path, partial sensitive data exposure, rate-limit bypass |
| **Medium** | Unvalidated input in non-critical flows, weak session management, CSRF |
| **Low** | Low-sensitivity info leaks, noisy DoS, threats requiring unlikely preconditions |

---

## Hard Rules

- [ ] Ground ALL claims in repository evidence — no speculation
- [ ] Separate runtime scope from CI/build/dev tooling
- [ ] Step 6 (Validate) is MANDATORY — never skip the pause
- [ ] Output is a `.md` file committed to repo, not a chat response
- [ ] Do not reuse this as a general security checklist — it is a structured workflow
