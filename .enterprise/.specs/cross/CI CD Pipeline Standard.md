# CI/CD Pipeline Standard
## Cross-Cutting — Mandatory

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — mandatory for all services with automated pipelines
**Classification:** Cross-Cutting (Mandatory)

> CI/CD pipelines are the enforcement boundary of every engineering standard.
> A pipeline that skips a quality gate is a pipeline that silently accepts technical debt,
> security risk, and operational instability. This standard defines what every pipeline
> MUST do, in what order, how fast, and under what conditions delivery is permitted.
> Compliance is not optional and cannot be deferred.

---

## Referenced Standards (MANDATORY)

- **Enterprise Constitution**
- **Security & Identity Standard**
- **Security Scanning & Supply Chain Standard**
- **Observability Playbook**
- **Data Contracts & Schema Evolution Standard**
- **Resilience Patterns Standard**

---

## 1. Pipeline Stages — CI (CI-01 a CI-15)

### 1.1 Mandatory Stage Sequence

- **CI-01:** Every CI pipeline MUST execute the following stages **in the order listed below**. No stage may be reordered, merged with another stage in a way that weakens its gate, or omitted without the explicit exception process defined in CI-15.

| # | Stage | Minimum Tooling | Failure Behavior |
|---|---|---|---|
| 1 | **Checkout & Setup** | VCS native + dependency cache restore | Hard stop |
| 2 | **Secret Scanning** | gitleaks or detect-secrets | Hard stop — immediate |
| 3 | **SAST** | Stack-specific (see Security Scanning Standard) | Hard stop on CRITICAL/HIGH |
| 4 | **Build** | Stack-native compiler/transpiler | Hard stop |
| 5 | **Unit Tests** | Stack-native test runner + coverage report | Hard stop on failure or coverage miss |
| 6 | **Integration Tests** | Testcontainers or equivalent | Hard stop |
| 7 | **Dependency Scanning** | OWASP Dependency-Check, Trivy, or Snyk | Hard stop on CRITICAL/HIGH CVE |
| 8 | **Code Quality Gate** | SonarQube/SonarCloud or equivalent | Hard stop on threshold breach |
| 9 | **Container Build** | Docker BuildKit | Hard stop (if applicable) |
| 10 | **Container Scan** | Trivy or Grype | Hard stop on CRITICAL/HIGH (if applicable) |
| 11 | **SBOM Generation** | Syft, CycloneDX, or equivalent | Hard stop on release branches |
| 12 | **Artifact Publish** | Registry push | Executes only if all prior stages passed |

- **CI-02:** The pipeline MUST enforce stage ordering via tooling dependency configuration — it MUST NOT rely on developer discipline alone. A misconfigured pipeline that runs stages out of order is itself a non-compliance finding.

- **CI-03:** Stages 1–4 (Checkout through Build) MUST complete in **under 2 minutes total**. Breaching this threshold triggers a P2 optimization ticket (see CI-08).

- **CI-04:** Stages 1–8 (Checkout through Code Quality Gate) MUST complete in **under 15 minutes total**. Breaching this threshold triggers a P2 optimization ticket and requires a documented pipeline optimization plan within 5 business days.

- **CI-05:** Dependency cache MUST be used for all package managers (npm, Maven, Gradle, NuGet, pip, Go modules, etc.). Downloading all dependencies from the internet on every build run is forbidden. Cache keys MUST include a hash of the dependency lock file.

- **CI-06:** Secret Scanning (Stage 2) MUST run **before** any build or compilation step. A finding MUST cause immediate pipeline termination with a non-zero exit code. The finding MUST be surfaced in the PR review interface, not only in pipeline logs.

- **CI-07:** SAST (Stage 3) MUST fail the pipeline on any CRITICAL or HIGH severity finding that is not present in the approved suppression baseline (see Security Scanning & Supply Chain Standard). Baseline suppressions require Security Lead sign-off and MUST be reviewed quarterly.

- **CI-08:** Build (Stage 4) MUST produce a deterministic output given the same inputs. Non-deterministic builds (e.g., timestamp-embedded binaries that differ on every run) are forbidden unless explicitly justified by an ADR.

- **CI-09:** Unit Tests (Stage 5) MUST produce a coverage report in a machine-readable format (JUnit XML + Cobertura/lcov). The coverage report MUST be archived as a CI artifact and MUST be consumed by the Quality Gate stage. Coverage thresholds are enforced in Section 6.

- **CI-10:** Integration Tests (Stage 6) MUST use ephemeral infrastructure (Testcontainers, Docker Compose in CI, or equivalent). Tests MUST NOT connect to shared staging or production environments. Each pipeline run gets its own isolated environment that is destroyed after the stage completes.

- **CI-11:** Dependency Scanning (Stage 7) MUST scan both direct and transitive dependencies. The scan result MUST be published as an artifact (CycloneDX, SARIF, or JSON). A CRITICAL CVE finding MUST fail the build. A HIGH CVE finding MUST block the merge.

- **CI-12:** Container Build (Stage 9) is mandatory for all services that are deployed as container images. If a service does not produce a container image, this stage MUST be explicitly marked as `skipped` with a reason — not silently absent.

- **CI-13:** Container Scan (Stage 10) MUST scan the final image, not the base image in isolation. The scan MUST cover OS packages, language runtime packages, and application dependencies embedded in the image. Any CRITICAL or HIGH finding blocks the image push.

- **CI-14:** SBOM Generation (Stage 11) is mandatory for all `release/*` and `main`/`master` branch builds. SBOMs MUST be stored as pipeline artifacts and attached to the release record. SBOM format MUST be CycloneDX JSON or SPDX.

- **CI-15:** Skipping any mandatory stage requires: (a) a written exception approved by the Engineering Lead, (b) an ADR documenting the justification and the compensating control, and (c) a JIRA/issue ticket tracking remediation with a due date. The exception MUST be reviewed at the next architecture review cycle. No exception may be self-approved.

---

## 2. Branch Strategy & Protection (CI-16 a CI-25)

- **CI-16:** The following branch model is mandatory. Deviation requires an ADR approved by the Engineering Lead.

| Branch | Protection | Purpose |
|---|---|---|
| `main` / `master` | Required: PR approval + full CI passing | Production-ready code |
| `develop` | Required: PR + CI passing | Integration branch |
| `feature/<ticket>-<short-desc>` | None | Active feature development |
| `release/v<semver>` | Required: release process only | Release candidate preparation |
| `hotfix/<ticket>-<desc>` | None | Emergency production fix |

- **CI-17:** All branch names MUST match the following regex:

  ```
  ^(feature|bugfix|hotfix|release|chore)/[A-Z]+-[0-9]+-[a-z0-9-]+$
  ```

  Examples of compliant names: `feature/PROJ-123-user-auth`, `hotfix/PROJ-456-payment-timeout`.
  Examples of non-compliant names: `my-branch`, `fix-bug`, `feature/add-new-thing`.
  The naming convention MUST be enforced by a branch creation hook or CI validation step, not only by documentation.

- **CI-18:** Direct commits to `main`/`master` and `develop` are forbidden without exception. Every change MUST arrive via a Pull Request. Force-push to protected branches is forbidden permanently.

- **CI-19:** Feature branches MUST have a maximum lifetime of **5 calendar days**. A branch older than 5 days without a merge or active PR triggers an automated notification to the branch author and their Engineering Lead. Branches older than 10 days with no activity are deleted automatically by the branch lifecycle job.

- **CI-20:** A Pull Request targeting `main`/`master` or `develop` MUST satisfy ALL of the following before merge is permitted:
  - Minimum **1 reviewer** approved (human, not the author)
  - Minimum **2 reviewers** for changes tagged as architectural (touching ADRs, infrastructure, cross-cutting configuration)
  - All CI stages passing (no bypasses)
  - Zero unresolved PR review discussions
  - No merge conflicts

- **CI-21:** `release/*` branches MUST be created only by the designated release process automation or by a Release Manager. Manual creation of release branches from feature work is forbidden.

- **CI-22:** Hotfix branches MUST be merged into **both** `main`/`master` and `develop` as part of the same hotfix lifecycle. A hotfix merged only to main without a corresponding merge to develop is an incomplete hotfix and constitutes a process violation.

- **CI-23:** The CI pipeline MUST validate the branch naming convention on every push. A push to a non-compliant branch name MUST fail the pipeline with a clear error message indicating the expected format.

- **CI-24:** Merge strategy for protected branches MUST be configured to **Squash and Merge** or **Rebase and Merge** — merge commits on protected branches are not permitted unless explicitly decided by ADR. This ensures a linear, readable history.

- **CI-25:** Stale branches (no commit in 30 days, no open PR) are subject to automated archival notification. After 7 days without response, the branch is deleted. Branch deletion does not delete tags.

---

## 3. CD — Deployment Stages (CI-26 a CI-40)

### 3.1 Environment Promotion Chain

- **CI-26:** All services MUST progress through environments in the following mandatory order:

  ```
  build artifact → dev → staging → production
  ```

  Deploying directly to staging or production without a prior successful `dev` deployment from the same artifact version is forbidden.

- **CI-27:** Deployment to `dev` MUST be **automatic** upon a successful merge to `develop` (or `main` for trunk-based teams). No manual approval is required for `dev`.

- **CI-28:** Deployment to `staging` requires **manual approval** from the service owner or Engineering Lead, plus a passing CI pipeline on the artifact being promoted.

- **CI-29:** Deployment to `production` requires ALL of the following:
  - Manual approval from minimum **1 Engineering Lead**
  - Documented evidence that staging smoke tests passed (link to pipeline run)
  - No active deploy freeze (see CI-36)
  - The artifact being deployed is exactly the same image/package that passed staging — no rebuilds for production

### 3.2 Deployment Strategy

- **CI-30:** Zero-downtime deployment is mandatory for all production services. Acceptable strategies are **Blue-Green** or **Rolling Update**. Big-bang replacement with downtime requires a pre-approved maintenance window, which MUST be communicated to stakeholders at least 48 hours in advance.

- **CI-31:** Every deployment MUST include an automated **health check** phase immediately after the new version is live. The health check MUST verify at minimum: the service is running, the readiness endpoint returns 200, and critical dependencies are reachable.

- **CI-32:** If the post-deploy health check fails within **5 minutes** of deployment completion, rollback MUST be triggered automatically without human intervention. The rollback MUST restore the previous known-good version. An alert MUST be sent to the Engineering Lead immediately.

- **CI-33:** Smoke tests are mandatory after every production deployment. A minimum of **3 critical business endpoints** MUST be tested in the smoke test suite. Smoke test failure MUST trigger the same automatic rollback as a health check failure.

- **CI-34:** Canary deployment is **recommended** (not required) for releases flagged as high-risk. When used, the traffic progression MUST follow: `10% → 50% → 100%`. Each phase MUST include an observation window with defined success criteria (error rate, latency) before automatic promotion to the next phase. Manual override to abort the canary is always available.

- **CI-35:** Deployment configuration MUST be version-controlled. The deployment pipeline MUST produce an immutable record of: which artifact version was deployed, to which environment, by which actor (human or automation), at what timestamp, and with which configuration values (excluding secrets).

### 3.3 Deploy Freeze

- **CI-36:** A deploy freeze is in effect under the following conditions:
  - Fridays after 14:00 (local timezone of the primary engineering team)
  - The day before public holidays (nationally observed)
  - Any period explicitly declared via the `.deploy-freeze` configuration file at the repository root

- **CI-37:** The CI/CD pipeline MUST check for active deploy freezes before allowing any deployment to `staging` or `production`. An attempted deployment during a freeze MUST fail with a clear message identifying the freeze reason and its scheduled end.

- **CI-38:** Emergency override of a deploy freeze requires approval from the CTO or designated on-call Engineering Lead. The override MUST be logged with a justification. Override approvals are reviewed monthly.

- **CI-39:** Hotfix deployments may bypass a deploy freeze if approved per CI-38. All other deployments are blocked without exception.

- **CI-40:** The `.deploy-freeze` file at the repository root defines additional freeze windows beyond the defaults in CI-36. The format is defined in Section 8. The absence of this file means only the default freeze rules apply.

---

## 4. Environment Configuration (CI-41 a CI-50)

- **CI-41:** Secrets MUST NEVER be stored in version control. This includes `.env` files, application configuration files, infrastructure code, pipeline definitions, and inline values in any committed file. The Secret Scanning stage (CI-06) enforces this automatically.

- **CI-42:** The mandatory secret management backends are: HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager. Team-operated secrets stored in spreadsheets, wiki pages, or chat messages are forbidden.

- **CI-43:** Runtime configuration MUST be provided via **environment variables** injected at deployment time by the secret manager or the platform's configuration service. Configuration files committed per environment (e.g., `appsettings.staging.json` with real values) are forbidden.

- **CI-44:** `.env` files are forbidden in all repositories, even those named `.env.example` or `.env.sample` if they contain real values. `.env.example` files containing only placeholder values (e.g., `DATABASE_URL=your-connection-string-here`) are permitted as documentation only.

- **CI-45:** Feature flags MUST be used for any capability that may need to be disabled without redeployment. The mandatory platforms are LaunchDarkly, Unleash, Flagsmith, or an equivalent evaluated and approved by the Engineering Lead. Feature flag state MUST be observable in the same observability platform as service metrics.

- **CI-46:** Infrastructure MUST be defined as code (IaC). Acceptable tools: Terraform, OpenTofu, Pulumi, AWS CDK, or Bicep. Manual infrastructure changes applied outside of IaC tooling are forbidden in staging and production.

- **CI-47:** `terraform plan` (or equivalent) MUST return zero drift for a healthy environment. Infrastructure drift (live state differs from code) is a P2 finding that must be resolved within 5 business days.

- **CI-48:** IaC code MUST be stored in a repository under the same branch protection and CI policies as application code. Infrastructure changes MUST go through PR review. Direct `terraform apply` without a reviewed plan is forbidden.

- **CI-49:** Each environment (dev, staging, production) MUST have its own isolated secret namespace/path in the secret manager. Cross-environment secret access is forbidden at the IAM/policy level.

- **CI-50:** Rotation of secrets MUST be automated where the secret manager supports it. Static secrets that cannot be rotated automatically MUST be documented with a rotation schedule and owner. A secret with no documented rotation schedule is a P2 security finding.

---

## 5. Artifact Management (CI-51 a CI-58)

- **CI-51:** All publishable artifacts (container images, NuGet packages, Maven artifacts, npm packages, Go modules, binaries) MUST be stored in a centralized, access-controlled artifact registry. The registry MUST be one of: Amazon ECR, Google Artifact Registry, Azure Container Registry, JFrog Artifactory, or Sonatype Nexus. Personal registries and public registries as the primary distribution channel are forbidden.

- **CI-52:** Artifact naming convention is `<service-name>:<semver>`. The `:latest` tag MUST NOT be used in staging or production deployments. The `:latest` tag may be produced as a convenience alias during development but must never be the tag used in any deployment manifest.

- **CI-53:** Published artifact tags are **immutable**. Once a tag is pushed to the registry, it MUST NOT be overwritten. A new version requires a new tag. Registries MUST be configured to enforce immutability at the platform level, not only by policy.

- **CI-54:** Artifact version numbering MUST follow Semantic Versioning (`MAJOR.MINOR.PATCH`). Pre-release identifiers (`-rc.1`, `-alpha.2`) are permitted for release candidates. Build metadata (`+build.123`) is permitted for traceability.

- **CI-55:** Artifact retention policy:
  - All release tags matching `v*` are retained **indefinitely**
  - The last **10 versions** of non-release artifacts are retained
  - Feature branch artifacts have a **TTL of 7 days**
  - Artifacts older than the retention window are deleted by scheduled cleanup job

- **CI-56:** A security scan (Trivy, Grype, or equivalent) is mandatory **before** publishing an artifact to the registry. An artifact with CRITICAL or HIGH vulnerabilities MUST NOT be published. This scan runs as Container Scan (Stage 10) in the CI pipeline.

- **CI-57:** Release artifacts (versions tagged `v*`) MUST include **SLSA Level 2 provenance attestation**. Attestation MUST be stored alongside the artifact in the registry and verifiable with `cosign` or equivalent. The attestation MUST reference: the source repository, the commit SHA, the pipeline run ID, and the build environment.

- **CI-58:** Artifacts MUST be signed. Container images MUST be signed using Cosign or Notary v2. Package artifacts MUST be signed using the registry's native signing mechanism or GPG. Unsigned artifacts from release pipelines are a blocking non-compliance finding.

---

## 6. Quality Gates — Thresholds Obrigatórios (CI-59 a CI-65)

- **CI-59:** The following quality gates are mandatory and MUST be enforced by the CI pipeline. A gate failure MUST block the merge or build as specified. Gates MUST NOT be bypassed by configuration changes without an approved ADR.

| Gate | Threshold | Scope | Action on Fail |
|---|---|---|---|
| Unit test coverage — Domain layer | < 90% | Per service | Block merge |
| Unit test coverage — Application layer | < 80% | Per service | Block merge |
| Unit test coverage — Infrastructure layer | < 60% | Per service | Block merge (warning at < 70%) |
| SAST finding — CRITICAL | Any finding | Per PR | Block merge |
| SAST finding — HIGH | Any finding not in baseline | Per PR | Block merge |
| CVE in dependency — CRITICAL | Any finding | Per build | Block build |
| CVE in dependency — HIGH | Any finding | Per PR | Block merge |
| Container CVE — CRITICAL or HIGH | Any finding | Per image | Block image push |
| Build duration (Stages 1–8) | > 20 minutes | Per pipeline run | P2 ticket + optimization plan required |
| Test duration (Unit + Integration) | > 15 minutes | Per pipeline run | P2 ticket + parallelization required |
| Code duplication | > 5% | Per PR | Block merge (warn at 3%) |
| Cyclomatic complexity per method | > 15 | Per method | Block merge |

- **CI-60:** Coverage thresholds from CI-59 apply per layer of the clean/hexagonal architecture. A service with no discernible layering defaults to the Application layer threshold (80%). Services with undifferentiated code apply the Domain threshold (90%) for all business logic files.

- **CI-61:** Quality gate configuration MUST be stored in version-controlled files (e.g., `sonar-project.properties`, `.sonarcloud.properties`) and MUST NOT be modified via the SonarQube/SonarCloud UI directly. UI-only changes are overwritten on the next push.

- **CI-62:** A gate that produces a "warning" (not a block) MUST generate a JIRA/issue ticket automatically within the pipeline run. Warning tickets MUST be assigned to the PR author and linked to the PR.

- **CI-63:** If a service's coverage falls below the threshold due to a merge that was compliant at the time (e.g., another merged PR deleted covering tests), the team has **3 business days** to restore compliance before the next merge to that service is blocked.

- **CI-64:** Quality gate history MUST be retained for a minimum of 12 months and be queryable per service, per date range, and per gate type. This data feeds the pipeline observability metrics in Section 7.

- **CI-65:** The Engineering Lead receives a weekly automated report summarizing gate failures by service, trend over the past 4 weeks, and services currently in a grace period (CI-63). This report MUST be generated by the CI observability tooling, not manually.

---

## 7. Observability do Pipeline (CI-66 a CI-72)

- **CI-66:** Pipeline execution metrics MUST be exported to the same observability platform used for service metrics (Datadog, Grafana/Prometheus, New Relic, or equivalent). The following metrics are mandatory:

  | Metric | Unit | Alert Condition |
  |---|---|---|
  | Stage duration per pipeline | seconds | P95 > stage threshold (Section 1) |
  | Total pipeline duration | seconds | P95 > 20 min |
  | Build success rate | percentage | < 80% in 24h rolling window |
  | Build failure rate | percentage | > 20% in 24h → alert Engineering Lead |
  | Deploy success rate per environment | percentage | < 95% in 7-day window → alert |
  | Flaky test count | count | Any increase → auto-ticket |
  | MTTR pipeline | minutes | P95 > 30 min → review required |

- **CI-67:** A **flaky test** is defined as a test that produces a different result (pass/fail) across 3 or more pipeline runs on the same commit SHA or with no code change in the affected test file. Flaky tests MUST be detected automatically by the CI system and MUST generate a P1 ticket assigned to the team that owns the test. Flaky tests that are not resolved within 5 business days MUST be quarantined (skipped with a quarantine annotation) to prevent false gate failures — they MUST NOT be permanently deleted.

- **CI-68:** Pipeline logs MUST be retained for a minimum of **90 days**. For release pipeline runs (builds that produce a `v*` tag), logs MUST be retained for **1 year**. Log retention applies to: full stage output, environment variable names (never values), artifact metadata, and approval events.

- **CI-69:** Every deployment event MUST produce a structured audit log entry containing: artifact version, target environment, deploying actor (human or service account), approval actor(s), pipeline run ID, timestamp, and outcome. Audit logs are immutable and retained for 3 years.

- **CI-70:** Build failure rate exceeding **20% in a 24-hour rolling window** for any single service MUST trigger an automatic alert to the Engineering Lead with a summary of the most common failure reasons. The alert MUST be routed to the team's primary incident channel, not only email.

- **CI-71:** Mean Time to Recovery (MTTR) for a broken pipeline MUST be measured and tracked. The organizational target is **< 30 minutes** from first failure to green build. Teams whose pipeline MTTR P95 exceeds 45 minutes in a 30-day period are required to submit a pipeline health improvement plan.

- **CI-72:** A pipeline health dashboard MUST be maintained per team, accessible to all engineering staff. The dashboard MUST show, at minimum: current build status per service, 7-day trend of build success rate, top 5 failure reasons, MTTR trend, and active flaky test count. Dashboard configuration MUST be stored as code alongside the service.

---

## 8. Exemplos de Configuração (CI-73 a CI-80)

- **CI-73:** The following sections provide canonical reference configurations. Teams MUST adapt these to their specific stack while preserving all mandatory stages and gates. Removal of any mandatory stage from the reference configuration requires an ADR.

### CI-74 — GitHub Actions: Full CI Pipeline (Reference)

```yaml
# .github/workflows/ci.yml
# Canonical CI pipeline — adapt per stack, preserve all mandatory stages.
name: CI

on:
  pull_request:
    branches: [main, master, develop]
  push:
    branches: [main, master, develop, "release/**"]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ── Stage 1: Checkout & Setup ────────────────────────────────────────────
  setup:
    name: "Stage 1 — Checkout & Setup"
    runs-on: ubuntu-latest
    outputs:
      cache-hit: ${{ steps.cache.outputs.cache-hit }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Restore dependency cache
        id: cache
        uses: actions/cache@v4
        with:
          # Adjust path and key per stack:
          # Node.js: node_modules, key on package-lock.json
          # .NET:    ~/.nuget/packages, key on *.csproj files
          # Java:    ~/.m2 or ~/.gradle, key on pom.xml / build.gradle
          path: |
            ~/.nuget/packages
            node_modules
          key: deps-${{ runner.os }}-${{ hashFiles('**/package-lock.json', '**/*.csproj') }}
          restore-keys: deps-${{ runner.os }}-

  # ── Stage 2: Secret Scanning ─────────────────────────────────────────────
  secret-scan:
    name: "Stage 2 — Secret Scanning"
    runs-on: ubuntu-latest
    needs: setup
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Run gitleaks
        uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        # Fail immediately on any finding — no suppression without approved baseline

  # ── Stage 3: SAST ────────────────────────────────────────────────────────
  sast:
    name: "Stage 3 — SAST"
    runs-on: ubuntu-latest
    needs: secret-scan
    steps:
      - uses: actions/checkout@v4

      - name: Run SAST (SonarCloud)
        uses: SonarSource/sonarcloud-github-action@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        # sonar-project.properties controls thresholds — see CI-61
        # Fails on CRITICAL/HIGH findings not in approved baseline

  # ── Stage 4: Build ───────────────────────────────────────────────────────
  build:
    name: "Stage 4 — Build"
    runs-on: ubuntu-latest
    needs: sast
    steps:
      - uses: actions/checkout@v4

      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: ~/.nuget/packages
          key: deps-${{ runner.os }}-${{ hashFiles('**/*.csproj') }}

      - name: Build
        run: dotnet build --configuration Release --no-restore

      - name: Upload build artifacts
        uses: actions/upload-artifact@v4
        with:
          name: build-output
          path: ./artifacts/
          retention-days: 7

  # ── Stage 5: Unit Tests ──────────────────────────────────────────────────
  unit-tests:
    name: "Stage 5 — Unit Tests"
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4

      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: ~/.nuget/packages
          key: deps-${{ runner.os }}-${{ hashFiles('**/*.csproj') }}

      - name: Run unit tests with coverage
        run: |
          dotnet test \
            --configuration Release \
            --no-build \
            --collect:"XPlat Code Coverage" \
            --results-directory ./coverage \
            --logger "junit;LogFilePath=./coverage/test-results.xml"

      - name: Upload coverage report
        uses: actions/upload-artifact@v4
        with:
          name: coverage-report
          path: ./coverage/
          retention-days: 30

  # ── Stage 6: Integration Tests ───────────────────────────────────────────
  integration-tests:
    name: "Stage 6 — Integration Tests"
    runs-on: ubuntu-latest
    needs: unit-tests
    steps:
      - uses: actions/checkout@v4

      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: ~/.nuget/packages
          key: deps-${{ runner.os }}-${{ hashFiles('**/*.csproj') }}

      - name: Run integration tests (Testcontainers)
        run: |
          dotnet test \
            --configuration Release \
            --filter Category=Integration \
            --logger "junit;LogFilePath=./test-results/integration.xml"
        env:
          DOTNET_ENVIRONMENT: Testing
          # Testcontainers spins up real containers — no shared infra needed

      - name: Upload integration test results
        uses: actions/upload-artifact@v4
        with:
          name: integration-test-results
          path: ./test-results/
          retention-days: 30

  # ── Stage 7: Dependency Scanning ─────────────────────────────────────────
  dependency-scan:
    name: "Stage 7 — Dependency Scanning"
    runs-on: ubuntu-latest
    needs: integration-tests
    steps:
      - uses: actions/checkout@v4

      - name: Run Trivy dependency scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: fs
          scan-ref: .
          exit-code: 1
          severity: CRITICAL,HIGH
          format: sarif
          output: trivy-dep-results.sarif

      - name: Upload Trivy results to GitHub Security
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-dep-results.sarif

  # ── Stage 8: Code Quality Gate ───────────────────────────────────────────
  quality-gate:
    name: "Stage 8 — Code Quality Gate"
    runs-on: ubuntu-latest
    needs: dependency-scan
    steps:
      - uses: actions/checkout@v4

      - name: Download coverage report
        uses: actions/download-artifact@v4
        with:
          name: coverage-report
          path: ./coverage/

      - name: Enforce coverage thresholds
        run: |
          # Stack-specific coverage enforcement — adjust per language/tool
          # This example uses dotnet-coverage threshold enforcement
          dotnet tool run dotnet-reportgenerator-globaltool \
            -reports:"./coverage/**/coverage.cobertura.xml" \
            -targetdir:"./coverage/report" \
            -reporttypes:JsonSummary
          # Threshold validation script — fails with non-zero exit on breach
          python3 scripts/check-coverage-thresholds.py \
            --domain 90 \
            --application 80 \
            --infrastructure 60 \
            --report ./coverage/report/Summary.json

  # ── Stage 9: Container Build ─────────────────────────────────────────────
  container-build:
    name: "Stage 9 — Container Build"
    runs-on: ubuntu-latest
    needs: quality-gate
    outputs:
      image-digest: ${{ steps.build.outputs.digest }}
      image-tag: ${{ steps.meta.outputs.tags }}
    steps:
      - uses: actions/checkout@v4

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=semver,pattern={{version}}
            type=sha,prefix=sha-,format=short

      - name: Build image (no push yet)
        id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          outputs: type=docker,dest=/tmp/image.tar

      - name: Upload image artifact
        uses: actions/upload-artifact@v4
        with:
          name: container-image
          path: /tmp/image.tar
          retention-days: 1

  # ── Stage 10: Container Scan ─────────────────────────────────────────────
  container-scan:
    name: "Stage 10 — Container Scan"
    runs-on: ubuntu-latest
    needs: container-build
    steps:
      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: container-image
          path: /tmp/

      - name: Load image
        run: docker load --input /tmp/image.tar

      - name: Run Trivy container scan
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: image
          image-ref: ${{ needs.container-build.outputs.image-tag }}
          exit-code: 1
          severity: CRITICAL,HIGH
          format: sarif
          output: trivy-image-results.sarif

      - name: Upload container scan results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: trivy-image-results.sarif

  # ── Stage 11: SBOM Generation (release branches only) ────────────────────
  sbom:
    name: "Stage 11 — SBOM Generation"
    runs-on: ubuntu-latest
    needs: container-scan
    if: startsWith(github.ref, 'refs/heads/release/') || github.ref == 'refs/heads/main' || github.ref == 'refs/heads/master'
    steps:
      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: container-image
          path: /tmp/

      - name: Load image
        run: docker load --input /tmp/image.tar

      - name: Generate SBOM with Syft
        uses: anchore/sbom-action@v0
        with:
          image: ${{ needs.container-build.outputs.image-tag }}
          format: cyclonedx-json
          output-file: sbom.cyclonedx.json
          artifact-name: sbom-${{ github.sha }}.cyclonedx.json

  # ── Stage 12: Artifact Publish ───────────────────────────────────────────
  publish:
    name: "Stage 12 — Artifact Publish"
    runs-on: ubuntu-latest
    needs: [sbom, container-scan]  # sbom is conditional, container-scan is always required
    if: always() && needs.container-scan.result == 'success'
    steps:
      - uses: actions/checkout@v4

      - name: Log in to registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Download image artifact
        uses: actions/download-artifact@v4
        with:
          name: container-image
          path: /tmp/

      - name: Load and push image
        run: |
          docker load --input /tmp/image.tar
          # Push all tags — never :latest in staging/production
          docker push --all-tags ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}

      - name: Sign image with Cosign
        uses: sigstore/cosign-installer@v3
        with:
          cosign-release: v2.2.0

      - name: Sign and attest (SLSA provenance)
        run: |
          cosign sign --yes \
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}@${{ needs.container-build.outputs.image-digest }}
```

### CI-75 — GitHub Actions: CD Deploy with Gates (Reference)

```yaml
# .github/workflows/cd.yml
# Canonical CD pipeline — deploy-freeze aware, with smoke tests and auto-rollback.
name: CD

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main, master, develop]

jobs:
  check-deploy-freeze:
    name: "Check Deploy Freeze"
    runs-on: ubuntu-latest
    if: ${{ github.event.workflow_run.conclusion == 'success' }}
    outputs:
      frozen: ${{ steps.freeze.outputs.frozen }}
    steps:
      - uses: actions/checkout@v4

      - name: Check .deploy-freeze
        id: freeze
        run: |
          python3 scripts/check-deploy-freeze.py \
            --freeze-file .deploy-freeze \
            --output-var frozen

  deploy-dev:
    name: "Deploy — dev"
    runs-on: ubuntu-latest
    needs: check-deploy-freeze
    environment: dev
    steps:
      - uses: actions/checkout@v4
      - name: Deploy to dev
        run: scripts/deploy.sh dev ${{ github.sha }}
      - name: Run smoke tests
        run: scripts/smoke-tests.sh dev
        # Failure triggers automatic rollback via deploy.sh health-check hook

  deploy-staging:
    name: "Deploy — staging (manual approval)"
    runs-on: ubuntu-latest
    needs: deploy-dev
    environment:
      name: staging
      # GitHub environment protection rule requires manual approval
    steps:
      - uses: actions/checkout@v4
      - name: Verify freeze before staging deploy
        run: |
          if [ "${{ needs.check-deploy-freeze.outputs.frozen }}" = "true" ]; then
            echo "Deploy freeze is active. Aborting staging deployment."
            exit 1
          fi
      - name: Deploy to staging
        run: scripts/deploy.sh staging ${{ github.sha }}
      - name: Run smoke tests
        run: scripts/smoke-tests.sh staging

  deploy-production:
    name: "Deploy — production (manual approval + Engineering Lead)"
    runs-on: ubuntu-latest
    needs: deploy-staging
    environment:
      name: production
      # GitHub environment requires 1 Engineering Lead review
    steps:
      - uses: actions/checkout@v4
      - name: Verify freeze before production deploy
        run: |
          if [ "${{ needs.check-deploy-freeze.outputs.frozen }}" = "true" ]; then
            echo "Deploy freeze is active. Aborting production deployment."
            exit 1
          fi
      - name: Deploy to production (zero-downtime rolling)
        run: scripts/deploy.sh production ${{ github.sha }} --strategy rolling
      - name: Post-deploy health check (5-minute window)
        run: scripts/health-check.sh production --timeout 300 --auto-rollback
      - name: Run smoke tests
        run: scripts/smoke-tests.sh production
```

### CI-76 — Azure DevOps: Equivalent Pipeline (Reference)

```yaml
# azure-pipelines.yml
# Canonical CI pipeline for Azure DevOps — mirrors GitHub Actions stage sequence.
trigger:
  branches:
    include:
      - main
      - develop
      - release/*

pool:
  vmImage: ubuntu-latest

variables:
  REGISTRY: $(containerRegistry)
  IMAGE_TAG: $(Build.Repository.Name):$(Build.BuildNumber)

stages:
  - stage: SecurityAndBuild
    displayName: "Stages 1–4: Security & Build"
    jobs:
      - job: SecretScan
        displayName: "Stage 2 — Secret Scanning"
        steps:
          - checkout: self
            fetchDepth: 0
          - script: |
              docker run --rm -v $(Build.SourcesDirectory):/path \
                zricethezav/gitleaks:latest detect \
                --source /path \
                --baseline-path .security/gitleaks-baseline.json \
                --exit-code 1
            displayName: "Run gitleaks"

      - job: SAST
        displayName: "Stage 3 — SAST (SonarQube)"
        dependsOn: SecretScan
        steps:
          - task: SonarQubePrepare@6
            inputs:
              SonarQube: sonarqube-service-connection
              scannerMode: MSBuild
              projectKey: $(SONAR_PROJECT_KEY)
          - task: DotNetCoreCLI@2
            inputs:
              command: build
          - task: SonarQubeAnalyze@6
          - task: SonarQubePublish@6
            inputs:
              pollingTimeoutSec: 300

      - job: Build
        displayName: "Stage 4 — Build"
        dependsOn: SAST
        steps:
          - task: Cache@2
            inputs:
              key: nuget | $(Agent.OS) | **/*.csproj
              path: $(NUGET_PACKAGES)
          - task: DotNetCoreCLI@2
            inputs:
              command: build
              arguments: --configuration Release
          - publish: $(Build.ArtifactStagingDirectory)
            artifact: build-output

  - stage: Test
    displayName: "Stages 5–8: Test & Quality"
    dependsOn: SecurityAndBuild
    jobs:
      - job: UnitTests
        displayName: "Stage 5 — Unit Tests"
        steps:
          - task: DotNetCoreCLI@2
            inputs:
              command: test
              arguments: >
                --configuration Release
                --collect:"XPlat Code Coverage"
                --results-directory $(Agent.TempDirectory)/coverage
          - task: PublishCodeCoverageResults@2
            inputs:
              summaryFileLocation: $(Agent.TempDirectory)/coverage/**/coverage.cobertura.xml

      - job: IntegrationTests
        displayName: "Stage 6 — Integration Tests"
        dependsOn: UnitTests
        steps:
          - task: DotNetCoreCLI@2
            inputs:
              command: test
              arguments: --filter Category=Integration

      - job: DependencyScan
        displayName: "Stage 7 — Dependency Scanning"
        dependsOn: IntegrationTests
        steps:
          - task: trivy@1
            inputs:
              version: latest
              type: fs
              path: $(Build.SourcesDirectory)
              exitCode: 1
              severity: CRITICAL,HIGH

      - job: QualityGate
        displayName: "Stage 8 — Quality Gate"
        dependsOn: DependencyScan
        steps:
          - script: |
              python3 scripts/check-coverage-thresholds.py \
                --domain 90 --application 80 --infrastructure 60
            displayName: "Enforce coverage thresholds"

  - stage: ContainerAndPublish
    displayName: "Stages 9–12: Container & Publish"
    dependsOn: Test
    jobs:
      - job: ContainerBuildScanPublish
        displayName: "Stages 9–12 — Container Build, Scan, SBOM, Publish"
        steps:
          - task: Docker@2
            displayName: "Stage 9 — Build image"
            inputs:
              command: build
              repository: $(IMAGE_TAG)
              tags: $(Build.BuildNumber)

          - script: |
              trivy image --exit-code 1 --severity CRITICAL,HIGH $(IMAGE_TAG):$(Build.BuildNumber)
            displayName: "Stage 10 — Container scan"

          - script: |
              syft $(IMAGE_TAG):$(Build.BuildNumber) -o cyclonedx-json > sbom.cyclonedx.json
            displayName: "Stage 11 — Generate SBOM"
            condition: and(succeeded(), or(eq(variables['Build.SourceBranch'], 'refs/heads/main'), startsWith(variables['Build.SourceBranch'], 'refs/heads/release/')))

          - task: Docker@2
            displayName: "Stage 12 — Push image"
            inputs:
              command: push
              repository: $(IMAGE_TAG)
              tags: $(Build.BuildNumber)
```

### CI-77 — Deploy Freeze Configuration (`.deploy-freeze`)

```yaml
# .deploy-freeze
# Defines additional deployment freeze windows beyond the defaults.
# Default rules (always active, no configuration needed):
#   - Fridays after 14:00 local team timezone
#   - Eve of public holidays
#
# Format: ISO 8601 date-times in UTC. Reason is mandatory.

version: 1
timezone: America/Sao_Paulo

freeze_windows:
  - start: "2026-12-23T00:00:00"
    end:   "2026-12-27T23:59:59"
    reason: "Year-end holiday freeze"
    override_requires: CTO

  - start: "2026-06-12T18:00:00"
    end:   "2026-06-13T23:59:59"
    reason: "Major infrastructure migration — all deploys paused"
    override_requires: Engineering Lead

# Emergency override policy:
#   - Hotfix deploys may be approved by Engineering Lead (CI-38)
#   - All other deploys require CTO approval if override_requires is CTO
#   - All overrides are logged automatically by the deploy pipeline
```

### CI-78 — Smoke Test Script Reference

```bash
#!/usr/bin/env bash
# scripts/smoke-tests.sh
# Usage: smoke-tests.sh <environment>
# Exits 0 on success, 1 on any failure (triggers rollback in deploy pipeline).

set -euo pipefail

ENVIRONMENT="${1:?Usage: smoke-tests.sh <dev|staging|production>}"
TIMEOUT=10  # seconds per request

# Resolve base URL from environment — never hardcoded
case "$ENVIRONMENT" in
  dev)        BASE_URL="${SMOKE_URL_DEV:?SMOKE_URL_DEV not set}" ;;
  staging)    BASE_URL="${SMOKE_URL_STAGING:?SMOKE_URL_STAGING not set}" ;;
  production) BASE_URL="${SMOKE_URL_PROD:?SMOKE_URL_PROD not set}" ;;
  *) echo "Unknown environment: $ENVIRONMENT"; exit 1 ;;
esac

FAILURES=0

check_endpoint() {
  local name="$1"
  local path="$2"
  local expected_status="${3:-200}"

  echo -n "Checking $name ($BASE_URL$path) ... "
  actual_status=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time "$TIMEOUT" \
    "$BASE_URL$path")

  if [ "$actual_status" -eq "$expected_status" ]; then
    echo "OK ($actual_status)"
  else
    echo "FAIL (expected $expected_status, got $actual_status)"
    FAILURES=$((FAILURES + 1))
  fi
}

echo "=== Smoke Tests: $ENVIRONMENT ==="

# CI-33: minimum 3 critical endpoints
check_endpoint "Health readiness"  "/health/ready"      200
check_endpoint "Health liveness"   "/health/live"       200
check_endpoint "API version"       "/api/version"       200

# Stack-specific critical business endpoints — add per service:
# check_endpoint "Orders endpoint"   "/api/v1/orders"     200
# check_endpoint "Auth endpoint"     "/api/v1/auth/token" 401

echo "==================================="
if [ "$FAILURES" -gt 0 ]; then
  echo "SMOKE TESTS FAILED: $FAILURES endpoint(s) unhealthy — rollback triggered"
  exit 1
fi
echo "All smoke tests passed."
exit 0
```

### CI-79 — Coverage Threshold Check Script Reference

```python
#!/usr/bin/env python3
# scripts/check-coverage-thresholds.py
# Enforces per-layer coverage thresholds from CI-59.
# Exits 0 on pass, 1 on any threshold breach (blocks merge in CI).

import argparse
import json
import sys

def parse_args():
    parser = argparse.ArgumentParser(description="Enforce per-layer coverage thresholds")
    parser.add_argument("--domain",         type=float, required=True, help="Domain layer threshold %%")
    parser.add_argument("--application",    type=float, required=True, help="Application layer threshold %%")
    parser.add_argument("--infrastructure", type=float, required=True, help="Infrastructure layer threshold %%")
    parser.add_argument("--report",         type=str,   required=True, help="Path to coverage JSON summary")
    return parser.parse_args()

def load_coverage(report_path):
    with open(report_path) as f:
        return json.load(f)

def extract_layer_coverage(coverage_data, layer_keyword):
    # Adapt extraction logic per tool output format (Cobertura, lcov, etc.)
    assemblies = coverage_data.get("assemblies", [])
    total_lines = total_covered = 0
    for asm in assemblies:
        if layer_keyword.lower() in asm.get("name", "").lower():
            total_lines   += asm.get("coveredlines", 0) + asm.get("coverablelines", 0)
            total_covered += asm.get("coveredlines", 0)
    if total_lines == 0:
        return None  # Layer not found — treat as not applicable
    return round((total_covered / total_lines) * 100, 2)

def main():
    args = parse_args()
    coverage = load_coverage(args.report)

    thresholds = {
        "Domain":         args.domain,
        "Application":    args.application,
        "Infrastructure": args.infrastructure,
    }

    failures = []
    for layer, threshold in thresholds.items():
        actual = extract_layer_coverage(coverage, layer)
        if actual is None:
            print(f"  {layer}: not found in report (skipped)")
            continue
        status = "PASS" if actual >= threshold else "FAIL"
        print(f"  {layer}: {actual:.1f}% (threshold: {threshold:.0f}%) — {status}")
        if actual < threshold:
            failures.append(f"{layer} coverage {actual:.1f}% < required {threshold:.0f}%")

    if failures:
        print("\nCoverage threshold breaches (blocking merge):")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)

    print("\nAll coverage thresholds met.")
    sys.exit(0)

if __name__ == "__main__":
    main()
```

### CI-80 — sonar-project.properties Reference (Quality Gate as Code)

```properties
# sonar-project.properties
# Stored in repository root — controls all quality gate thresholds.
# Modifications via SonarQube UI are overwritten on next push (CI-61).

sonar.projectKey=your-org_your-service
sonar.projectName=your-service
sonar.host.url=https://sonarcloud.io
sonar.organization=your-org

# Source encoding
sonar.sourceEncoding=UTF-8

# Test and coverage configuration
sonar.cs.opencover.reportsPaths=**/coverage/*.opencover.xml
sonar.cs.vstest.reportsPaths=**/TestResults/*.trx

# Exclusions — infrastructure glue only, never business logic
sonar.exclusions=**/Migrations/**,**/obj/**,**/bin/**

# Quality gate thresholds (enforced by CI-59)
# Override requires ADR — changing these values locally bypasses the standard
sonar.qualitygate.wait=true

# Coverage minimum (domain layer — enforced via CI check-coverage-thresholds.py)
# SonarQube overall coverage gate serves as a secondary backstop
sonar.coverage.exclusions=**/*Infrastructure*/**,**/*Migration*/**

# Duplication threshold: 5% max (CI-59)
# Cyclomatic complexity max per method: 15 (CI-59)
# These are enforced via the quality gate profile configured in SonarCloud/SonarQube
# Profile name: "Enterprise Standard Gate" — do not use the default "Sonar way" profile
```

---

## Compliance Summary

| ID Range | Section | Enforcement |
|---|---|---|
| CI-01 – CI-15 | Pipeline Stages | Automated — pipeline fails |
| CI-16 – CI-25 | Branch Strategy | Automated — branch protection + CI validation |
| CI-26 – CI-40 | CD Deployment | Automated + manual approval gates |
| CI-41 – CI-50 | Environment Config | Automated (secret scan) + IaC drift checks |
| CI-51 – CI-58 | Artifact Management | Automated — registry policy + pipeline gates |
| CI-59 – CI-65 | Quality Gates | Automated — blocks merge/build |
| CI-66 – CI-72 | Pipeline Observability | Automated — monitoring + alerting |
| CI-73 – CI-80 | Reference Configurations | Normative examples — teams adapt |

**Non-compliance that cannot be immediately remediated MUST be tracked as a finding in the engineering backlog with: severity classification, owner, remediation plan, and due date not exceeding 30 days for HIGH findings and 7 days for CRITICAL findings.**
