# Security & Identity Standard
## Authentication, Authorization, Secrets and Access Control (Multi-Stack)

**Version:** 1.0  
**Scope:** Generic / Domain-agnostic  
**Stacks:** Backend (C#/.NET), Clients (Flutter/Dart, React/TypeScript)

> This standard defines mandatory security and identity rules across services and clients.
> It complements NFRs by providing **normative implementation expectations**.

---

## 1. Core Principles

- SI-01: Adopt **Zero Trust** principles.
- SI-02: Enforce **least privilege** everywhere.
- SI-03: Security controls must be **centralized, auditable and consistent**.
- SI-04: Never trust client inputs.
- SI-05: Security exceptions require ADR approval.

---

## 2. Authentication

### 2.1 Standard

- SI-06: Use a centralized Identity Provider (IdP).
- SI-07: Use industry-standard protocols (OAuth2/OIDC).
- SI-08: Access tokens must be short-lived.
- SI-09: Refresh tokens must be rotated and revocable.

### 2.2 Client Authentication (Flutter / React)

- SI-10: Tokens must be stored using platform-appropriate secure storage.
- SI-11: Do not log tokens, refresh tokens or authorization codes.
- SI-12: Implement safe re-authentication and session expiry UX.

---

## 3. Authorization

### 3.1 Policy-Based Authorization

- SI-13: Authorization must be policy-based (RBAC/claims/policies).
- SI-14: Resource authorization must be enforced server-side.
- SI-15: Do not rely on client-side checks for security.

### 3.2 Multi-Tenancy (If Applicable)

- SI-16: Tenant context must be validated on every request.
- SI-17: Cross-tenant access must be explicitly forbidden by default.

---

## 4. Service-to-Service Security

- SI-18: Service-to-service calls must be authenticated (mTLS or signed tokens).
- SI-19: Secrets must never be hard-coded.
- SI-20: Internal APIs are not implicitly trusted.

---

## 5. Secrets Management

- SI-21: Secrets must be stored in a secret manager (vault) and injected at runtime.
- SI-22: Secrets must be rotated regularly.
- SI-23: Secrets must never be committed to git.
- SI-24: Local development secrets must use `.env` or secure local stores and remain untracked.

---

## 6. Data Protection

- SI-25: Encrypt all traffic in transit (TLS).
- SI-26: Encrypt sensitive data at rest.
- SI-27: Apply field-level protection where required.
- SI-28: Never log PII.

---

## 7. Auditability

- SI-29: Security-relevant operations must emit audit events.
- SI-30: Audit logs must include:
  - actor (user/service)
  - action
  - target resource
  - timestamp
  - correlationId
- SI-31: Audit logs must be immutable.

---

## 8. API Exposure Rules

- SI-32: `AllowAnonymous` is forbidden by default.
- SI-33: The only allowed anonymous endpoints are:
  - `/health`
  - `/ready`
  - `/metrics` (if required)
  - token-based invitation flows (explicitly documented)

---

## 9. Input Validation & Security Boundaries

- SI-34: Validate all external inputs at API boundaries.
- SI-35: Use allowlists for formats and values where possible.
- SI-36: Protect against injection vulnerabilities (SQL/NoSQL/Command injection).

---

## 10. Rate Limiting & Abuse Protection

- SI-37: Rate limiting must exist for public endpoints.
- SI-38: Authentication endpoints must have stricter limits.
- SI-39: Brute-force protection is mandatory.

---

## 11. Logging & Observability Rules

- SI-40: Never log secrets or PII.
- SI-41: Security events must be traceable via correlation IDs.
- SI-42: Security alerts must be actionable and monitored.

---

## 12. Dependency & Supply Chain Security

- SI-43: Dependencies must be pinned and scanned.
- SI-44: Critical vulnerabilities must block builds.
- SI-45: SBOM generation is recommended.

---

## 13. Incident Response Expectations

- SI-46: Runbooks must exist for auth outages, token compromise, and secret leaks.
- SI-47: Breach response must include token revocation and secret rotation.

---

## Summary

This standard makes identity and security enforceable across **C# backends** and **Flutter/React clients** by prescribing consistent authentication, authorization, secrets handling, auditability and safe API exposure rules.
