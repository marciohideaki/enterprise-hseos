---
inclusion: auto
description: Security checklist — always active, evaluated before every commit and code change
---

# Security — Pre-Commit Checklist

> Active in every session. Evaluate before declaring any code change complete.

## Mandatory Security Gates

- [ ] No hardcoded secrets, tokens, API keys, or passwords
- [ ] All user inputs validated at system boundaries (APIs, event consumers, CLI args)
- [ ] SQL queries use parameterized statements (no string concatenation)
- [ ] HTML output is sanitized or escaped (XSS prevention)
- [ ] Auth and authorization verified on all protected routes
- [ ] No sensitive data in error messages or logs
- [ ] Rate limiting in place for public endpoints
- [ ] No PII in logs, events, or analytics payloads

## Secret Scan (run before commit)
```bash
grep -rE "(password|secret|api_key|token|private_key)\s*[:=]\s*['\"][^'\"]{8,}" \
  --include="*.{ts,js,go,java,py,dart,kt,cs,php,rb}" .
```

## On Security Violation Found
1. **STOP** — do not proceed
2. Load `secure-coding` skill (`.enterprise/governance/agent-skills/secure-coding/SKILL-QUICK.md`)
3. Fix CRITICAL issues before any commit
4. If credentials were exposed: escalate immediately — assume rotation required

## Severity Reference
- **CRITICAL** — hardcoded creds, auth bypass, SQL injection, RCE → Block merge
- **HIGH** — XSS, CSRF, missing auth → Warn before merge
- **MEDIUM/LOW** — missing rate limit, verbose errors → Fix when possible
