---
name: dependency-audit
description: "Use when performing a thorough security, license compliance, and governance review of dependency additions or upgrades"
license: Apache-2.0
metadata:
  owner: platform-governance
  version: "1.0.0"
---

# Dependency Audit

## When to use
Use this skill whenever a PR:
- adds a new third-party dependency
- upgrades an existing dependency
- changes a lockfile
- introduces a new transitive dependency with significant impact

---

## 1. Security Vulnerability Check

- DA-01: Every new or upgraded dependency MUST be checked against known CVE databases before merging:
  - NVD (National Vulnerability Database)
  - OSV (Open Source Vulnerabilities — osv.dev)
  - GitHub Dependabot / Security Advisories
  - Snyk or equivalent
- DA-02: **Critical or High CVEs** in direct or transitive dependencies MUST block the PR.
- DA-03: **Medium CVEs** MUST be documented and triaged — blocked unless a remediation plan exists.
- DA-04: **Low CVEs** MUST be noted in the PR; remediation is optional but tracked.
- DA-05: CI/CD pipelines MUST run dependency scanning on every build.

---

## 2. Maintenance & Viability

- DA-06: The dependency MUST be actively maintained:
  - last commit within 12 months
  - open critical issues are being addressed
  - a clear maintainer or organization ownership
- DA-07: Abandoned or unmaintained packages MUST NOT be introduced.
- DA-08: For critical path dependencies, prefer packages backed by a foundation or organization over individual maintainers.
- DA-09: If a dependency is deprecated or nearing end-of-life, document the migration plan.

---

## 3. License Compliance

- DA-10: Every new dependency's license MUST be compatible with the project's license.
- DA-11: Permitted license families (typical defaults — verify with legal for your project):
  - MIT, Apache 2.0, BSD (2-clause, 3-clause), ISC, MPL 2.0
- DA-12: Licenses requiring special review: GPL, LGPL, AGPL, EUPL, CDDL — do not add without legal sign-off.
- DA-13: Proprietary dependencies require explicit approval from Engineering Leadership.

---

## 4. Version Pinning

- DA-14: Dependency versions MUST be **pinned exactly** in the dependency manifest.
- DA-15: Version ranges (`^`, `~`, `>=`, `*`) are FORBIDDEN for production dependencies.
- DA-16: Lockfiles MUST be committed alongside manifest changes.
- DA-17: Transitive dependency changes in the lockfile MUST be reviewed as part of the PR.

### Stack-Specific Pinning
- **Node.js / React Native**: exact version in `package.json`, `package-lock.json` or `yarn.lock` committed
- **Flutter / Dart**: exact version in `pubspec.yaml`, `pubspec.lock` committed
- **C# / .NET**: exact version in `.csproj`, lockfile via `packages.lock.json` recommended
- **Java / Maven**: exact version in `pom.xml`; use `dependencyManagement`
- **Java / Gradle**: exact version in `build.gradle`; lockfile via `gradle.lockfile`
- **Go**: exact module versions in `go.mod`, `go.sum` committed
- **PHP / Composer**: exact version in `composer.json`, `composer.lock` committed
- **C++**: vendor or lock via conan/vcpkg lockfile

---

## 5. Necessity & Scope Justification

- DA-18: The dependency MUST solve a problem that cannot be adequately solved by:
  - existing dependencies already in the project
  - standard library / platform built-ins
  - a simple in-house implementation (< 50 lines)
- DA-19: Scope MUST be appropriate:
  - `devDependencies` for test/build tools
  - Runtime dependencies only for code that runs in production
- DA-20: Heavy dependencies (large bundle size, extensive transitive tree) require explicit size/performance justification.

---

## 6. SBOM (Software Bill of Materials)

- DA-21: SBOM generation is **recommended** for all services — especially those handling sensitive data.
- DA-22: SBOM should be generated as part of the CI/CD release pipeline.
- DA-23: SBOM format: SPDX or CycloneDX preferred.

---

## 7. Audit Output Format

When generating a dependency audit report:

```
## Dependency Audit Report

**Package:** [name@version]
**Stack:** [language/ecosystem]
**Date:** [date]

### CVE Scan
- Status: CLEAN | VULNERABILITIES FOUND
- [List CVEs if found with severity]

### Maintenance
- Last commit: [date]
- Maintainer: [org/individual]
- Status: ACTIVE | CONCERN | ABANDONED

### License
- License: [SPDX identifier]
- Compatibility: COMPATIBLE | REVIEW REQUIRED

### Version Pinning
- Status: PINNED | NEEDS PINNING
- Lockfile: COMMITTED | MISSING

### Justification
- Necessity: JUSTIFIED | QUESTIONABLE
- Notes: [why this dep is needed]

### Verdict: APPROVED | CONDITIONAL | BLOCKED
```

---

## Examples

✅ Good: `axios@1.6.8` pinned exactly, MIT license, actively maintained, no CVEs, lockfile committed.

❌ Bad: `"somelib": "^2.0"` — range version, not pinned.
❌ Bad: Dependency with AGPL license added to a proprietary codebase without legal review.
❌ Bad: Package last updated 3 years ago with open critical issues — abandoned.
❌ Bad: Adding a 2MB library to solve a 10-line problem solvable with stdlib.
