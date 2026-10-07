# Capability Packaging — Profiles, Components, and Prerequisites

> Human-facing guide for ADR-0016 (Capability Packaging, Accepted 2026-07-08).
> Technical reference: `.enterprise/governance/capabilities/README.md` · Catalog sources:
> `.enterprise/governance/capabilities/{profiles,components,surfaces}.yaml` · Compiled output:
> `.agents/capabilities/` · Resolver: `tools/cli/lib/capability-catalog.js`.

HSEOS installation is driven by an **auditable capability catalog** instead of a raw module list.
You pick a _profile_ (or compose components/skills directly); the resolver produces a reviewable
plan; `hseos install` materializes it. The governance baseline can never be deselected.

## Agent execution outcomes

`hseos agent run` and `hseos agent resume` return exit code **1** when the durable
session is `failed` or `cancelled`. The result remains available on stdout, including
with `--json`, so callers can inspect its status and state path. Explicit successful
`agent cancel`, `--create-only`, and completed executions return **0**. Invalid
arguments and runtime exceptions also return a nonzero exit code.

For example, `hseos agent run --profile agent-reference --value example --json`
executes the keyless scripted fixture. Its completion proves that reference flow;
it does not certify a real provider, a software delivery, or operational activation.

## Concepts

| Concept                           | What it is                                                                                                                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Profile**                       | Named, curated selection of components + a hook profile. One command → coherent surface.                                                                                                                          |
| **Component**                     | Installable unit in one of 6 families: `baseline:*`, `runtime:*`, `capability:*`, `adapter:*`, `skill:*`, `extra:*`.                                                                                              |
| **Baseline**                      | `baseline:governance`, `baseline:entrypoints`, `baseline:skills-registry` are `required: true` — always included, impossible to remove.                                                                           |
| **Synthetic `skill:*` selectors** | Generated at runtime from the governed manifest — every governed skill is individually selectable via `--skills <id>`; authority stays in `.enterprise/`.                                                         |
| **Hook profile**                  | Enforcement posture: `advisory` (warn-only) · `standard` (dev default) · `strict` (heavy local gates) · `ci` (required gates fail hard). Repository-mandatory gates are never disabled by a lighter profile.      |
| **Prerequisites**                 | Declared per component in the catalog and rendered by `hseos install-plan`. Every optional component **degrades gracefully** when its prerequisite is unmet — installing without the prerequisite is always safe. |
| **Surface class**                 | Closed classification: `core`, `module`, `sidecar`, `candidate`, or `compatibility`. Every component is covered exactly once.                                                                                     |

`hseos install-plan` renders the surface class beside every selected component.
The baseline and canonical state/control paths are `core`; selectable business
capabilities and adapters are `module`; web dashboards are `sidecar` and may
only read canonical state; activation rehearsals remain `candidate`; legacy
transition code is `compatibility` and requires retirement evidence.

## Profiles

| Profile                             | Hook profile | Intent                                                                     |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `minimal`                           | advisory     | Baseline instructions + policy + entrypoints only                          |
| `developer` **(default)**           | standard     | Implementation, review, verification, state tracking                       |
| `governance`                        | strict       | Architecture/ADR/compliance/readiness reviews                              |
| `gitops`                            | strict       | Delivery + GitOps + observability operations                               |
| `ado`                               | strict       | Azure DevOps tracking on top of delivery                                   |
| `solo`                              | standard     | BLITZ-style compact solo flow                                              |
| `full`                              | ci           | Complete surface: every capability family + all adapters (including Goose) |
| `agent-reference`                   | strict       | Keyless HSEOS kernel with the scripted `ModelProvider`                     |
| `agent-openai-compatible-candidate` | strict       | HSEOS kernel with a bound OpenAI-compatible `ModelProvider`                |
| `agent-codex-delegated-candidate`   | strict       | Hosted Codex `RuntimeProvider`, honestly limited to L0/run-only            |
| `agent-claude-delegated-candidate`  | strict       | Hosted Claude Code `RuntimeProvider`, honestly limited to L0               |
| Sandboxed ACP one-shot candidate    | strict       | External ACP `RuntimeProvider`, honestly limited to L0/one-shot            |

```bash
hseos install-plan --list-profiles          # discover profiles
hseos install-plan --profile gitops         # dry-run: components, skills, paths, PREREQUISITES
hseos install --profile developer           # materialize the default
hseos install --skills pr-review,rfc        # baseline + individual skills only
hseos install-plan --list-components --family capability
hseos agent-provider-conformance --verify --require-ready
```

Kernel profiles select exactly one model provider and `runtime:hseos-kernel`. Hosted profiles
select a runtime provider only: the delegated product owns its model boundary, so HSEOS does not
invent a placeholder `ModelProvider`. `agent-provider-conformance` resolves every selected ID to
the actual versioned manifest, hashes its canonical test files, executes each unique suite once,
and promotes a declared runtime level only when all associated suites pass. This is conformance
evidence, not operational activation; the report always keeps activation authority false.

## Components with prerequisites (all optional, all degrade gracefully)

| Component                  | Prerequisite                                                                         | Behavior when unmet                                                 |
| -------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| `capability:ado`           | `ado.enabled: true` in `.hseos/config/hseos.config.yaml` + `ADO_PAT` env (ADR-0011)  | Every ADO hook/skill exits silently (no-op)                         |
| `capability:sandbox`       | External `ai-jail` binary (bubblewrap); check with `hseos sandbox doctor` (ADR-0012) | No-op (`sandbox.required: false` default)                           |
| `capability:gitops`        | Admin agent mode for `gitops-deploy`; kubectl/ArgoCD for real deployments            | Skills never auto-activate outside admin mode                       |
| `capability:observability` | `OTEL_EXPORTER_OTLP_ENDPOINT` (+ Loki vars) for telemetry export (ADR-0014)          | Export hooks stay inert; SQLite remains canonical                   |
| `capability:knowledge`     | Vault path for `second-brain` (`--second-brain-path`)                                | Skill degrades (`vault_required: false`, P6)                        |
| `capability:research`      | Axon code index for `repo-radar`                                                     | Falls back to Read+Grep exploration                                 |
| `runtime:mcp`              | `axon` binary for axon-bridge; env secrets for the enterprise MCP bundle (ADR-0008)  | axon-bridge returns no-op fallbacks; enterprise bundle stays opt-in |

Components **without** external prerequisites: `baseline:*` (3), `runtime:{hooks,state,workflows}`,
`capability:{architecture,delivery,security,readiness,solo,verification}`, `adapter:{claude-code,codex,goose}`.

## Installer extras (`extra:*` components — pure opt-in)

Host-side conveniences are first-class catalog components since cycle 07: selectable via
`--components extra:<id>`, visible in `install-plan` with their prerequisites, and **never
bundled into any profile** (a tested invariant). Selecting a component activates the
corresponding flag; an explicit flag always wins.

| Component               | Equivalent flag                       | Prerequisite / caveat                                                                                                       |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `extra:rtk`             | `--rtk`                               | Downloads an external binary; **patches the user-global Claude Code settings** (cross-project side effect — the plan warns) |
| `extra:usage-dashboard` | `--usage-dashboard [local\|docker]`   | Python or Docker; binds :8080 network-exposed by design                                                                     |
| `extra:second-brain`    | `--second-brain-path <path>`          | Component signals intent; the path itself still comes from the flag or the wizard                                           |
| `extra:git-hooks`       | on by default; `--no-git-hooks` skips | Git working tree; existing hooks never overwritten                                                                          |

```bash
hseos install-plan --components extra:rtk          # see the plan INCLUDING the global-patch warning
hseos install --profile developer --components extra:usage-dashboard
```

## Guarantees & invariants

- **Schema v2 fails closed** — both catalog documents require `schema_version: "2.0"`; unknown fields, duplicate IDs, unsafe paths, invalid references, multiple defaults, or a changed mandatory baseline are rejected before resolution.
- **Execution modes are exact** — kernel profiles require a real model provider and the native HSEOS kernel; hosted profiles forbid model-provider placeholders and require only their delegated runtime provider.
- **Baseline is irremovable and normalized** — `resolveCapabilityPlan` always injects the three `required: true` components; profile documents are forbidden from repeating them.
- **Materialization is exact** — a capability-driven install passes only `plan.skills` to the compiler. Generated `.agents/skills` and Goose mirrors are reconciled on profile changes, and compilation fails if the selected and emitted skill sets differ.
- **Referential integrity is tested** — `test/test-capability-catalog.js` fails if a profile references
  an unknown component, a component references an unknown skill, **any governed skill lacks a
  capability-family home**, or prerequisites are malformed.
- **Selection is persisted** — the resolved plan is written to `.hseos/config/capability-selection.yaml`
  for audit and reproducibility only after installation succeeds.

The candidate `hseos agent validate-task --task-contract task.json --json` checks a
[disposable engineering contract](engineering-task-contract.md) without executing
it or authorizing a provider. Structural validity is separate from execution,
verifier attestation and operational activation.

## v4 engineering candidate and selective installation

`disposable-engineering-candidate` selects the kernel, engineering tools and the
Codex adapter. `install --profile minimal` and `install --profile
disposable-engineering-candidate` materialize only their selected governance and
adapter artifacts into a fresh consumer. Existing governance surfaces cause a
refusal rather than an overwrite. Runtime modules remain in the installed root
package; they are not copied into the consumer. Other installation profiles retain
their existing installer path and are not covered by this fresh-install guarantee.

Component `depends_on` edges are resolved transitively. Unknown dependencies and
cycles fail catalog validation, including components outside the selected profile.
Public help and structural task validation load no optional integrations and make
no update network request. Commands and optional model implementations load on use.
Sidecars retain their existing separate service lifecycle.

| Provider path | Inference | Tools / writing | Resume | Cancellation | Evidence |
| --- | --- | --- | --- | --- | --- |
| Engineering scripted fixture | Deterministic sequence | Contract gateway / scoped writes | Before dispatch; completed-session verification | Executor descendants confirmed | Task, artifacts, protected verifier |
| Engineering compatible binding | SSE model via existing broker | Same gateway and executor | Same bounded rules; original binding | Runtime stream and executor cancellation | Same task evidence plus session provider events |
| Existing delegated runtimes | Owned by external runtime | External runtime capabilities | Only as declared by adapter | Only as declared by adapter | Adapter conformance; no engineering approval implied |

Model preference selects an adapter/provider; it grants no kernel tool authority.
Advisory hooks inform. Approval requests pause for a decision. Only a denial enforced
at the gateway or executor blocks an effect; a hook name or readiness label is not
proof of enforcement. Missing engineering isolation prerequisites block execution.

## Platform bindings

`hseos init` asks how the project uses platform capabilities (`platform`, `hybrid` or `local`), and
`hseos install` accepts the same choice through flags. The choice is recorded in
`.hseos/config/platform-bindings.yaml` (ADR-0046). Nothing is written unless a mode or a binding is
given explicitly.

| Option                      | Effect                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------- |
| `--platform-mode <mode>`    | Records the mode. A mode weaker than the recorded one needs `--mode-ref`                          |
| `--mode-ref <path>`         | Decision record under `docs/decisions/` that justifies a `local` or weaker mode                   |
| `--platform-binding <spec>` | Override `<capability>=<outcome>:<ref>:<YYYY-MM-DD>`; repeat the flag, one binding per capability |

`--platform-binding` without `--platform-mode` writes `mode: platform` explicitly when the project has
no bindings file yet; an existing file keeps its mode. `hseos install-plan` accepts the same options and
prints the document without writing it.

`hseos platform-bindings show` prints the effective bindings. `check` validates the project file; with
`--base <ref>` it compares against the mode recorded at that revision, `HEAD` by default.
`sync --ref <tag> --ecp-root <checkout>` copies a tagged capability registry into the user cache and
prints the user-layer snippet that uses it.

### Modes and enforcement

| Mode       | `capability-check`                                  | Intake guard                                                                                  |
| ---------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `platform` | Resolves through the registry; `consume` or `extend` | Blocks a new shareable export without intake                                                  |
| `hybrid`   | Same; advisory unless an implementation is `stable` | Blocks only a `match` hit whose implementation is `stable` for the project's stacks           |
| `local`    | Informational                                       | Never blocks; requires `mode_ref`                                                             |

A project without the bindings file (or with an invalid one) is treated as `platform`. Choosing `local`
or any mode weaker than the one recorded at `HEAD` requires `--mode-ref` (a `.md` under
`docs/decisions/` or `.enterprise/.specs/decisions/`). Overrides (`keep-local`, `exception`) need an
`intake_ref`/`exception_ref` identifier that resolves in the repository and a future `expires` date.
`.hseos/config/platform-bindings.yaml` is human-owned: the intake guard denies agent edits to it.

`hseos capability-check <name> [--directory <path>] [--json]` resolves the query through the ECP
registry (snapshot by default, a user-layer `ecp_root`/`registry` otherwise) by name, alias, package
or contract, `match` hints and prefix (case-insensitive; space, `-` and `_` count as the same separator,
so `mobile tokens` finds `mobile-tokens`; `.` and `/` are not normalized, only the separators around them, and the
`heuristic` fallback bridges a separator only for queries of two or more tokens, each with at least two
alphanumerics, and four or more alphanumerics in total); a filename scan is kept only as a `heuristic` fallback. The JSON
output reports the effective mode and the layer it came from. Exit codes: 0 completed, 1 bindings or
registry failed validation, 2 usage error.

`hseos platform-bindings` exit codes: `show` 0 (1 if the registry fails its integrity check), `check`
0/1 (violation)/2 (git or usage failure), `sync` 1 on error, `guard` 0 allow / 2 deny. The registry
snapshot ships at `contracts-v0.4.0`; refresh it with `sync` and update the lock.
