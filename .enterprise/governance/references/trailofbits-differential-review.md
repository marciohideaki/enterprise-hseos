# Trail of Bits Differential Review — Reference

**Source:** Trail of Bits (Omar Inuwa)
**Repository:** https://github.com/trailofbits/skills/tree/main/plugins/differential-review
**License:** MIT

---

## Core Methodology

Differential review focuses on the DIFF — not the full codebase. It answers: "What changed, and what are the security and correctness implications of exactly those changes?"

The key distinction: you are not auditing the codebase. You are auditing what the PR *changed* and whether those changes introduce new risk.

### Risk Prioritization

Areas that warrant deeper analysis:
- Authentication and authorization changes
- Cryptographic operations
- Value transfers or financial logic
- Privilege boundary crossings
- Input validation at trust boundaries
- Shared libraries or platform-wide interfaces

---

## 6-Phase Workflow

### Phase 0 — Baseline Context

Build a mental model of the existing system BEFORE analyzing the diff:
- Understand system architecture and data flow
- Identify existing security invariants
- Note areas of known complexity or past bugs (from git log)

```bash
# Understand history of modified files
git log --oneline -20 -- <file>
git blame <file>
```

### Phase 1 — Intake & Triage

- Identify base and target branches/commits
- Assess scope: lines changed, files touched, components affected
- Risk-prioritize diff areas for depth of analysis
- Explicitly state which areas receive deep vs. lighter review

### Phase 2 — Changed Code Analysis

For each modified file:
- Understand the purpose of the change
- Identify what was added, removed, and modified
- Use `git blame` to understand evolution and intent
- Assess whether change introduces new behavior or modifies existing logic
- Check if change is additive-only or alters existing behavior

### Phase 3 — Test Coverage Analysis

- Map tests to changed code: which changed lines have test coverage?
- Identify coverage gaps: what changed code has NO tests?
- Assess test quality: do existing tests exercise the new/changed behavior?
- Flag: changed logic with zero test coverage is a blocking concern

### Phase 4 — Blast Radius Analysis

Quantify the impact of the change:
- How many callers does the modified function/method have?
- Which services or components depend on the changed interface?
- Deployment scope: one service / shared library / platform-wide
- Are there untested downstream consumers?

| Scope | Required Action |
|---|---|
| Single service, internal only | Standard review |
| Shared internal library | Caller count verified; evidence in PR description |
| Platform-wide / external consumers | Migration guide + consumer notification + explicit sign-off |

```bash
# Count callers of a function
grep -r "functionName" --include="*.{ts,js,py,go,cs}" | wc -l

# Find cross-service imports
grep -r "from @package/" --include="*.ts" | grep -v "node_modules"

# Check callers in other BCs
grep -r "import.*ServiceName" --include="*.{ts,cs,go}" | grep -v "test\|spec"
```

### Phase 5 — Deep Context Analysis

For high-risk areas from triage:
- Read surrounding code (not just the diff) to understand invariants
- Check related tests for assumed behavior
- Review commit history of modified files for past bug patterns
- Understand what the code was designed to prevent and verify the change doesn't break it

### Phase 6 — Adversarial Analysis → Report

Apply attacker thinking to the diff (see Attacker Modeling section below).
Produce a structured report (see Reporting Format section below).

---

## Attacker Modeling Framework

### Step 1: Define the Attacker Model

Before analyzing, define who the attacker is:
- **External (unauthenticated)**: internet-facing attacker, no credentials
- **Authenticated user**: logged-in user attempting privilege escalation or data access
- **Malicious insider**: authenticated internal user or compromised service account

### Step 2: Identify Attack Vectors

For each high-risk change:
1. What is the entry point? (API endpoint, message queue, file upload, event handler, etc.)
2. What is the attacker-controlled input?
3. What is the target? (data exfiltration, RCE, privilege escalation, DoS)
4. What preconditions are required?

### Step 3: Rate Exploitability

| Rating | Criteria |
|---|---|
| **EASY** | No preconditions; public endpoint; reproducible in minutes |
| **MEDIUM** | Requires account or specific conditions; reproducible in hours |
| **HARD** | Requires privileged access, timing, or complex state setup |

### Step 4: Build Exploit Scenario

For each EASY or MEDIUM finding, document:
- Attacker type (external / authenticated / insider)
- Entry point
- Payload or action sequence
- Expected (correct) outcome
- Actual (vulnerable) outcome
- Severity: Critical / High / Medium

### Step 5: Cross-Reference with Baseline

Confirm the vulnerability exists BECAUSE of the diff, not a pre-existing issue:
- Does the changed code introduce this vulnerability?
- Would reverting the diff remove it?
- If pre-existing: note it separately — do not block the PR for it, but create a follow-up issue

---

## Vulnerability Patterns (Quick Detection)

### Security Regressions

**What to look for:** New code that removes or bypasses existing security checks.

```bash
# Find removed security checks
git diff <range> | grep "^-" | grep -E "require|assert|auth|check|valid|permit|allow|deny|restrict|guard"

# Find new anonymous/public access markers
git diff <range> | grep "^+" | grep -E "AllowAnonymous|@Public|SkipAuth|no_auth|public=True"

# Find removed rate limiting
git diff <range> | grep "^-" | grep -E "rate_limit|throttle|RateLimit"
```

### Double Decrease / Double Increase Bugs

**Pattern:** Logic that can be triggered twice without atomicity → inconsistent state.

```bash
git diff <range> | grep -E "balance|amount|count|total|sum" | grep -E "\-=|\+="
```

**Example:**
```
balance -= amount;  // No lock → can be called twice → double withdrawal
```

### Missing Validation

**Pattern:** New data fields processed without validation.

```bash
git diff <range> | grep "^+" | grep -E "req\.body\.|req\.params\.|req\.query\.|request\." | grep -v "validate\|sanitize\|check\|schema"
```

### Integer Overflow / Underflow

**Pattern:** Arithmetic on user-controlled values without bounds checks.

```bash
git diff <range> | grep "^+" | grep -E "int\|uint\|i32\|u64" | grep -E "\+|-|\*"
```

### Access Control Bypass

**Pattern:** New code path reachable without existing authorization guards.

```bash
# Find new function/method definitions
git diff <range> | grep "^+" | grep -E "^(public|async|def |function |func )"

# Verify each has authorization
git diff <range> | grep -E "auth|permission|role|require|guard|decorator|Authorize"
```

### Race Conditions (TOCTOU)

**Pattern:** Check-then-act without atomicity.

```bash
git diff <range> | grep -E "if.*exists|if.*found|check.*then|read.*write"
```

**Signs of TOCTOU:**
1. Condition check (`if exists`)
2. Non-atomic operation that depends on the condition
3. No lock, transaction, or compare-and-swap between check and action

### Unchecked Return Values

**Pattern:** External call without success verification.

```bash
git diff <range> | grep "^+" | grep -E "\.call\(|\.send\(|\.transfer\(|\.execute\(" | grep -v "if\|require\|assert\|check\|\.then\|await\|="
```

### Reentrancy (Solidity / async code)

**Pattern:** External call before state update.

**Detection:** Look for external calls (`.call()`, await on external service) before state writes in the same function scope.

---

## Blast Radius Quick Commands

```bash
# Count callers of modified function
grep -r "functionName" --include="*.{ts,js,py,go,cs}" | grep -v "test\|spec\|mock" | wc -l

# Find cross-service dependencies
grep -r "from '@internal/package'" --include="*.ts" | grep -v "node_modules"

# Find direct BC package imports (leakage check)
grep -r "from.*bounded-context-name" --include="*.{ts,cs}" | grep -v "test"
```

---

## Reporting Format

### 9-Section Report Structure

```markdown
## Differential Review Report

**PR:** [title]
**Reviewer:** [agent/human]
**Date:** [date]
**Commits:** [base]..[head]
**Risk:** [Low / Medium / High] — [one-line justification]

### 1. Executive Summary
[2-3 sentence summary of key findings and merge recommendation]

### 2. Triage Outcome
[Areas analyzed in depth vs. lighter review — with justification]

### 3. Critical Findings
[Each finding: location, severity, exploit scenario, remediation]

### 4. High/Medium Findings
[Supporting findings with evidence]

### 5. Coverage Gaps
[Changed code with no test coverage — file:line references]

### 6. Blast Radius
[Caller count, deployment scope, consumer test coverage — or N/A if isolated]

### 7. Adversarial Analysis
[Attack scenarios with exploitability ratings — EASY/MEDIUM/HARD]

### 8. Recommendations
[Actionable items, prioritized]

### 9. Verdict: APPROVED / CHANGES REQUESTED / BLOCKED

### Required Changes (if any)
[Explicit blocking list with file:line references]
```

### Severity Indicators

| Severity | Indicator | Action |
|---|---|---|
| Critical | 🔴 | Block immediately |
| High | 🟠 | Block — fix before merge |
| Medium | 🟡 | Request changes |
| Low | 🟢 | Comment, not blocking |
| Informational | ⚪ | Note only |

---

## Full Quick Detection Command Set

```bash
# Security regressions — removed checks
git diff <range> | grep "^-" | grep -E "require|assert|auth|check|valid"

# New anonymous/public access
git diff <range> | grep "^+" | grep -E "AllowAnonymous|@Public|SkipAuth"

# New external calls (unverified return)
git diff <range> | grep "^+" | grep -E "\.call\(|\.delegatecall\(|http\.|fetch\("

# Changed access modifiers
git diff <range> | grep -E "public|private|internal|protected|onlyOwner"

# Arithmetic on sensitive values
git diff <range> | grep -E "balance|amount|count|total" | grep -E "\-=|\+="

# New unvalidated inputs
git diff <range> | grep "^+" | grep -E "req\.body|req\.params|request\." | grep -v "validate\|sanitize"

# Removed rate limits
git diff <range> | grep "^-" | grep -E "rate_limit|throttle|RateLimit"

# TOCTOU patterns
git diff <range> | grep -E "if.*exists|check.*then|find.*update"

# New endpoints without authorization
git diff <range> | grep "^+" | grep -E "@Get\|@Post\|@Put\|@Delete\|app\.(get|post|put|delete)" | grep -v "auth\|guard\|protect"
```

**End**
