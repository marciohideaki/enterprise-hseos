# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
