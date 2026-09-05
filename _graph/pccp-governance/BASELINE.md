# PCCP Governance Baseline

- Captured: 2026-08-26
- Objective: normalize and harden the Platform Capability Contract Pattern (PCCP).
- Authority: user-authorized repository-local drafts, code, tests, and local package builds only.
- Hard stops: no ADR acceptance, schema activation, merge, push, publication, deployment,
  infrastructure change, product migration, or adoption claim.

## Repository baselines

- `enterprise-hseos`: `feature/capability-graph-governance` at `0982a49`;
  isolated task branch `task/pccp-governance`.
- `platform-core`: existing isolated `task/uow-contract` at `84acee7`, with uncommitted
  Unit of Work contract/intake/fragment work preserved.
- `backend-core`: existing isolated `task/abp-wave1` at `e117cda`, with uncommitted
  Wave 1 package work preserved.

## Claims

- Observed: ADR-0033 is Accepted and makes Git-owned federated fragments authoritative.
- Observed: graph schema `1.0.0` cannot express PCCP classifiers as validated fields.
- Observed: capability intake v2 does not require the full PCCP promotion dossier.
- Observed: the new-module template permits documentation with only Purpose and Contracts.
- Observed: exact canonical and migration-view lookup returned no Unit of Work capability.
- Observed: semantic discovery found adjacent Unit of Work/outbox/inbox implementations;
  those findings remain advisory.
- Inferred: requiring PCCP classifiers on every existing graph node is breaking and needs a
  new schema version plus a human activation gate.
- Unverified: any package publication, verified installation, or real product adoption for
  the Wave 1 packages.

## Verification contract

Deterministic schema, validator, negative-fixture, graph-composition, intake, package-test,
dependency, documentation, diff, and local-pack checks must pass. Missing canonical schema
must fail in CI/release mode. Rollback is removal of task-worktree changes; existing branches
and package versions remain untouched.
