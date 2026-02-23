---
name: secure-coding
description: Secure coding guardrails for changes impacting auth, crypto, secrets, and PII.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Secure Coding

## When to use
Use this skill whenever a diff or PR touches:
- authentication or authorization logic
- token handling (access tokens, refresh tokens, API keys)
- cryptographic operations (hashing, encryption, signing)
- secrets, passwords, or credentials
- PII (names, emails, documents, health data, financial data)
- new API endpoints
- input validation or deserialization logic
- new third-party dependencies
- rate limiting or brute-force protection

---

## 1. Secrets & Credentials

- SC-01: Secrets, API keys, passwords, and tokens MUST NEVER be hardcoded in source code or config files.
- SC-02: Secrets MUST be stored in a secret manager (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, etc.) and injected at runtime.
- SC-03: Secrets MUST NEVER be committed to git — not even in test files, comments, or example configs.
- SC-04: Local development secrets MUST use `.env` files or local secret stores; these files MUST be gitignored.
- SC-05: Secrets MUST be rotated on a regular schedule and immediately upon suspected compromise.
- SC-06: Audit logs MUST record secret access events.

---

## 2. Authentication

- SC-07: Use a centralized Identity Provider (IdP) — no custom auth implementations.
- SC-08: Use OAuth2 / OIDC for all authentication flows.
- SC-09: Access tokens MUST be short-lived (15–60 minutes recommended).
- SC-10: Refresh tokens MUST be rotated on use and revocable.
- SC-11: Sessions MUST expire and require re-authentication after inactivity.
- SC-12: Authentication endpoints MUST have stricter rate limiting than regular endpoints.
- SC-13: Multi-factor authentication (MFA) MUST be enforced for privileged access.

---

## 3. Authorization

- SC-14: Authorization MUST be policy-based (RBAC, claims, or attribute-based) — no ad-hoc if/else permission checks.
- SC-15: Authorization MUST be enforced server-side on every request — never rely on client-side checks.
- SC-16: New endpoints MUST NOT use `AllowAnonymous` by default — authorization is the default posture.
- SC-17: The only allowed anonymous endpoints are: `/health`, `/ready`, `/metrics`, and explicit token-based flows (documented).
- SC-18: Resource-level authorization MUST check that the caller owns or has rights to the specific resource.
- SC-19: Multi-tenant systems MUST validate tenant context on every request and MUST NOT allow cross-tenant data access.

---

## 4. Service-to-Service Security

- SC-20: Service-to-service calls MUST be authenticated (mTLS or signed tokens).
- SC-21: Internal services are NOT implicitly trusted — every call is authenticated.
- SC-22: Service credentials MUST be rotated and follow the same secrets management rules as user credentials.

---

## 5. Cryptography

- SC-23: NEVER implement custom cryptographic algorithms or protocols.
- SC-24: Use only approved, modern algorithms:
  - Hashing: SHA-256 or stronger (SHA-3 family, BLAKE2/3)
  - Symmetric encryption: AES-256-GCM or ChaCha20-Poly1305
  - Asymmetric encryption/signing: RSA-2048+ or ECDSA P-256+
  - Password hashing: bcrypt (cost ≥ 12), Argon2id, or scrypt
- SC-25: Forbidden algorithms: MD5, SHA-1, DES, 3DES, RC4, ECB mode (any cipher), hardcoded IVs/nonces.
- SC-26: Cryptographic keys MUST be generated using cryptographically secure random number generators.
- SC-27: TLS MUST be used for all data in transit; minimum TLS 1.2, prefer TLS 1.3.
- SC-28: Sensitive data at rest MUST be encrypted using approved algorithms.

---

## 6. Input Validation & Injection Prevention

- SC-29: ALL external inputs MUST be validated at API boundaries before processing.
- SC-30: Use allowlists (permitted values/formats) — not just denylists.
- SC-31: Parameterized queries or ORMs MUST be used for all database operations — no string concatenation for SQL.
- SC-32: Command injection MUST be prevented: never pass unsanitized user input to shell commands.
- SC-33: Deserialization of untrusted data MUST be safe — use type-constrained deserializers; avoid polymorphic deserialization of untrusted types.
- SC-34: File uploads MUST be validated for type, size, and content — never execute uploaded files.
- SC-35: XML inputs MUST disable external entity processing (XXE prevention).

---

## 7. PII & Data Protection

- SC-36: PII MUST NEVER appear in logs, metrics, traces, or error messages.
- SC-37: Tokens, secrets, and credentials MUST NEVER appear in logs.
- SC-38: PII fields in transit MUST use field-level encryption where risk classification requires it.
- SC-39: PII at rest MUST be encrypted or tokenized per data classification policy.
- SC-40: Data retention policies MUST be applied — PII MUST be purged when retention period expires.
- SC-41: GDPR / LGPD / applicable regulation requirements MUST be considered for any PII-processing feature.

---

## 8. Rate Limiting & Abuse Protection

- SC-42: Public API endpoints MUST have rate limiting.
- SC-43: Authentication endpoints MUST have stricter rate limits (brute-force protection).
- SC-44: Rate limit responses MUST use HTTP 429 with `Retry-After` header.
- SC-45: Account lockout or CAPTCHA challenge MUST be implemented after repeated authentication failures.

---

## 9. Dependency Security

- SC-46: New dependencies MUST be reviewed for known CVEs before adding.
- SC-47: Dependency versions MUST be pinned (exact version or lockfile committed).
- SC-48: Critical or high CVEs in dependencies MUST block builds.
- SC-49: SBOM (Software Bill of Materials) generation is recommended for services.
- SC-50: Dependencies MUST be scanned in CI on every build.

---

## 10. Security Headers (HTTP APIs)

- SC-51: APIs MUST return appropriate security headers:
  - `Strict-Transport-Security` (HSTS)
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY` (where applicable)
  - `Content-Security-Policy` (where applicable)
- SC-52: Sensitive API responses MUST include `Cache-Control: no-store`.

---

## Examples

✅ Good: Token stored in HashiCorp Vault, injected via env at runtime; never in source.
✅ Good: Authorization attribute on every controller; Anonymous only on `/health`.
✅ Good: Password hashed with Argon2id before storage.
✅ Good: Parameterized query: `SELECT * FROM users WHERE id = @userId`.

❌ Bad: `var apiKey = "sk-abc123..."` in source file.
❌ Bad: `[AllowAnonymous]` added to an endpoint without documented justification.
❌ Bad: MD5 used for password hashing.
❌ Bad: `$"SELECT * FROM users WHERE name = '{userName}'"` — SQL injection vector.
❌ Bad: `Console.log("User login:", user.email, user.password)` — PII + secret in log.
