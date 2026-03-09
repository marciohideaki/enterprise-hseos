---
name: security-audit-plain-language
tier: quick
version: "1.0"
---

# Security Audit (Plain Language) — Quick Check

> Tier 1 for non-technical security reviews.
> Use before deep secure-coding analysis.

## Mandatory Setup

- [ ] Confirm read-only mode for audit phase
- [ ] Ask intake questions (data, access, exposure, secret storage, runtime)
- [ ] List assumptions explicitly when context is missing

## Audit Checklist

- [ ] Exposed secrets reviewed
- [ ] Data leakage risks reviewed
- [ ] Input attack surface reviewed
- [ ] Auth/authz weaknesses reviewed
- [ ] Dependency risks reviewed
- [ ] Configuration exposure reviewed

## Output Checklist

- [ ] Executive summary (2-3 sentences, plain language)
- [ ] Findings with impact and evidence location
- [ ] Severity per finding (Low/Medium/High)
- [ ] Step-by-step remediation guidance

## Hard Rules

- No modifications during audit.
- No technical jargon without short definition.
- No severity inflation without evidence.
