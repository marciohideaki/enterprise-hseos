# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] — 2026-08-28

### Breaking changes

- Session state and the central kanban registry now default to project-scoped
  paths. Existing machine-scoped data is not read implicitly; use explicit
  paths during migration and follow
  [`docs/MIGRATION-GUIDE-v2-to-v3.md`](docs/MIGRATION-GUIDE-v2-to-v3.md).
- State UI side-cars bind only to loopback. Remote access now requires a TLS
  reverse proxy; bearer-authenticated cleartext non-loopback HTTP is rejected.
- The canonical workflow registry is schema v2 and the canonical capability
  catalog includes the surface lifecycle contract. Bounded v1 workflow and
  compiled-only capability inputs remain readable and are upgraded by the
  compiler.
- The active SessionStart hook identifier now describes the project store. The
  former identifier remains in the registry as a deprecated, non-emitted alias.

### Security

- Side-car health checks no longer transmit bearer credentials.
- Side-car stop operations verify an owner-bound process record, entrypoint,
  instance identifier, and health marker instead of terminating every listener
  on a port.

### Fixed

- Restored case-insensitive workflow discovery by profile, owner, and partial
  workflow identifier.
- Restored true compiled-only capability compatibility when `surfaces.yaml` is
  absent and made compiler synchronization materialize the conservative
  lifecycle contract.

### Added

- N1 pilot loop executed to stop condition (2026-07-24, PR #121): 8/8 budget, 2 genuine REPROVADO verdicts, deliberate rollback test, zero anchors touched, deterministic verifier 4/4 PASS at close. Heartbeat versioned at `.hseos/loops/pilot-n1/`.
- `docs/RUNNING-GOVERNED-LOOPS.md` — proven end-to-end flow for running a governed loop (worktree → loop-guard → iterate/verify → commit/tag → PR → merge → hygiene).
- `docs/LOOP-GRAPHS-MANUAL.md` — full usage manual for loop graphs: mental model, component map, route selection (compiled workflow / governed loop / dev-squad), state versioning and resume, verification protocol, cost rules, authority gates, troubleshooting, worked example.
- Skill `goal-graph` v1.1 (gap-map phase, `workflow.js` compilation) plus a standalone skill verifier.
- Loop-side autonomy guardrails for N1 loop graphs.
- Production goal loop skill.

### Changed

- Recompiled the Tier 2 agent-core bundle (goal-graph 1.1, verifier, hseos-goal-loop).
- Mapped `goal-graph` and the verifier under `capability:delivery`.
- `verify-doc-facts.sh` now checks every doc-claim occurrence, not just the first.

### Fixed

- README skills count corrected to 52.
- README agents count corrected to 15.
