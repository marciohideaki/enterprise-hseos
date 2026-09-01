# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Proposed `capability-reuse` policy and ADR-0034: complementary core-first enforcement that retains the Capability Graph as the sole discovery and ownership authority.

## [3.3.1] — 2026-09-01

### Breaking Changes

- None. The managed-governance session preflight remains advisory, opt-in and
  backward compatible. ([PR #142](https://github.com/marciohideaki/enterprise-hseos/pull/142))

### Fixed

- The session-start hook now verifies that an in-repository source CLI can
  start before selecting it, allowing a verified global HSEOS installation to
  handle preflight when a clean source checkout has no installed dependencies.
  ([PR #142](https://github.com/marciohideaki/enterprise-hseos/pull/142))

## [3.3.0] — 2026-09-01

### Breaking Changes

- None. Existing CLI commands, HTTP routes, MCP tools and portable Markdown
  governance remain compatible and authoritative. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Added

- `hseos governance session preflight` now compares repository identity and the
  normalized local Constitution digest with the active managed-shadow catalog,
  returning a strict non-blocking result and private project-local evidence.
  ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))
- The governance MCP exposes the additive read-only
  `get_governance_session_preflight` tool, while supported adapters receive a
  non-blocking `SessionStart` hook and other adapters receive an explicit CLI
  fallback. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Changed

- Effective-context provenance now reports the source commit of the active
  catalog batch instead of the sidecar checkout commit, preserving accurate
  drift evidence. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Security

- Constitution reads reject links, unstable files, oversized content and
  invalid UTF-8; evidence publication rejects linked runtime ancestors and uses
  private atomic replacement. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Documentation

- English and Portuguese managed-governance guides now document session
  reconciliation states, evidence, hook behavior, MCP usage and the manual
  fallback lifecycle. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

## [3.2.2] — 2026-09-01

### Breaking Changes

- None. Existing project-owned governance sources are preserved and managed
  governance remains optional, loopback-only and shadow-only. ([PR #140](https://github.com/marciohideaki/enterprise-hseos/pull/140))

### Fixed

- Fresh installations now materialize the portable `.hseos/workflows` source
  registry required by the managed-governance importer, allowing the documented
  install-to-setup flow to complete without package-repository assumptions.
  ([PR #140](https://github.com/marciohideaki/enterprise-hseos/pull/140))

### Documentation

- The installation guide now makes repository identity an explicit project-owned
  prerequisite and forbids inheriting the package repository's identity.
  ([PR #140](https://github.com/marciohideaki/enterprise-hseos/pull/140))

## [3.2.1] — 2026-09-01

### Breaking Changes

- None. The patch preserves all managed-shadow contracts and keeps repository
  governance authoritative. ([PR #139](https://github.com/marciohideaki/enterprise-hseos/pull/139))

### Fixed

- Managed-governance setup now derives default idempotency keys from the exact
  actor-bound seed/import command, allowing a different authorized operator to
  repeat setup without colliding with a prior valid receipt while preserving
  strict conflicting-reuse rejection. ([PR #139](https://github.com/marciohideaki/enterprise-hseos/pull/139))

## [3.2.0] — 2026-09-01

### Breaking Changes

- None. Repository governance remains authoritative, the managed integration
  remains opt-in, and `managed-enforced` remains unavailable. ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

### Added

- Deployment-agnostic managed-shadow setup now performs PostgreSQL migrations,
  deterministic governance seed, role binding and secret-free project binding
  generation. ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))
- The optional loopback control plane can now serve the PostgreSQL-backed health,
  catalog, audit and console surfaces from the same strict configuration contract.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))
- English and Portuguese runbooks now cover package installation, PostgreSQL
  provisioning, conditional `sudo` use, idempotent setup and live validation.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

### Changed

- PostgreSQL support is packaged as an optional runtime dependency and remains
  inactive unless the managed-governance client is explicitly selected.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

### Security

- Runtime credentials are resolved only from named environment variables;
  generated project files are private and contain no resolved secret values.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

## [3.1.1] — 2026-09-01

### Breaking Changes

- None.

### Fixed

- SQLite startup now configures bounded lock waiting before connection pragmas
  or schema reads, preventing concurrent project-state initialization from
  failing intermittently with `SQLITE_BUSY`.
- Release installation examples now select the published patch artifact.

## [3.1.0] — 2026-09-01

### Breaking Changes

- None. Portable repository governance remains authoritative and no built-in
  profile activates managed governance. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Added

- Optional managed-governance contracts, deterministic import, PostgreSQL
  migrations, seed/sync, policy resolution, shadow client and verified local
  snapshots. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))
- Loopback-only control-plane shell with versioned HTTP and CLI surfaces,
  schema-driven console and read-only MCP queries. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))
- Conformance, security and performance suites covering tenant isolation,
  replay protection, input bounds, parity and unavailable enforcement.
  ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Changed

- Installation documentation now uses checksum-verified GitHub release assets
  instead of an unavailable npm package. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Fixed

- `install-plan` now resolves the catalog shipped with the CLI when invoked
  from an empty consumer repository. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))
- Selecting the managed-governance client no longer asks the module installer
  to locate nonexistent module sources. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Security

- `managed-enforced` remains a reserved value that returns
  `enforcement_unavailable` without network, cache or mutation effects.
  ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

## [3.0.3] — 2026-08-31

### Breaking Changes

- None.

### Fixed

- Adapter launcher cleanup now preserves every compiler-owned skill declared in
  the portable manifest, preventing selected-adapter installs from reporting a
  missing governed skill. ([PR #135](https://github.com/marciohideaki/enterprise-hseos/pull/135))
- Cleanup fails safely when an existing manifest cannot establish skill
  ownership. ([PR #135](https://github.com/marciohideaki/enterprise-hseos/pull/135))

## [3.0.2] — 2026-08-31

### Breaking Changes

- None.

### Fixed

- Fresh headless installs now create the project configuration before writing
  state and optional feature sections. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))
- `install-plan --json` now emits undecorated machine-readable JSON for plans,
  catalogs, skills, profiles, and adapters. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))
- Consumer compilation now materializes the portable adapter catalog, and
  `doctor` validates exactly the adapters selected in the manifest. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))
- Uninstall help and summaries now state that managed runtime data is removed
  while portable project governance is preserved. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))

## [3.0.1] — 2026-08-31

### Fixed

- Release checksums now contain asset-relative filenames and verify directly after a standard GitHub release download.
- Release notes are selected from the pushed version tag instead of a hard-coded version path.
- The state UI answers the browser favicon request without authentication or a console-visible 404.

## [3.0.0] — 2026-08-31

### Breaking Changes

- ⚠ Session state and the central kanban registry now default to project-scoped
  paths. Existing machine-scoped data is not read implicitly; use explicit
  paths during migration and follow
  [`docs/MIGRATION-GUIDE-v2-to-v3.md`](docs/MIGRATION-GUIDE-v2-to-v3.md). ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- ⚠ State UI side-cars bind only to loopback. Remote access now requires a TLS
  reverse proxy; bearer-authenticated cleartext non-loopback HTTP is rejected. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- ⚠ The canonical workflow registry is schema v2 and the canonical capability
  catalog includes the surface lifecycle contract. Bounded v1 workflow and
  compiled-only capability inputs remain readable and are upgraded by the
  compiler. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- ⚠ The active SessionStart hook identifier now describes the project store. The
  former identifier remains in the registry as a deprecated, non-emitted alias. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))

### Security

- Side-car health checks no longer transmit bearer credentials. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- Side-car stop operations verify an owner-bound process record, entrypoint,
  instance identifier, and health marker instead of terminating every listener
  on a port. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))

### Fixed

- Restored case-insensitive workflow discovery by profile, owner, and partial
  workflow identifier. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- Restored true compiled-only capability compatibility when `surfaces.yaml` is
  absent and made compiler synchronization materialize the conservative
  lifecycle contract. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))

### Added

- N1 pilot loop executed to stop condition: 8/8 budget, two genuine rejected verdicts, deliberate rollback test, zero anchors touched, and deterministic verifier 4/4 PASS. ([PR #121](https://github.com/marciohideaki/enterprise-hseos/pull/121))
- Governed loop manuals, `goal-graph` v1.1, a standalone verifier, autonomy guardrails, and the production goal loop skill. ([PR #122](https://github.com/marciohideaki/enterprise-hseos/pull/122))
- Versioned repository identity contract with UUID and canonical-remote validation. ([PR #130](https://github.com/marciohideaki/enterprise-hseos/pull/130))
- Owner-approved downstream consumer registry source for the G9 observation release. ([PR #131](https://github.com/marciohideaki/enterprise-hseos/pull/131))

### Changed

- Recompiled the Tier 2 agent-core bundle, mapped delivery capabilities, and hardened documentation fact verification. ([PR #122](https://github.com/marciohideaki/enterprise-hseos/pull/122))

### Fixed

- README skill and agent counts corrected. ([PR #122](https://github.com/marciohideaki/enterprise-hseos/pull/122))
