# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
