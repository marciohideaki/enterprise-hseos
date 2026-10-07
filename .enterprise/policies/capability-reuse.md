# Policy: Capability Reuse (Core-First Enforcement)

**Status:** Proposed — pending Platform Architecture approval; adoption modes and ECP authority added by ADR-0046 (Accepted)
**Version:** 1.0.0
**Effective:** On approval of ADR-0034
**Owner:** platform-governance
**Scope:** Every repository where HSEOS is installed, including frontend, backend, shared
libraries, database, logging, audit, authentication, CQRS, cache, and messaging capabilities.
Enforcement is not tied to a filesystem location; it follows the project's adoption mode.

## Purpose and relationship to the Capability Graph

This policy makes core-first reuse enforceable at the point where code is written and merged.
It is complementary to, and does not replace, the Federated Platform Capability Graph policy:

- the Capability Graph owns deterministic discovery, capability identity, ownership,
  implementation and adoption evidence;
- this policy owns the required reuse decision, intake acknowledgement, write-time guard,
  merge ratchet, and the recurrence contract with the Core Registry;
- the Core Registry is a human-readable operational projection. It is not an independent
  ownership source and cannot create graph facts.

## Contract authority and adoption modes

The Enterprise Capability Platform (ECP) is the single source of truth for shared capability
contracts (ADR-0046). ECP capability names are the canonical identifiers; core `$id` values and
capability-graph IDs resolve to them through the `aliases` published in the ECP capability
registry (`catalog/capability-registry.json`). HSEOS reads that registry from the shipped
snapshot (`.enterprise/governance/capabilities/ecp-registry.snapshot.json`, SHA-256 verified
against `ecp-registry.snapshot.lock.json`) and never retrieves it from a hook.

Each project has one mode, recorded in `.hseos/config/platform-bindings.yaml`:

| Mode | `capability-check` | Intake guard | Intake required |
|---|---|---|---|
| `platform` | Resolves through the registry; verdict `consume` or `extend` | Blocks a new shareable export without intake | Yes |
| `hybrid` | Same as `platform`; verdicts are advisory unless an implementation is `stable` | Blocks only when any export of the file matches a registry entry's `match` hints and that entry has a `stable` implementation for the project's stack; otherwise advisory | Only in the blocking case |
| `local` | Informational | Never blocks | No |

A project without the bindings file, or whose file fails validation, is treated as `platform`
(the guard message names the validation error). Global rules unrelated to capability reuse
(shared infrastructure, secrets) apply in every mode.

Per-capability overrides in `platform` and `hybrid` use the outcomes `keep-local` (with an
`intake_ref`) and `exception` (with an `exception_ref`), plus a `reason` and an `expires` date
that has not passed. Refs are identifiers that must resolve in the repository; see ADR-0046.

**Anti-downgrade.** Mode strength is `platform` > `hybrid` > `local`. The recorded mode is the
one in the project file at `HEAD` (or at `--base <ref>` for `hseos platform-bindings check`; no
file means `platform`). Choosing `local`, or any mode weaker than the recorded one, requires a
`mode_ref` pointing to an existing decision record (`.md` under `docs/decisions/` or
`.enterprise/.specs/decisions/`). The user/organization layer and flags can only strengthen the
mode unless a flag carries `--mode-ref`. `.hseos/config/platform-bindings.yaml` is human-owned:
the guard denies agent edits to it.
The denial covers `Write`, `Edit` and `MultiEdit`, not writes through the Bash tool. The effective mode is
the working-tree one; `HEAD` is only the floor of the anti-downgrade, and any existing decision record
accepted as `mode_ref` (its content is not validated) allows a downgrade, committed or not. The
anti-downgrade is therefore a convenience barrier, not a security boundary. Hardening options are listed
as follow-ups in ADR-0046 section 8.

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

1. run `hseos capability-check <name>` (registry-first, mode-aware) and query the Capability
   Graph and its pinned reference corpus;
2. inspect candidates by name and signature in the relevant core, local packages, sibling
   applications, and .NET BuildingBlocks where applicable;
3. record the decision in `docs/decisions/*intake*.md`, conforming to
   `cores/platform-core/governance/contracts/capability-intake-v2.schema.json`;
4. include a graph-update plan for `promote`, and update the Core Registry projection after
   a recorded `promote` or `keep-local` decision.

The graph query is authoritative for discovery and ownership. Local search and the Core
Registry may supply candidates and operational context but do not establish ownership.

## Enforcement floor and ceiling

In `platform` mode (and for a project without bindings) the compiled `capability-intake-guard`
MUST block with exit code `2` when `Write` or `Edit` introduces an exported, shareable capability
under `applications/**/src`, `packages/**`, or `src/Services/**` without a matching intake record
(a project with bindings is decided by `hseos platform-bindings guard`, which applies the
registry and the mode). Acknowledgement is permitted only as `CORE_INTAKE_ACK=<intake-id>` when
that ID exists in the repository's intake decision; `CORE_INTAKE_ACK=1` is invalid. With a
bindings file the ID must match as a whole token; without one the legacy path accepts the
acknowledgement as a substring of any intake document (see `.enterprise/governance/hooks/README.md`).
Without the CLI or node the guard falls back to the `platform` decision.

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
- `.enterprise/.specs/decisions/ADR-0046-platform-bindings-and-modes.md`
- `.enterprise/.specs/decisions/ADR-0033-federated-platform-capability-graph.md`
- `.enterprise/.specs/decisions/ADR-0034-capability-reuse-enforcement.md`
- `.enterprise/policies/exceptions.md`
- `.enterprise/policies/automated-validation.md`
- `.enterprise/policies/standards-adoption-metrics.md`
