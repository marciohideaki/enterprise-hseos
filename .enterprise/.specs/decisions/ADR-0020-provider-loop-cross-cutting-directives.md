# ADR-0020 — Cross-cutting directives from the provider-gateway loop (agnostic CI/CD · external-provider live validation · real-write authorization discipline)

**Status:** Proposed
**Date:** 2026-07-18
**Authors:** Platform Architecture (proposed by agent from the cambio-real provider-gateway loop; **human decision required — Constitution §5.1, §13, Law 7. Do NOT mark Accepted without Engineering Leadership review.**)
**Affects Standards:** CI/CD Pipeline Standard, Advanced Testing Strategy Standard (extends AT-32/AT-56), Security & Identity Standard
**Supersedes:** N/A · **Superseded By:** N/A

---

## Context

The cambio-real provider-gateway loop delivered 10+ external-provider integrations (`bexs bs2 cybrid
dlocal ouribank payliance plaid ripple sumsub travelex`) as `SDK + gateway` pairs. ADR-0018 already
codified the **repo topology** for these; a normative audit
(`cambioreal/provider-protocol/docs/AUDIT-NORMATIVE-provider-gateways.md`) codified their operational
conformance and confronted it with this Constitution (see `provider-protocol/docs/decisions/ADR-0001`,
which found provider **non-conformance** to existing mandatory standards — LGPD, supply-chain,
observability, resilience — those are already contemplated here and need no new directive).

However, three **recurring practices** proved globally valuable across the loop and are **not yet
codified as HSEOS directives**. They are stack-agnostic and apply to any project integrating external
providers or shipping deployable services. This ADR proposes adding them so `hseos install` distributes
them to all projects.

## Decision (proposed — pending human approval)

### D1 — Pipeline logic MUST be platform-agnostic; CI config is a thin shell
- Rule (proposed **CD-9x**, CI/CD Pipeline Standard): the build/test/package/publish/deploy logic MUST
  live in a **portable, version-controlled script** (`build.sh`/`Makefile`) that depends only on the
  toolchain (compiler, `docker`/BuildKit, `git`, registry CLI) and takes all config/secrets via **env
  vars** (never hard-coded). The CI/CD config (GitHub Actions, CodeBuild buildspec, GitLab, Jenkins, a
  k8s Job) MUST be a **thin shell** that installs tooling, injects env, and calls the script.
- Rationale: a pipeline whose logic is inlined into a vendor's YAML (`docker/build-push-action`,
  `peter-evans/create-pull-request`, `github.*` context) is locked to that vendor — porting to
  CodeBuild/k8s/local means rewriting the logic, not the shell. Extracting the logic makes the **same**
  commands run local, in GHA, in AWS CodeBuild, and in a k3s Job — proven on `cambioreal/sumsub-gateway`
  (`build.sh` + GHA casca + `buildspec.yml`, all green). Registry/auth stay agnostic (GHCR-PAT vs
  ECR-IAM is just env). This does **not** weaken existing CI/CD gates — it relocates them.

### D2 — External-provider adapters MUST be validated LIVE, endpoint-by-endpoint (contract is necessary, not sufficient)
- Rule (proposed **AT-7x**, Advanced Testing Strategy Standard; extends AT-32 "contract testing is not
  a substitute for integration tests" and AT-56 chaos-for-external-providers): for any adapter/gateway
  wrapping an **external provider API**, contract/unit tests (which prove OUR serialization) are
  necessary but **insufficient**. Each endpoint MUST also be validated **live against the provider's
  sandbox**, endpoint-by-endpoint, before it is declared "covered". Coverage matrices MUST mark honestly
  live-validated (✅) vs contract-only (🟡) vs never-exercised (🔒).
- Rationale: mocked contract tests pass 100% green while the real provider **rejects** the shape — the
  cambio-real loop found this repeatedly (SumSub: PATCH path 405, multipart-signature 401, KYB 1.0→2.0
  `types[]` 400; ripple PUT-not-PATCH; dlocal number-or-string JSON; `Environment=Sandbox` enum-mismatch
  500-on-every-endpoint-while-health-passes). These are **legacy/version shape-drifts** invisible to
  mocks. The difference is a sandbox 4xx vs a production incident. See
  `second-brain/_learnings/live-testing-catches-legacy-shape-bugs`.

### D3 — Mutating operations against REAL external/production systems require explicit per-run authorization
- Rule (proposed **SI-xx**, Security & Identity Standard; complements AT-67 synthetic-test-data): agents
  and automated suites MUST NOT exercise **state-changing operations against real external or production
  systems** — financial-write (payment/transfer), compliance-write (approve/reject applicant, submit a
  monitored transaction), or any mutating call — **without explicit, per-run authorization**. Default is
  **read-only + synthetic**. Where the ability to perform an operation must be proven without performing
  it, use **non-mutating discriminating probes** (e.g. `GET` on a POST-only route → 405 = route exists,
  403 = no permission, 404 = absent). Non-financial writes with cleanup are allowed.
- Rationale: this "§0.5 discipline" (from the goal-loop charter) prevented every accidental
  money-movement/compliance-decision across the loop while still proving live access. It is a safety
  invariant orthogonal to AT-67 (which governs test *data*, not the *act* of mutating real systems).

## Consequences

### Positive
- **D1:** pipelines portable across CI vendors / local / k8s with zero logic rewrite; removes vendor lock-in.
- **D2:** catches provider shape-drift at the sandbox, not in production; makes "coverage" mean "validated".
- **D3:** structural guard against accidental real money movement / compliance decisions by automation.

### Negative / Trade-offs
- **D1:** a small indirection (script + thin shell) vs inlining; loses some vendor-native conveniences
  (e.g. GHA layer caching around, not inside, the script).
- **D2:** requires sandbox credentials + §0.5-safe fixtures; more effort than mock-only.
- **D3:** requires an explicit authorization step for genuinely-needed real writes.

### Risks
- D2/D3 could be read as "skip contract tests" or "never test writes" — they are the opposite: contract
  tests remain mandatory; writes are tested with synthetic fixtures + cleanup, real-write only on
  explicit authorization.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| CI/CD Pipeline Standard | new rule (CD-9x) | Pipeline logic in a portable script; CI config is a thin shell |
| Advanced Testing Strategy Standard | extends AT-32, AT-56 (new AT-7x) | External-provider adapters require live endpoint-by-endpoint sandbox validation |
| Security & Identity Standard | new rule (SI-xx) | Real-system mutating ops require explicit per-run authorization; default read-only + synthetic; non-mutating probes |

## Distribution (once Accepted)
Human review → move to `Accepted` with owner + version bump (§13). Then the three standards receive the
new rules and **`hseos install`** distributes them to every project under the governance overlay. Until
then, this ADR is a Proposed draft only.
</content>
