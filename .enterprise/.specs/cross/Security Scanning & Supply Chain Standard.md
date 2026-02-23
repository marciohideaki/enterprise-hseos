# Security Scanning & Supply Chain Standard
## Cross-Cutting — Mandatory

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — mandatory for all services and pipelines
**Classification:** Cross-Cutting (Mandatory)

> Software supply chain attacks are among the fastest-growing threat vectors.
> This standard defines mandatory, non-negotiable rules for SAST, dependency scanning,
> secret detection, SBOM generation, container security, and SLSA compliance.
> Compliance is verified automatically in CI. Non-compliance blocks delivery.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Security & Identity Standard**
- **Observability Playbook**
- **CSharp DotNET — Architecture Standard** (for C#/.NET-specific toolchain rules)
- **Java Architecture Standard** (for Java-specific toolchain rules)
- **Go Architecture Standard** (for Go-specific toolchain rules)

---

## 1. Activation and Scope

- **SS-01:** This standard is **MANDATORY** for all services, libraries, and pipelines — it is not opt-in. No ADR is required to activate it. An ADR exception approved by the Security Lead is required to deviate from any rule.

- **SS-02:** The scope of this standard covers all of the following assets without exception:
  - Source code (all languages and stacks in use)
  - Third-party dependencies (direct and transitive)
  - Container images (base images and final images)
  - Build artefacts (binaries, packages, NuGet, JARs, OCI images)
  - CI/CD pipelines and their configuration files

- **SS-03:** Compliance with this standard is **enforced automatically** in CI. A pipeline that does not include the mandatory security gates defined in Section 8 is itself non-compliant and must not be used to produce release artefacts.

- **SS-04:** A build or merge that fails any blocking security gate **MUST NOT** be unblocked by retrying, skipping the gate, or disabling the tool — only by fixing the underlying finding or following the formal exception process defined in SS-60.

- **SS-05:** Every repository covered by this standard MUST contain a `.security/` directory at the root. This directory MUST be committed to version control and MUST contain at minimum:
  - `sast-baseline.json` — SAST suppression baseline (see SS-14)
  - A gitleaks or detect-secrets configuration file (see SS-27)
  - A `README.md` documenting any active suppressions, allowlists, and their justifications

---

## 2. Static Application Security Testing (SAST)

### 2.1 Mandatory Activation

- **SS-06:** SAST is **MANDATORY** in CI for every repository containing source code. It is not optional, not configurable per team, and cannot be deferred to a future sprint.

- **SS-07:** SAST MUST run on every pull request and on every merge to a protected branch (main, master, release/*). It MUST NOT be restricted to scheduled runs only.

- **SS-08:** SAST results MUST be published as a CI artefact (JUnit XML, SARIF, or equivalent) and retained for a minimum of 1 year in the artefact store.

### 2.2 Mandatory Toolchain by Stack

- **SS-09:** The following tools are the **mandatory SAST toolchain** per stack. Teams MUST use all listed tools for their stack. Adding supplementary tools is permitted; removing a listed tool requires a Security Lead ADR exception.

  | Stack | Mandatory Tools |
  |---|---|
  | C# / .NET | Semgrep + `Microsoft.CodeAnalysis.NetAnalyzers` (Roslyn Analyzers) + Security Code Scan |
  | Java | SpotBugs + Find Security Bugs plugin + Semgrep |
  | Go | `gosec` (`github.com/securego/gosec`) + Semgrep |
  | PHP | Psalm (security-focused config) + Semgrep + PHPCS-Security-Audit |
  | C++ | Cppcheck + clang-tidy (with security checks enabled) + Semgrep |
  | Flutter / Dart | `dart analyze` (with strict mode) + custom lint rules (security ruleset) |
  | React Native / TypeScript | ESLint with `eslint-plugin-security` + Semgrep |

- **SS-10:** Semgrep MUST use at minimum the `p/security-audit` and `p/owasp-top-ten` rulesets. Additional organisation-specific rules in `.semgrep/` are encouraged.

- **SS-11:** For C# / .NET, `Microsoft.CodeAnalysis.NetAnalyzers` MUST be configured with `<AnalysisMode>AllEnabledByDefault</AnalysisMode>` and security-category rules MUST NOT be suppressed in `.editorconfig` without the annotation process in SS-15.

- **SS-12:** For Go, `gosec` MUST run with `-confidence medium,high -severity medium,high` at minimum. All rules in the G1xx–G7xx range MUST be enabled.

### 2.3 Severity Policy

- **SS-13:** Findings of severity **CRITICAL** or **HIGH** are **merge-blocking** — without exception. The pull request MUST NOT be merged while any unresolved CRITICAL or HIGH SAST finding exists.

- **SS-14:** Findings of severity **MEDIUM** are not merge-blocking but MUST result in a tracked issue (Jira, GitHub Issues, or equivalent) being created within 24 hours of the finding. The issue MUST have a due date of no more than **30 calendar days** from creation. The issue reference MUST be linked in the pull request.

- **SS-15:** Findings of severity **LOW** or **INFO** are tracked but do not block merge or create mandatory issues. They MUST appear in the CI report artefact.

### 2.4 False Positive Suppression

- **SS-16:** A finding MAY be suppressed as a false positive only when the following conditions are met:
  1. The developer has confirmed the finding is not exploitable in the specific context.
  2. The suppression annotation includes a human-readable justification comment explaining why it is not a real risk.
  3. The suppression is recorded in `.security/sast-baseline.json` in the repository root.

- **SS-17:** Bare suppression annotations with no justification are **PROHIBITED**. The following patterns are explicitly forbidden:
  - `// nosec` (Go, no comment)
  - `#nosec` (without justification)
  - `// noinspection` (without justification)
  - `@SuppressWarnings("security")` (without justification)

  Every suppression MUST follow the pattern: `// nosec G304 -- justification: path is validated and allowlisted at L42, user input is never passed directly`.

- **SS-18:** The `.security/sast-baseline.json` file MUST be reviewed as part of every quarterly security review. Stale suppressions (where the code they reference has changed) MUST be removed or revalidated.

---

## 3. Dependency Scanning

### 3.1 Mandatory Activation

- **SS-19:** Dependency scanning is **MANDATORY** in CI for every repository that manages third-party dependencies. It MUST run on every pull request that modifies a dependency manifest (e.g., `*.csproj`, `pom.xml`, `go.mod`, `composer.json`, `package.json`, `pubspec.yaml`).

- **SS-20:** Dependency scanning MUST check against all three of the following vulnerability databases:
  - NVD (National Vulnerability Database)
  - OSV (Open Source Vulnerabilities — osv.dev)
  - GitHub Advisory Database

### 3.2 Mandatory Toolchain by Stack

- **SS-21:** The following tools are the **mandatory dependency scanning toolchain** per stack. All listed tools for a given stack MUST be used.

  | Stack | Mandatory Tools |
  |---|---|
  | C# / .NET | `dotnet list package --vulnerable` + OWASP Dependency-Check |
  | Java | OWASP Dependency-Check + Snyk (or equivalent OSS: osv-scanner) |
  | Go | `govulncheck` (`golang.org/x/vuln/cmd/govulncheck`) |
  | PHP | `composer audit` |
  | C++ | OSS-Fuzz integration (for fuzz-covered components) + `vcpkg audit` (when using vcpkg) |
  | Flutter / Dart | `flutter pub deps --json` piped into osv-scanner |
  | React Native / TypeScript | `npm audit --audit-level=moderate` + `yarn audit` (if using Yarn) |

- **SS-22:** For Go, `govulncheck` MUST be run with `-json` output and results MUST be parsed by the CI gate to apply the blocking policy in SS-23.

### 3.3 Severity Policy

- **SS-23:** A dependency with a **CRITICAL** CVE (CVSS v3 base score >= 9.0) **blocks the build immediately**. The build pipeline MUST fail before producing any artefact. A patch or verified workaround MUST be applied within **24 hours** of detection. If a patch does not exist, the dependency MUST be replaced or removed within 24 hours, or a Security Lead must approve a time-bound mitigation plan.

- **SS-24:** A dependency with a **HIGH** CVE (CVSS v3 base score 7.0–8.9) is **merge-blocking**. The pull request MUST NOT be merged. A patch MUST be applied within **7 calendar days** of detection.

- **SS-25:** A dependency with a **MEDIUM** CVE (CVSS v3 base score 4.0–6.9) does not block merge. A tracked issue MUST be created within 24 hours and resolved within **30 calendar days**.

### 3.4 Pinning and Lock File Requirements

- **SS-26:** All **direct dependencies** in production-targeting manifests MUST specify an exact version — version ranges (`^`, `~`, `>=`, `*`) are **PROHIBITED** in production manifests. This applies to: `package.json`, `*.csproj` `<PackageReference>`, `pom.xml`, `build.gradle`, `pubspec.yaml`, `composer.json`, and `Cargo.toml`.

- **SS-27:** Lock files MUST be committed to the repository and MUST NOT be listed in `.gitignore`. This applies to:
  - `package-lock.json` or `yarn.lock` (Node / React Native)
  - `go.sum` (Go)
  - `Cargo.lock` (Rust, if used)
  - `composer.lock` (PHP)
  - `pubspec.lock` (Flutter/Dart)
  - `packages.lock.json` (NuGet, when `RestorePackagesWithLockFile` is enabled)

- **SS-28:** Dependency scanning MUST include **transitive dependencies** — scanning only direct dependencies is insufficient. Tools MUST be configured to resolve and audit the full dependency tree.

---

## 4. Secret Scanning

### 4.1 Mandatory Activation

- **SS-29:** Secret scanning is **MANDATORY** for every repository. No repository containing source code, configuration, or infrastructure definitions may exist without secret scanning configured and active.

- **SS-30:** Secret scanning operates at **two mandatory layers**:
  1. **Pre-commit hook** — runs on the developer's machine before a commit is created, preventing secrets from ever entering the git history.
  2. **CI gate** — runs in the pipeline on every push and pull request as a second line of defence, catching anything that bypassed the pre-commit hook.

  Both layers MUST be active. The CI gate alone is not sufficient.

- **SS-31:** The mandatory tooling for secret scanning is `gitleaks` (v8.18+) or `detect-secrets` (1.4+). Both are acceptable; the choice MUST be consistent within a repository. The chosen tool's configuration file MUST exist at the repository root:
  - `gitleaks`: `.gitleaks.toml`
  - `detect-secrets`: `.secrets.baseline`

### 4.2 What Constitutes a Secret

- **SS-32:** The following categories of data are classified as **secrets** for the purpose of this standard. Detection of any of the following triggers the blocking policy in SS-33:
  - API keys and access tokens (any service provider)
  - Passwords and passphrases (service accounts, databases, certificates)
  - Private keys (RSA, EC, PGP, SSH, TLS/SSL)
  - Connection strings containing credentials (JDBC, ODBC, ADO.NET, Redis, MongoDB URIs)
  - JWT signing secrets and symmetric keys
  - OAuth 2.0 client secrets
  - Cloud provider credentials: AWS (`AKIA*`), GCP service account JSON, Azure client secrets and SAS tokens
  - Webhook secrets and signing keys
  - Session secrets and HMAC keys

- **SS-33:** If a secret is detected by the **pre-commit hook**, the commit MUST be rejected. The developer MUST remove the secret from the staged content before the commit can proceed. The secret MUST be revoked immediately even if it never reached a remote repository.

### 4.3 Remediation When a Secret Is Found in History

- **SS-34:** If secret scanning detects a secret in the **existing git history** (whether via a retroactive scan or a pre-push hook), the following procedure MUST be executed **immediately and in full**:

  1. **Revoke the credential immediately** — before any other action. Contact the relevant service provider's revocation endpoint or console. Elapsed time between detection and revocation MUST be minimized.
  2. **Remove from git history** using `git filter-repo` (preferred) or BFG Repo-Cleaner. `git filter-branch` is deprecated and MUST NOT be used.
  3. **Force-push the rewritten history** — this requires explicit approval from an Engineering Lead, logged as a comment on the associated security incident ticket.
  4. **Notify the Security team** within **1 hour** of detection. Notification MUST include: repository name, approximate commit range, credential type, service affected, and confirmation of revocation.
  5. **All collaborators** with local clones MUST be notified to re-clone from the rewritten remote. Stale local clones containing the secret MUST be deleted.

- **SS-35:** The secret scanning allowlist (false positives) MUST be documented within the tool's configuration file (`.gitleaks.toml` or `.secrets.baseline`) with a comment explaining why each entry is a false positive. The allowlist MUST be reviewed and revalidated **every quarter**. Stale allowlist entries MUST be removed.

---

## 5. Software Bill of Materials (SBOM)

### 5.1 Mandatory Activation

- **SS-36:** SBOM generation is **MANDATORY** for every release artefact. No artefact may be published to a production environment or external registry without an accompanying, validated SBOM.

- **SS-37:** Accepted SBOM formats are:
  - **SPDX 2.3** (ISO/IEC 5962:2021)
  - **CycloneDX 1.4** or later

  Both formats are accepted. The chosen format MUST be consistent across all artefacts produced by a single repository.

### 5.2 Mandatory Toolchain by Stack

- **SS-38:** The following tools MUST be used for SBOM generation per stack:

  | Stack | Mandatory Tool |
  |---|---|
  | C# / .NET | `dotnet-sbom` CLI tool or `CycloneDX.BOM` NuGet package (CycloneDX target in build) |
  | Java | CycloneDX Maven Plugin (`cyclonedx-maven-plugin`) or CycloneDX Gradle Plugin |
  | Go | `cyclonedx-gomod` (`github.com/CycloneDX/cyclonedx-gomod`) |
  | PHP | `cyclonedx-php-composer` |
  | C++ | `syft` (anchore/syft) or `vcpkg sbom` when vcpkg is the package manager |
  | Flutter / Dart | `cyclonedx-dart` or `syft` targeting the build output |
  | React Native / TypeScript | `@cyclonedx/cyclonedx-npm` (`cyclonedx-node-npm`) |

- **SS-39:** The SBOM MUST be generated as part of the **release build step**, not as a post-hoc addition. The SBOM MUST reflect the exact set of dependencies present in the released artefact.

### 5.3 SBOM Validation, Publication and Retention

- **SS-40:** The generated SBOM MUST be **validated** before publication. Validation MUST confirm:
  - The SBOM is well-formed (parseable against the SPDX or CycloneDX schema).
  - All direct dependencies are listed with their exact version.
  - The document namespace or serial number is unique to this release version.

  Validation tools: `cyclonedx-cli validate` (for CycloneDX) or `ntia-conformance-checker` (for SPDX minimum elements).

- **SS-41:** The SBOM MUST be **published alongside the release artefact** in the artefact registry. The SBOM file MUST follow the naming convention `<artefact-name>-<version>.sbom.json` (CycloneDX) or `<artefact-name>-<version>.spdx.json` (SPDX).

- **SS-42:** SBOMs MUST be retained in the artefact registry for **the lifetime of the release version plus 5 years**. SBOMs MUST NOT be deleted when a release is deprecated; they are required for retrospective vulnerability analysis.

---

## 6. Container Security

### 6.1 Base Image Policy

- **SS-43:** Container base images MUST originate from one of the following **trusted sources**:
  - Docker Official Images (`docker.io/library/*`)
  - Google Distroless (`gcr.io/distroless/*`)
  - Microsoft MCR (`mcr.microsoft.com/*`)
  - Organisation-approved internal base image registry (must be documented in the service ADR)

  Base images from unknown, community-unofficial, or unverified sources are **PROHIBITED**.

- **SS-44:** Base images MUST use a **specific, immutable tag or digest** — the `:latest` tag is **PROHIBITED** in any environment, including development. Acceptable forms are:
  - Exact version tag: `mcr.microsoft.com/dotnet/aspnet:8.0.6`
  - SHA-256 digest pinning: `gcr.io/distroless/base-debian12@sha256:<digest>`

- **SS-45:** Base image preference order (highest to lowest preference):
  1. Google Distroless (`gcr.io/distroless/*`) — preferred for all stacks where supported
  2. Alpine-based minimal images (pinned version, no unnecessary packages added)
  3. Official slim/minimal variants (e.g., `debian:bookworm-slim`, `mcr.microsoft.com/dotnet/aspnet:8.0-alpine`)

  General-purpose OS images (`ubuntu:*`, `debian:latest`, `centos:*`) are **PROHIBITED** as final runtime base images.

### 6.2 Dockerfile Security Requirements

- **SS-46:** **Multi-stage builds are MANDATORY** for all Dockerfiles that compile or build code. The final production image MUST NOT contain build tools, compilers, SDKs, source code, test dependencies, or intermediate build artefacts. Only the runtime-necessary artefacts MUST be copied into the final stage.

- **SS-47:** Containers MUST **NOT run as root**. Every Dockerfile MUST:
  - Create a dedicated non-root user and group: `RUN addgroup --gid 10001 appgroup && adduser --uid 10001 --gid 10001 --disabled-password --no-create-home appuser`
  - Use `COPY --chown=appuser:appgroup` for all files copied into the final stage.
  - Include `USER appuser` as the final user-switching instruction before `ENTRYPOINT` or `CMD`.

- **SS-48:** The following Dockerfile patterns are **PROHIBITED**:
  - `USER root` in any stage of the final image (builder stages may use root only if necessary)
  - `RUN chmod 777` or any world-writable permission grant
  - `ADD` with remote URLs — use `COPY` for local files; use a `RUN curl/wget` step with checksum verification for remote resources
  - `--no-check-certificate`, `--insecure`, or equivalent flags in any `RUN` step
  - Installing unnecessary packages (`curl`, `wget`, `bash`, `git`, `ssh`) in the final runtime image stage

### 6.3 Container Vulnerability Scanning

- **SS-49:** Container image scanning is **MANDATORY** in CI for every repository that produces a container image. Scanning MUST run after the image is built and before it is pushed to any registry.

  Mandatory tools (one of the following MUST be used):
  - **Trivy** (`aquasecurity/trivy`) — `trivy image --exit-code 1 --severity CRITICAL,HIGH <image>`
  - **Grype** (`anchore/grype`) — `grype <image> --fail-on high`

- **SS-50:** Container images with any **CRITICAL or HIGH** CVE MUST NOT be pushed to any registry or deployed to any environment. The CI pipeline MUST exit with a non-zero code, blocking the push. The rule applies to both OS-level CVEs (in base image packages) and application-level CVEs (detected in application layers).

---

## 7. SLSA Compliance

### 7.1 Target Level

- **SS-51:** The mandatory minimum SLSA (Supply-chain Levels for Software Artifacts) compliance level for all production release artefacts is **SLSA Level 2**. SLSA Level 3 is the recommended target for services handling sensitive data or serving as critical infrastructure components.

### 7.2 Level 1 — Build Process Documentation (Mandatory)

- **SS-52:** SLSA Level 1 compliance is **MANDATORY** for all services. Requirements:
  - The build process MUST be fully defined in a version-controlled CI pipeline configuration (GitHub Actions workflow, GitLab CI pipeline, etc.).
  - Ad-hoc manual builds MUST NOT be used to produce release artefacts.
  - The CI configuration file MUST document the build steps, tools, and versions used.

### 7.3 Level 2 — Provenance and Reproducibility (Mandatory for Releases)

- **SS-53:** SLSA Level 2 compliance is **MANDATORY** for all artefacts published as releases. Requirements:
  - The CI pipeline MUST generate a **provenance attestation** for each build. The attestation MUST include: builder identity, build invocation parameters, source repository reference (branch + commit SHA), build start and end timestamps, and a list of produced artefacts with their digests.
  - Provenance MUST be generated using a trusted, non-forgeable mechanism — for GitHub Actions, use the official `actions/attest-build-provenance` action; for other platforms, use SLSA GitHub Generator or equivalent.
  - Builds MUST be **reproducible**: given the same source commit and inputs, the build MUST produce byte-for-byte identical output (or documented reasons for non-reproducibility with a plan to address).

### 7.4 Level 3 — Hermetic Builds (Recommended)

- **SS-54:** SLSA Level 3 is **RECOMMENDED** for critical services. Hermetic build requirements:
  - The build process MUST NOT make network calls during the build execution (all dependencies fetched in a prior, audited fetch step).
  - Build tools MUST be pinned to exact versions with digest verification.
  - The build environment MUST be ephemeral and isolated.

### 7.5 Artefact Signing

- **SS-55:** All release artefacts MUST be **cryptographically signed**. The following tooling MUST be used per artefact type:

  | Artefact Type | Signing Tooling |
  |---|---|
  | OCI container images | Sigstore Cosign (`cosign sign`) with Rekor transparency log |
  | NuGet packages | `dotnet nuget sign` with an X.509 code-signing certificate |
  | Java JARs / WARs | `jarsigner` with a valid code-signing certificate |
  | npm packages | `npm publish` with `--provenance` flag (NPM provenance via Sigstore) |
  | Go binaries | Sigstore `cosign sign-blob` or `goreleaser` with signing enabled |
  | Generic binaries | `cosign sign-blob` with Rekor transparency log entry |

  Unsigned release artefacts MUST NOT be deployed to production.

---

## 8. CI Security Gates

### 8.1 Mandatory Gate Sequence

- **SS-56:** Every CI pipeline that produces a deployable artefact MUST implement all of the following security gates **in the exact order specified**. No gate may be moved earlier than its specified position; gates may be moved later (adding buffering) only with Security Lead approval.

  | Order | Gate | Blocking? | Applies When |
  |---|---|---|---|
  | 1 | Secret scanning (pre-checkout scan of incoming diff) | Yes — hard fail | All pipelines |
  | 2 | SAST | Yes — CRITICAL/HIGH block | All source code pipelines |
  | 3 | Dependency scanning | Yes — CRITICAL/HIGH block | All pipelines with dependencies |
  | 4 | Build | N/A — produces artefact | All pipelines |
  | 5 | Container scan | Yes — CRITICAL/HIGH block | Pipelines producing container images |
  | 6 | SBOM generation and validation | Yes — release blocked if invalid | Release pipelines only |
  | 7 | Artefact signing | Yes — unsigned artefacts not pushed | Release pipelines only |

- **SS-57:** Gates 1–3 MUST complete before the build step (gate 4) begins. A pipeline that runs the build before completing SAST and dependency scanning is non-compliant.

- **SS-58:** **No security gate may be skipped, disabled, or bypassed** without ALL of the following conditions being met simultaneously:
  1. Written approval from the Security Lead, referencing the specific gate and the specific pipeline.
  2. An ADR documenting the exception, the business justification, the risk accepted, and the planned remediation date.
  3. A maximum exception duration of **30 calendar days** — after which the gate MUST be restored or a new ADR exception approved.
  4. The exception MUST be logged in the organisation's security incident or exception register.

  Emergency hotfix deployments follow the same process; verbal approval is insufficient.

### 8.2 Report Retention

- **SS-59:** Reports produced by all security gates MUST be stored as CI artefacts in the artefact store and retained for a minimum of **1 year** from the date of the pipeline run. Reports include: SAST SARIF files, dependency scan JSON/HTML reports, secret scan results, Trivy/Grype scan outputs, SBOM files, provenance attestations, and signing certificates/receipts.

- **SS-60:** A security gate report MUST be linked to the specific pipeline run, branch, commit SHA, and artefact version that produced it. Retention without traceability to the producing artefact is insufficient for compliance purposes.

---

## 9. Enforcement, Violations and Exceptions

- **SS-61:** Violations of any **blocking rule** (CRITICAL/HIGH findings, secret in commit, unsigned release, etc.) MUST be resolved before the affected change is merged, built into a release, or deployed. There are no time-extension mechanisms for blocking violations — only fix or formal exception.

- **SS-62:** Non-blocking violations with tracked issues (MEDIUM findings, 30-day remediation window) that **exceed their due date** automatically escalate to blocking status. An overdue MEDIUM finding is treated as a HIGH finding from the day after the due date.

- **SS-63:** Security tool failures (scanner crashes, network timeouts fetching CVE databases) MUST cause the CI gate to **fail**, not to pass. A gate that passes because the scanner failed to run provides false assurance. Pipelines MUST distinguish between "scanner ran and found nothing" and "scanner did not run."

- **SS-64:** Any permanent suppression, allowlist entry, or exception approved under this standard MUST be stored in `.security/` within the relevant repository and MUST reference: the approving authority, the date of approval, the rationale, and the planned review date.

- **SS-65:** Compliance with this standard is reviewed as part of the quarterly security review for each service. Non-compliant repositories MUST have a remediation plan approved within 14 days of the review finding.
