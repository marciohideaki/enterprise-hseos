---
name: security-audit-plain-language
description: Security audit workflow for non-technical stakeholders. Performs read-only project assessment, requests critical context first, and reports findings in plain language with severity and remediation steps.
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Security Audit (Plain Language)

## 0. Mandatory Pre-Audit Guardrails

- Audit is **read-only** until findings are delivered.
- Do not modify code, config, or infrastructure during the audit phase.
- Ask for missing business/security context before classifying risk.
- Explain findings in non-technical language.

---

## When to use
Use this skill when the user asks for:
- a full project security check in plain language
- a non-technical risk explanation
- executive-friendly security findings with practical remediation

---

## 1. Intake Questions (Required Before Analysis)

Ask and capture answers for:
1. What sensitive data does the project handle?
2. Who can access the system and data?
3. Is the system private, public-facing, or mixed?
4. Are passwords, API keys, tokens, or personal data stored?
5. Where does the project run (local, online, both, unknown)?

If any answer is unknown, continue with explicit assumptions and label them as assumptions.

---

## 2. Audit Scope and Method

1. Explore repository structure and runtime configuration in read-only mode.
2. Identify data entry points, auth boundaries, storage, and integrations.
3. Evaluate the following risk classes:
   - exposed secrets (keys, passwords, tokens, credentials)
   - data leakage vulnerabilities (PII/business data exposure)
   - input attack vectors (SQL injection, XSS, command injection)
   - authentication/authorization weaknesses
   - dependency risks (known vulnerabilities, unmaintained libs)
   - configuration mistakes (unsafe defaults, exposed services)
4. Separate confirmed findings from hypotheses.
5. Do not overstate risk without evidence.

---

## 3. Output Contract (Required)

### 3.1 Executive Summary
- 2 to 3 sentences.
- Plain language.
- State overall risk posture and urgency.

### 3.2 Detailed Findings
For each finding, include:
- what is wrong (plain language)
- why it matters in the real world
- evidence location (file/path/config area)

### 3.3 Severity
- classify as `Low`, `Medium`, or `High`.
- justify severity in one sentence.

### 3.4 Fix Recommendation
- step-by-step remediation.
- prioritize safe, practical actions.
- include what to fix first.

---

## 4. Communication Rules

- Avoid jargon whenever possible.
- If technical terms are required, define them briefly.
- Prioritize business impact and user impact.
- Be direct about uncertainty.

---

## 5. Constraints

- Do not patch during audit.
- Do not hide uncertainty.
- Do not mix confirmed finding with assumption.
- Do not report “critical” risk without evidence of exploitability or strong exposure.
