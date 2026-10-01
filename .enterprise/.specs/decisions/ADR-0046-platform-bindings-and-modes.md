# ADR-0046 — Platform Bindings, Adoption Modes and ECP Contract Authority

**Status:** Proposed
**Date:** 2026-10-01
**Authors:** Platform Architecture Owners (proposal prepared for review)
**Affects Standards:** Platform Capability Governance Standard (§2.1, §7, §8.1), capability-reuse policy, capability-graph policy, capability intake guard, `hseos init` / `hseos install` / `hseos capability-check`
**Supersedes:** N/A
**Amends:** ADR-0036 (contract source of truth), ADR-0033 (contract identifiers), ADR-0034 (enforcement scope)
**Superseded By:** N/A

---

## Context

Three vocabularies describe shared capabilities without a mapping between them: the Enterprise
Capability Platform (ECP) capability contracts (`auth.authenticate`), the JSON Schema contracts
owned by the cores (`platform-core/auth/auth-provider`) and the identifiers in this repository's
federated capability graph (`auth`, `contract.*`).

The consequences were verified on 2026-09-30 and 2026-10-01:

- `hseos capability-check` matches a substring of file names. It never sees the core packages: it
  expects `<workspace>/cores/<repo>` while the real layout is flat, and its walk ignores symbolic
  links. A real consumer reimplemented cache and authorization while the matching platform
  packages existed, and nothing reported it.
- The capability intake guard blocks every new shareable export in the paths it watches. A project
  that deliberately has no package library and implements locally has no supported way to say so.
- No installation step records which platform contracts and packages a project consumes, and there
  is no user or organization configuration layer.
- ADR-0036 names Platform Core as the neutral contract source, while the owner decided on
  2026-10-01 that ECP is the single contract authority (ECP Decision 0006).

## Decision

We will make ECP the contract authority referenced by HSEOS, and introduce **platform bindings**: a
layered, validated configuration that records how a project relates to the platform, chosen at
installation and enforced deterministically.

### 1. Contract authority (amends ADR-0036 and ADR-0033)

- The ECP is the single source of truth for shared capability contracts. In the PCCP taxonomy of
  ADR-0036, **Specification** and **Contract** live in ECP; **Projections**, **Adapters**,
  **Reference implementations** and **Conformance** runs live in the cores and products.
  ADR-0036's sentence "stack cores depend on Platform Core" is read as "stack cores depend on ECP
  contracts"; the rest of ADR-0036 is unchanged.
- ECP capability names are the canonical identifiers. Core `$id` values and graph identifiers
  defined under ADR-0033 resolve to them through the `aliases` published in the ECP capability
  registry. Existing graph IDs are not rewritten.
- The structural compatibility diff required by ADR-0036 is satisfied for ECP contracts by the ECP
  compatibility gate (Decision 0006, §6), which compares contract schemas with the base revision
  and rejects author-supplied classification. HSEOS consumes its result through the registry and
  does not reimplement it.
- This ADR does not activate graph schema 2.0 or intake v3. That gate of ADR-0036 stays pending.

### 2. Adoption modes

Each project has one mode:

| Mode | `capability-check` | Intake guard | Intake required |
|---|---|---|---|
| `platform` | Resolves through the registry; verdict `consume` or `extend` | Blocks a new shareable export without intake (current behavior) | Yes |
| `hybrid` | Same as `platform` | Blocks only when the export matches a registry entry's `match` hints and that entry has an implementation with status `stable` for the project's stack; otherwise advisory | Only in the blocking case |
| `local` | Informational | Never blocks | No |

- Until a capability reaches `stable` for a stack, `hybrid` behaves as `local` plus advisories.
- Per-capability overrides in `platform` and `hybrid` use the existing outcomes `keep-local` and
  `exception`. They require an `intake_ref` or `exception_ref` that exists in the repository and an
  `expires` date that has not passed; otherwise validation fails.
- Global rules that are not about capability reuse (shared infrastructure, secrets handling)
  apply in every mode.

### 3. Configuration layers

Precedence from lowest to highest:

1. **Runtime** — `.enterprise/governance/capabilities/platform-bindings.defaults.yaml` and
   `ecp-registry.snapshot.json` (with `source_ref` and SHA-256), shipped with the distribution and
   usable offline.
2. **User / organization** — `${XDG_CONFIG_HOME:-~/.config}/hseos/platform-bindings.yaml` or the
   file named by `HSEOS_PLATFORM_BINDINGS`. Read only if present (ADR-0006 P5). Holds machine
   paths such as `ecp_root` and `cores_root` for development.
3. **Project** — `.hseos/config/platform-bindings.yaml`, versioned, without absolute paths.
4. **Flags** — `--platform-mode`, `--platform-binding <capability>=<outcome>:<ref>`, `--mode-ref`.

The schema is `.enterprise/governance/capabilities/schemas/platform-bindings.schema.json`. Unknown
keys are rejected.

### 4. Protection against silent downgrade

- Choosing `local`, or any mode weaker than the one already recorded, requires `mode_ref` pointing
  at a decision record in the repository.
- The user layer, environment variables and flags can only make the mode stricter, unless a flag
  carries `--mode-ref`.
- Agents must not edit `.hseos/config/platform-bindings.yaml`; it is a protected, human-owned file.
- `capability-check --json` reports the effective mode and the layer it came from.

### 5. Backward compatibility and failure behavior

- A project without `.hseos/config/platform-bindings.yaml` is treated as `platform` with exactly
  today's guard decision. Runtime defaults do not apply to it.
- A bindings file that fails validation is treated as `platform`, and the guard message points at
  the validation error. It is not treated as deny-all.
- `CORE_INTAKE_ACK=<intake-id>` resolved in `docs/decisions/*intake*.md` stays valid. `intake_ref`
  uses the same resolver.
- The hook never uses the network and must finish within its 5-second timeout. It resolves the CLI
  like the other handlers (local `tools/cli/hseos-cli.js`, otherwise `hseos` on `PATH`). Without
  node or the CLI it keeps today's fail-open behavior, as it already does without `jq`.

### 6. Registry consumption

- HSEOS reads the ECP capability registry (`catalog/capability-registry.json`) from the shipped
  snapshot by default, verifying its SHA-256. A user-layer `ecp_root` overrides it for development.
- Remote retrieval (`uri` + `ref`) happens only through the explicit `hseos platform-bindings sync`
  command, which verifies the hash. Hooks never retrieve.
- Resolution order is deterministic: exact name, alias, package or contract identifier, `match`
  hints, prefix. Substring matching on file names remains only as a fallback labelled `heuristic`.

---

## Consequences

### Positive
- Projects declare at installation whether they consume the platform, mix, or implement locally,
  and the declaration is enforced the same way every time.
- `capability-check` and the guard resolve capabilities through published data instead of file
  name heuristics.
- One contract vocabulary across ECP, cores and HSEOS, with legacy identifiers kept as aliases.

### Negative / Trade-offs
- HSEOS depends on ECP registry releases; the shipped snapshot can lag behind ECP.
- One more configuration file and one more installation question.

### Risks
- A project could choose `local` to avoid governance. Mitigated by the `mode_ref` requirement, the
  protected file, and reporting of the effective mode.
- A stale snapshot could hide a new platform capability. Mitigated by a drift check between the
  snapshot and its pinned ECP ref, and by `hseos platform-bindings sync`.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Platform Capability Governance Standard | §2.1 PCCP | Amends: contract source is ECP |
| Platform Capability Governance Standard | §7 Mandatory intake | Extends: adoption modes and overrides |
| Platform Capability Governance Standard | §8.1 Portfolio reference corpus | Clarifies: ECP registry is the capability source |
| `.enterprise/policies/capability-reuse.md` | Scope, enforcement | Extends: modes; scope no longer tied to one filesystem path |
| `.enterprise/policies/capability-graph.md` | Canonical artifacts | Extends: ECP registry and aliases |

Changes to the Platform Capability Governance Standard live in the restricted `core` shard and are
delivered in a separate pull request that requires Engineering Leadership approval.

---

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: after the platform bindings implementation is merged and installed
- [ ] Review date: after the first ECP contract bundle with pilot capabilities is consumed by the cores

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| A single global on/off switch | Cannot express projects that consume some capabilities and keep others local |
| Only per-capability declarations, no mode | Forces every project to enumerate the whole registry before installing |
| Keep Platform Core as contract source and add ECP alongside | Leaves two authorities, which AGENTS.md requires stopping on |
| Fetch the registry from ECP during hooks | Needs network and credentials inside a 5-second blocking hook |
