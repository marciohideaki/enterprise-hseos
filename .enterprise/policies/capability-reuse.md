# Policy: Capability Reuse (Core-First Enforcement)

**Status:** Proposed — pending Platform Architecture approval
**Version:** 1.0.0
**Effective:** On approval of ADR-0034
**Owner:** platform-governance
**Scope:** All code under `/opt/hideakisolutions/**`, including frontend, backend, shared
libraries, database, logging, audit, authentication, CQRS, cache, and messaging capabilities.

## Purpose and relationship to the Capability Graph

This policy makes core-first reuse enforceable at the point where code is written and merged.
It is complementary to, and does not replace, the Federated Platform Capability Graph policy:

- the Capability Graph owns deterministic discovery, capability identity, ownership,
  implementation and adoption evidence;
- this policy owns the required reuse decision, intake acknowledgement, write-time guard,
  merge ratchet, and the recurrence contract with the Core Registry;
- the Core Registry is a human-readable operational projection. It is not an independent
  ownership source and cannot create graph facts.

## Audience

All contributors, agents, product squads, core owners, CI maintainers, and the
`platform-governance` owner.

## Core principle

Before implementing a shareable capability, the contributor MUST use this decision order:

1. `consume` an existing capability;
2. `extend` an existing capability through its owning core;
3. `promote` a proven generic capability to its owning core;
4. `keep-local` only when the product or provider boundary is explicit and documented;
5. use an approved `exception` only under `.enterprise/policies/exceptions.md`.

A shareable capability is a component, hook, provider, utility, token, or infrastructure
helper that has the same semantics for two or more consumers, or is common to almost every
implementation of its domain.

## Intake before code

Before adding an exported capability, contributors MUST:

1. query the Capability Graph and its pinned reference corpus;
2. inspect candidates by name and signature in the relevant core, local packages, sibling
   applications, and .NET BuildingBlocks where applicable;
3. record the decision in `docs/decisions/*intake*.md`, conforming to
   `cores/platform-core/governance/contracts/capability-intake-v2.schema.json`;
4. include a graph-update plan for `promote`, and update the Core Registry projection after
   a recorded `promote` or `keep-local` decision.

The graph query is authoritative for discovery and ownership. Local search and the Core
Registry may supply candidates and operational context but do not establish ownership.

## Enforcement floor and ceiling

The compiled `capability-intake-guard` MUST block with exit code `2` when `Write` or `Edit`
introduces an exported, shareable capability under `applications/**/src`, `packages/**`, or
`src/Services/**` without a matching intake record. Acknowledgement is permitted only as
`CORE_INTAKE_ACK=<intake-id>` when that exact ID exists in the repository's intake decision;
`CORE_INTAKE_ACK=1` is invalid.

The guard MUST not fire for tests, specs, stories, mocks, generated files, `dist/`, or an
edit that adds no export. A documented false positive is a required regression case.

## Merge ratchet

Each adopting repository MUST commit an honest baseline and run the reusable
`capability-drift` workflow. The workflow MUST fail if any metric increases. At minimum it
measures duplicate names/signatures across apps and packages, inline styles, literal JSX
enums, equivalent .NET Service and BuildingBlocks helpers, and configured `jscpd` drift.
Reducing a metric may suggest, but never silently writes, a new baseline.

## Ownership and exceptions

| Piece | Canonical authority | Generated or consuming surfaces |
|---|---|---|
| Discovery and ownership | Capability Graph | reference corpus, repository fragments |
| Reuse rule and enforcement contract | this policy | adapters and product pointers |
| Write-time gate | hook registry and handler in HSEOS | compiled project adapters |
| Intake schema | platform-core contract | product decision records |
| Merge ratchet | platform-core reusable workflow | product workflows and baselines |
| Operational registry and recurrence | second-brain `_cores/` and weekly session | scorecard projection |

Only the policy owner may approve an exception, following `exceptions.md`. An exception does
not bypass the intake record, graph evidence, or expiry requirements.

## Metrics and rollout

The HSEOS policy owner tracks adoption using the standards-adoption metrics policy. Blocking
activation requires the end-to-end handler, compiler, workflow, skill, and recurrence tests
to be green, followed by explicit human approval. Legacy duplicate code is removed only in
the separately approved cleanup phase; compatibility copies are not a completion state.

## References

- `.enterprise/policies/capability-graph.md`
- `.enterprise/.specs/decisions/ADR-0033-federated-platform-capability-graph.md`
- `.enterprise/.specs/decisions/ADR-0034-capability-reuse-enforcement.md`
- `.enterprise/policies/exceptions.md`
- `.enterprise/policies/automated-validation.md`
- `.enterprise/policies/standards-adoption-metrics.md`
