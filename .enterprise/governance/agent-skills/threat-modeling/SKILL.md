---
name: threat-modeling
description: "Use when performing a full 8-step threat model mapping trust boundaries, assets, abuse paths, and mitigations with mandatory user validation"
license: MIT
metadata:
  owner: platform-governance
  version: "1.0.0"
  source: https://github.com/openai/skills/tree/main/skills/.curated/security-threat-model
---

# Threat Modeling — Full Methodology

## Activation Conditions

**ONLY trigger when the user explicitly requests ONE of:**
- Threat model / threat modeling
- AppSec / application security analysis
- Abuse path enumeration
- Attack surface assessment

**Do NOT activate for:**
- General code review (use `pr-review`)
- Security best practices questions (use `secure-coding`)
- Architecture design discussions (use `/architect` persona)
- PR review (use `pr-review` + `secure-coding`)

---

## Step 1 — Scope & Extract System Model

Map the repository's runtime surface from evidence:

**Include:**
- Primary components and their responsibilities
- Data stores (databases, caches, file systems, queues)
- External integrations (APIs, third-party services, identity providers)
- Entry points (HTTP endpoints, event consumers, job triggers, file parsers, upload handlers)

**Exclude explicitly:**
- CI/CD pipelines and build tooling
- Test infrastructure
- Development-only tooling
- Local scripts

State exclusions in the final document: *"Out of scope: CI/CD pipeline, local dev scripts."*

---

## Step 2 — Boundaries, Assets, and Entry Points

### Trust Boundaries

For each boundary, document:
- Protocol (HTTP, gRPC, WebSocket, message queue)
- Authentication mechanism (JWT, OAuth, API key, mTLS, none)
- Encryption in transit (TLS 1.2+, TLS 1.3, none)
- Input validation layer (schema validation, allow-list, none)

### Risk-Driving Assets

Identify what an attacker would want:
- **Credentials**: API keys, tokens, service account secrets
- **PII**: User data, health records, payment information
- **Compute**: Infrastructure that can be abused for cost/DoS
- **Audit logs**: Evidence of actions (deletion = cover tracks)
- **Business logic**: Pricing, quotas, access control decisions

### Entry Points Catalogue

| Entry Point | Type | Auth Required | Validates Input |
|---|---|---|---|
| `POST /api/users` | HTTP | No (registration) | Partial |
| `GET /api/admin/*` | HTTP | Yes (JWT) | No |
| `queue.consume(events)` | Message queue | No (internal) | No |

---

## Step 3 — Calibrate Assets & Attacker Capabilities

**Describe realistic attackers** based on the system's actual exposure:

| Attacker | Capabilities | Non-capabilities |
|---|---|---|
| Unauthenticated external | HTTP access to public endpoints | Internal network, authenticated paths |
| Authenticated user | All user-scoped endpoints | Admin paths, other users' data |
| Compromised service account | Internal network, service-to-service calls | Root/admin database access |

**Explicitly note what attackers cannot do** — this prevents inflated severity ratings.

---

## Step 4 — Enumerate Threats as Abuse Paths

For each threat, document:
- **Attacker type**: Who performs this action
- **Abuse path**: The specific action sequence
- **Targeted asset**: What is compromised
- **Impact**: Confidentiality / Integrity / Availability

Focus on HIGH-QUALITY realistic threats. Prefer 8 precise threats over 30 generic ones.

**Priority threat categories:**
- Data exfiltration (sensitive data exposure)
- Privilege escalation (horizontal or vertical)
- Integrity compromise (data tampering, injection)
- Availability (DoS of critical components)

---

## Step 5 — Prioritize with Explicit Reasoning

**Risk = Likelihood × Impact**

| Priority | Criteria |
|---|---|
| **Critical** | Pre-auth RCE, auth bypass, cross-tenant access, credential theft, model/config tampering, sandbox escape |
| **High** | Targeted DoS on critical path, partial sensitive data exposure, rate-limit bypass, log poisoning |
| **Medium** | Unvalidated input in non-critical flows, weak session management, CSRF, stored XSS |
| **Low** | Low-sensitivity info leaks, noisy DoS requiring unlikely preconditions |

Each finding must include a one-line justification:
> *"Rated HIGH: unauthenticated endpoint with no rate limiting on a compute-intensive operation — realistic DoS vector."*

---

## Step 6 — Validate Assumptions with User (MANDATORY)

**STOP. Do not proceed to Step 7 without completing this step.**

1. Summarize the 3–5 key assumptions that most affect threat ranking:
   - *"Assuming this service is internet-facing"*
   - *"Assuming no WAF or API gateway in front"*
   - *"Assuming the queue is an internal-only channel"*

2. Ask 1–3 targeted questions:
   - Deployment model: Is this internet-facing or internal-only?
   - Auth: What identity provider is used? Is it centralized?
   - Data sensitivity: Does this service store or process PII/PHI/PCI data?

3. **Wait for the user's answers** before finalizing threat ranking and mitigations.

---

## Step 7 — Recommend Mitigations

For each threat, provide:

| Field | Content |
|---|---|
| **Existing controls** | Controls already present in code (e.g., "Rate limiting via `express-rate-limit` at gateway") |
| **Recommended controls** | Specific additions with location (e.g., "Add input validation schema at `src/api/users.ts:42`") |
| **Control type** | Schema enforcement / Rate limiting / Secrets isolation / Audit logging / Network segmentation |

**Avoid generic advice.** Tie every recommendation to a specific component, file, or service boundary.

---

## Step 8 — Quality Check & Finalize

Before delivering the output:

- [ ] All entry points catalogued in Step 2 are covered by at least one threat
- [ ] All trust boundaries documented with protocol + auth + encryption
- [ ] Runtime scope is clearly separated from CI/build/dev tooling
- [ ] User validation (Step 6) completed and answers reflected
- [ ] Each threat has priority + one-line justification
- [ ] All mitigations tied to specific components (no generic advice)
- [ ] Output saved as `<repo-name>-threat-model.md`

---

## Output Template

```markdown
# Threat Model — <Repo Name>

**Date:** YYYY-MM-DD
**Scope:** <what is included / what is excluded>
**Assumptions confirmed by:** <user name or "not yet validated">

---

## System Model

### Components
- [Component A]: <responsibility>
- [Component B]: <responsibility>

### Trust Boundaries
| Boundary | Protocol | Auth | Encryption |
|---|---|---|---|

### Risk-Driving Assets
- [Asset]: <description, sensitivity level>

---

## Threat Inventory

### [T-001] <Threat Name>
- **Attacker:** <type>
- **Abuse path:** <step-by-step>
- **Asset:** <what is impacted>
- **Impact:** Confidentiality / Integrity / Availability
- **Priority:** Critical / High / Medium / Low
- **Justification:** <one line>

---

## Mitigations

### [T-001] <Threat Name>
- **Existing:** <current control>
- **Recommended:** <specific addition with file/component reference>
- **Control type:** <category>

---

## Assumptions

1. <assumption>
2. <assumption>

*Validated with user on: <date or "pending">*
```
