# Sentry Security Review — Reference

**Source:** Sentry Engineering Team
**Repository:** https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/security-review
**License:** CC BY-SA 4.0 (based on OWASP Cheat Sheet Series)

---

## Core Methodology

### Confidence-Based Filtering

The central insight: **only report HIGH CONFIDENCE findings**.

A finding is HIGH confidence when BOTH conditions are met:
1. A clear vulnerable code pattern exists
2. Attacker-controlled input is confirmed to reach that pattern

Medium and low confidence items are noted separately or omitted entirely. This prevents false-positive noise that erodes trust in security reviews.

### Research vs. Report Distinction

- **Research**: Entire codebase — data flow, validation layers, framework protections, auth paths
- **Report**: Only specific code locations confirmed vulnerable

Investigating `auth/middleware.py` to understand JWT validation scope does NOT mean flagging it as a finding unless a concrete vulnerability exists there.

---

## 6-Step Review Process

1. **Detect context** — Identify code type: API endpoint, frontend, file handling, event consumer, background job
2. **Load language guide** — Python, JavaScript, Go, Rust, or Java-specific vulnerability patterns
3. **Load infrastructure guide** — Docker, Kubernetes, Terraform, CI/CD (if applicable)
4. **Research codebase** — Trace data flow from entry points through validation to storage/output
5. **Verify exploitability** — Confirm attacker control; check framework mitigations (ORM, template auto-escaping, etc.)
6. **Report high confidence only** — Skip theoretical or partially-mitigated issues

---

## Always Flag (Universal — No Context Required)

| Pattern | Risk |
|---|---|
| `eval(userInput)`, `exec(userInput)` | RCE |
| `pickle.loads(userInput)`, `yaml.load(untrusted)` without SafeLoader | RCE via deserialization |
| `subprocess(..., shell=True)` with user-controlled input | Command injection |
| Hardcoded secrets / API keys in source code | Secret exposure |
| `innerHTML = userInput` (no sanitization) | DOM XSS |
| `dangerouslySetInnerHTML={{__html: userInput}}` | React XSS |
| `v-html="userInput"` | Vue XSS |
| String concatenation in SQL queries | SQL injection |

---

## False Positive Prevention

Do NOT flag:
- Test files and commented-out code (not in production execution path)
- Patterns using constants or server-controlled configuration
- Code paths requiring prior authentication (when auth layer is confirmed sound)
- Django/Rails/React template variables with framework auto-escaping
- ORM queries using parameterized methods (SQLAlchemy `.filter()`, Django ORM, etc.)
- Environment variables and deployment configuration
- TypeScript type annotations (types don't validate at runtime, but they're not vulnerabilities)
- Verbose error messages in non-production environments
- MD5/SHA1 used for non-security purposes (checksums, cache keys — not passwords)

---

## JavaScript / TypeScript Patterns

### Framework Identification

| Framework | Indicators |
|---|---|
| React | `import React`, JSX, `.jsx`/`.tsx` files |
| Vue | `<template>`, `<script>`, `.vue` files |
| Express | `express()`, `app.get()`, `req.body` |
| NestJS | `@Controller`, `@Injectable`, `@Module` |
| Next.js | `pages/`, `app/`, `getServerSideProps` |

### Always Flag

| Pattern | Severity | Notes |
|---|---|---|
| `dangerouslySetInnerHTML={{__html: userInput}}` | Critical | React XSS |
| `innerHTML = userInput` | Critical | DOM XSS |
| `document.write(userInput)` | Critical | DOM XSS |
| `eval(userInput)` | Critical | RCE |
| `new Function(userInput)()` | Critical | RCE |
| SQL string interpolation: `"SELECT ... WHERE id=" + userId` | Critical | SQL injection |
| `child_process.exec(userInput)` | Critical | Command injection |
| `child_process.execSync(f"cmd ${userInput}")` | Critical | Command injection |

### Investigate Before Flagging

| Pattern | Condition for Flag |
|---|---|
| `req.params.*`, `req.query.*`, `req.body.*` used in URL request | Only if URL flows to internal services (SSRF) |
| `path.join(baseDir, userPath)` | Only if `baseDir` doesn't prevent traversal |
| `res.redirect(userUrl)` | Only if URL not validated — open redirect |
| MD5, SHA1 usage | Only if used for passwords or security tokens |
| `Math.random()` | Only if used for security tokens — use `crypto.getRandomValues()` instead |
| `setTimeout(userString)`, `setInterval(userString)` | Code execution via string arg |

### Framework-Specific Guidance

**React:**
- `dangerouslySetInnerHTML` — flag only if `__html` originates from user data
- `href={userUrl}` — check if `javascript:` protocol is possible
- `src={userUrl}` — check for SSRF-equivalent via external data loading

**Vue:**
- `v-html="value"` — flag if `value` is user-controlled

**Express / Node.js:**
- `mongoose.find({ [userField]: userValue })` — NoSQL injection via operator injection
- Wildcard routes — check if catch-all leaks unauthorized routes

**NestJS:**
- `@Public()` / `@SkipAuth()` decorator — verify intentional anonymous access

### Detection Commands

```bash
# React XSS
grep -r "dangerouslySetInnerHTML" --include="*.{js,jsx,ts,tsx}"

# DOM XSS
grep -rn "innerHTML\|outerHTML\|document\.write\|insertAdjacentHTML" --include="*.{js,ts}"

# Code execution
grep -rn "\beval\b\|new Function\b" --include="*.{js,ts}"

# SQL injection risk
grep -rn "query\|execute" --include="*.{js,ts}" | grep "[+\`]" | grep -v "?"

# Command injection
grep -rn "exec\|spawn\|execSync" --include="*.{js,ts}" | grep "shell.*true"

# Hardcoded secrets
grep -rn "apiKey\s*=\s*['\"]sk-\|password\s*=\s*['\"][^'\"]\{8,\}" --include="*.{js,ts}"
```

---

## Python Patterns

### Always Flag

| Pattern | Severity |
|---|---|
| `pickle.loads(userInput)` | Critical |
| `yaml.load(userInput)` without `SafeLoader` | Critical |
| `eval(userInput)`, `exec(userInput)`, `compile(userInput)` | Critical |
| `os.system(f"cmd {user_input}")` | Critical |
| `subprocess.run(..., shell=True)` with user-controlled input | Critical |
| SQL f-string or `.format()`: `cursor.execute(f"... {user_input}")` | Critical |

### Investigate Before Flagging

| Pattern | Condition for Flag |
|---|---|
| `requests.get(url)` | Only if `url` comes from user input |
| `open(userPath)` | Only if path includes user-controlled segments without normalization |
| `hashlib.md5(data)` | Only if used for password storage or security tokens |
| `random.random()` | Only if used for tokens — use `secrets` module instead |

### Framework-Specific Guidance

**Django:**
- Settings variables are deployment config — NOT attacker-controlled → do not flag as SSRF
- Default template auto-escaping is ON → safe; flag `mark_safe()` and `{% autoescape off %}`
- `raw()` and `extra()` query methods with user input → flag
- `HttpResponse(userContent, content_type="text/html")` — flag if content is user-controlled

**Flask:**
- `render_template_string(userInput)` — Critical SSTI (Server-Side Template Injection)
- `app.secret_key = "hardcoded"` — Critical
- Session cookies without `SESSION_COOKIE_SECURE`, `SESSION_COOKIE_HTTPONLY` flags

**FastAPI:**
- Pydantic validation is automatic → reduces input risks
- Raw SQL via SQLAlchemy `text(f"... {user_input}")` — still injectable

### Detection Commands

```bash
# Code execution
grep -rn "eval\|exec\|compile\|pickle\.loads\|yaml\.load" --include="*.py"

# Command injection
grep -rn "os\.system\|subprocess" --include="*.py" | grep "shell=True"

# SSTI (Flask)
grep -rn "render_template_string" --include="*.py"

# SQL injection
grep -rn "cursor\.execute\|\.raw(\|\.extra(" --include="*.py" | grep "f\"\|\.format\|%"

# Hardcoded secrets
grep -rn "secret_key\s*=\s*['\"]" --include="*.py"

# Unsafe deserialization
grep -rn "yaml\.load\b" --include="*.py" | grep -v "SafeLoader\|safe_load"
```

---

## Severity Classification

| Level | Examples |
|---|---|
| **Critical** | Pre-auth RCE, SQL injection (confirmed), auth bypass, hardcoded secrets in source |
| **High** | Stored XSS (confirmed attacker path), SSRF to internal services, IDOR with confirmed cross-user access |
| **Medium** | Reflected XSS (requires user action), CSRF on state-changing endpoints, path traversal (limited scope) |
| **Low** | Missing security headers, verbose error messages, defense-in-depth improvements |

---

## Report Format

For each finding:

```
**[SC-FIND-NNN] <Short name>**
- Location: <file>:<line>
- Severity: Critical / High / Medium / Low
- Confidence: HIGH (both conditions met)
- Pattern: <what vulnerable pattern exists>
- Attacker path: <how attacker-controlled input reaches the vulnerability>
- Evidence: <specific code snippet>
- Remediation: <specific fix at the specific location>
```

Omit low-confidence items or list separately in a "Needs Verification" section.

---

**Reference library structure (upstream):**

```
security-review/
├── SKILL.md
├── infrastructure/
│   ├── docker.md
│   ├── kubernetes.md
│   ├── terraform.md
│   └── ci-cd.md
└── languages/
    ├── python.md
    └── javascript.md
```

**End**
