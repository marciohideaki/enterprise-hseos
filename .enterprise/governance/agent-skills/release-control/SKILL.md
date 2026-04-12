---
name: release-control
description: "Use when managing a release end-to-end: changelog validation, risk classification, rollout requirements, and approval gates"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Release Control

## When to use
Use this skill whenever you are about to:
- create a release branch or release tag
- update a CHANGELOG file
- bump a version number
- promote a build to a production environment
- communicate a breaking change to consumers
- write a hotfix

---

## 1. Semantic Versioning (MANDATORY)

- RC-01: All versioned artifacts MUST follow `MAJOR.MINOR.PATCH` (semver).
- RC-02: MAJOR bumps when introducing breaking changes (API removal, contract change, incompatible behavior).
- RC-03: MINOR bumps when adding backward-compatible functionality.
- RC-04: PATCH bumps for backward-compatible bug fixes only.
- RC-05: Pre-release suffixes (`-alpha`, `-beta`, `-rc.N`) are allowed and MUST be stripped before stable promotion.
- RC-06: Version MUST NOT be decremented.

---

## 2. CHANGELOG Discipline

- RC-07: Every release MUST update the CHANGELOG before the release tag is created.
- RC-08: CHANGELOG entries MUST follow this structure per release:
  ```
  ## [X.Y.Z] — YYYY-MM-DD
  ### Breaking Changes
  ### Added
  ### Changed
  ### Fixed
  ### Deprecated
  ### Removed
  ### Security
  ```
- RC-09: Breaking changes MUST be listed under `### Breaking Changes` and prefixed with `⚠`.
- RC-10: Each entry MUST reference the ticket or PR that introduced the change.
- RC-11: Empty sections MAY be omitted.
- RC-12: `### Breaking Changes` MUST NOT be omitted even if it is empty — it signals that the release was reviewed for breaking changes.

---

## 3. Risk Classification

Every release MUST be assigned a risk level before promotion to production:

| Level | Criteria |
|---|---|
| **Low** | Patch fix, no contract changes, no schema changes, no dependency upgrades with CVEs |
| **Medium** | New features, non-breaking contract changes, minor dependency upgrades, configuration changes |
| **High** | Breaking changes, data migrations, schema changes, major dependency upgrades, security patches, infrastructure changes |

- RC-13: Risk level MUST be declared in the release PR or release notes.
- RC-14: Risk level MUST be agreed upon by the release author and at least one reviewer.

---

## 4. Rollout Requirements by Risk Level

### Low Risk
- RC-15: Standard deployment — no special rollout gates required.
- RC-16: Rollback strategy: redeploy previous version.

### Medium Risk
- RC-17: Deploy to staging first; validate before production promotion.
- RC-18: Rollback plan MUST be documented (at minimum: the rollback command or procedure).
- RC-19: Monitor error rate and latency for 30 minutes post-deployment.

### High Risk
- RC-20: Deploy to staging, validate with smoke tests.
- RC-21: Blue-Green or Canary deployment MUST be used where infrastructure supports it.
- RC-22: Rollback plan MUST be documented, tested, and executable within SLA.
- RC-23: All dependent service owners MUST be notified at least 24h before production promotion.
- RC-24: Post-deployment monitoring window: minimum 2 hours active observation.
- RC-25: A dedicated ADR MUST exist for any High-risk release involving breaking changes.

---

## 5. Breaking Change Communication

- RC-26: Breaking changes MUST be communicated to all consumers BEFORE the release.
- RC-27: Communication MUST include:
  - what is changing
  - migration instructions
  - deprecation window (if applicable — see Deprecation & Sunset Policy)
  - rollout timeline
- RC-28: API breaking changes require a new API version — the old version MUST remain available during the deprecation window.
- RC-29: Event/message contract breaking changes require a new event type and a dual-publish period.

---

## 6. Hotfix Rules

- RC-30: Hotfixes MUST branch from the released tag — never from `develop`.
- RC-31: Hotfix branch naming: `hotfix/<ticket>-<description>`.
- RC-32: Hotfix MUST be merged back to BOTH `main` and `develop` after release.
- RC-33: Hotfixes MUST increment PATCH version.
- RC-34: Hotfix CHANGELOG entries MUST be backported to the appropriate version section.

---

## 7. Release Checklist (Verification Gate)

Before promoting any release to production:

- [ ] Version bump is correct per semver rules
- [ ] CHANGELOG updated and reviewed
- [ ] Breaking Changes section reviewed (even if empty)
- [ ] Risk level declared
- [ ] Rollback plan documented for Medium/High
- [ ] Dependent service owners notified for High-risk
- [ ] CI/CD pipeline fully green (no skipped gates)
- [ ] Staging validation passed
- [ ] ADR exists for High-risk breaking changes

## Examples

✅ Good: `feat(orders): add optional discount field to OrderCreated event`
→ MINOR bump, backward compatible, CHANGELOG entry under Added.

✅ Good: `⚠ BREAKING: remove deprecated /v1/users endpoint`
→ MAJOR bump, CHANGELOG entry under Breaking Changes, migration docs in PR.

❌ Bad: Release with no CHANGELOG update.
❌ Bad: PATCH bump for a change that removes a required API field.
❌ Bad: High-risk deployment to production without notifying consumers.
