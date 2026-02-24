# Sentry Security Review — Reference

**Source:** Sentry Engineering Team
**Repository:** https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/security-review
**Status:** Reference — enrichment of `secure-coding` Tier 2 planned
**License:** MIT

---

## Core Methodology

### Confidence-Based Filtering

The central insight of the Sentry approach: **only report HIGH CONFIDENCE findings**.

A finding is HIGH confidence when BOTH conditions are met:
1. A clear vulnerable code pattern exists
2. Attacker-controlled input is confirmed to reach that pattern

Medium and low confidence items are noted separately or omitted entirely. This prevents false-positive noise that erodes trust in security reviews.

### Research vs. Report Distinction

- **What to research**: Entire codebase — data flow, validation layers, framework protections, auth paths
- **What to report**: Only the specific code locations confirmed vulnerable

Investigating `auth/middleware.py` to understand JWT validation scope does NOT mean flagging `auth/middleware.py` as a finding unless a concrete vulnerability exists there.

---

## 6-Step Review Process

1. **Detect context** — Identify code type: API endpoint, frontend, file handling, event consumer, background job
2. **Load language guide** — Python, JavaScript, Go, Rust, or Java-specific vulnerability patterns
3. **Load infrastructure guide** — Docker, Kubernetes, Terraform, CI/CD (if applicable)
4. **Research codebase** — Trace data flow from entry points through validation to storage/output
5. **Verify exploitability** — Confirm attacker control; check for framework mitigations (ORM, template auto-escaping, etc.)
6. **Report high confidence only** — Skip theoretical or partially-mitigated issues

---

## Categories NOT Flagged (False Positive Prevention)

- Test files and commented-out code
- Patterns using constants or server-controlled configuration (not user input)
- Code paths requiring prior authentication when auth is assumed sound
- Django template variables with default auto-escaping
- ORM queries using proper parameterized queries
- Environment variables and deployment configuration settings

---

## Severity Classification

| Level | Examples |
|---|---|
| **Critical** | Pre-auth RCE, SQL injection, auth bypass, hardcoded secrets in code |
| **High** | Stored XSS, SSRF to internal systems, IDOR |
| **Medium** | Reflected XSS (user-triggered), CSRF, path traversal |
| **Low** | Missing security headers, verbose error messages, defense-in-depth gaps |

---

## Reference Library Structure

The Sentry skill includes supporting reference files organized as:

```
security-review/
├── SKILL.md
├── infrastructure/
│   ├── docker.md
│   ├── kubernetes.md
│   ├── terraform.md
│   └── ci-cd.md
├── languages/
│   ├── python.md
│   ├── javascript.md
│   ├── go.md
│   ├── rust.md
│   └── java.md
└── references/
    └── [16 vulnerability pattern guides]
```

---

## Integration Note

The confidence-based filtering model is the primary contribution to adopt. Our `secure-coding` skill currently lacks this distinction — it may flag theoretical issues. Enriching Tier 2 with this methodology would reduce false positive noise in security reviews.

**End**
