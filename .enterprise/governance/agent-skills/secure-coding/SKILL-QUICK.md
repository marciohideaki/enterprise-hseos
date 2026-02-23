---
name: secure-coding
tier: quick
version: "1.0"
---

# Secure Coding — Quick Check

> Tier 1: use when changes touch auth, tokens, secrets, PII, new endpoints, crypto, or new dependencies.
> Load SKILL.md (Tier 2) for detailed guardrails and remediation guidance.

---

## Checklist (ALL must pass)

**Secrets & Credentials**
- [ ] No secrets, tokens, passwords, or API keys hardcoded in source code or config files
- [ ] No secrets committed to git — use secret manager / env injection
- [ ] `.env` files and local credential stores are gitignored

**Authentication & Authorization**
- [ ] New endpoints are NOT `AllowAnonymous` by default
- [ ] Authorization is enforced server-side (not client-side only)
- [ ] Service-to-service calls are authenticated (mTLS or signed tokens)

**Input Validation**
- [ ] All external inputs validated at API boundary
- [ ] No SQL / NoSQL / command injection vectors introduced
- [ ] Allowlist approach used for formats and values where feasible

**Cryptography**
- [ ] No custom cryptographic implementations
- [ ] No deprecated algorithms used: MD5, SHA1, DES, RC4, ECB mode
- [ ] Sensitive data in transit uses TLS; at rest uses approved encryption

**PII & Logging**
- [ ] No PII logged in new log statements (names, emails, documents, tokens)
- [ ] No secrets or tokens appear in logs, metrics, or traces

**Dependencies**
- [ ] New third-party dependencies reviewed for known vulnerabilities
- [ ] Dependency versions pinned

---

## Verdict

**PASS** → all items clear.
**FAIL** → blocking violation — load `SKILL.md` (Tier 2) for full secure coding policy and remediation guidance.
