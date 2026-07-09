# Capability Packaging — Profiles, Components, and Prerequisites

> Human-facing guide for ADR-0016 (Capability Packaging, Accepted 2026-07-08).
> Technical reference: `.agents/capabilities/README.md` · Catalog sources:
> `.agents/capabilities/{profiles,components}.yaml` · Resolver: `tools/cli/lib/capability-catalog.js`.

HSEOS installation is driven by an **auditable capability catalog** instead of a raw module list.
You pick a *profile* (or compose components/skills directly); the resolver produces a reviewable
plan; `hseos install` materializes it. The governance baseline can never be deselected.

## Concepts

| Concept | What it is |
|---|---|
| **Profile** | Named, curated selection of components + a hook profile. One command → coherent surface. |
| **Component** | Installable unit in one of 5 families: `baseline:*`, `runtime:*`, `capability:*`, `adapter:*`, `skill:*`. |
| **Baseline** | `baseline:governance`, `baseline:entrypoints`, `baseline:skills-registry` are `required: true` — always included, impossible to remove. |
| **Synthetic `skill:*` selectors** | Generated at runtime from the compiled manifest — every governed skill (49 today) is individually selectable via `--skills <id>`; authority stays in `.enterprise/`. |
| **Hook profile** | Enforcement posture: `advisory` (warn-only) · `standard` (dev default) · `strict` (heavy local gates) · `ci` (required gates fail hard). Repository-mandatory gates are never disabled by a lighter profile. |
| **Prerequisites** | Declared per component in the catalog and rendered by `hseos install-plan`. Every optional component **degrades gracefully** when its prerequisite is unmet — installing without the prerequisite is always safe. |

## Profiles

| Profile | Hook profile | Intent |
|---|---|---|
| `minimal` | advisory | Baseline instructions + policy + entrypoints only |
| `developer` **(default)** | standard | Implementation, review, verification, state tracking |
| `governance` | strict | Architecture/ADR/compliance/readiness reviews |
| `gitops` | strict | Delivery + GitOps + observability operations |
| `ado` | strict | Azure DevOps tracking on top of delivery |
| `solo` | standard | BLITZ-style compact solo flow |
| `full` | ci | Complete surface: every capability family + all adapters (including Goose) |

```bash
hseos install-plan --list-profiles          # discover profiles
hseos install-plan --profile gitops         # dry-run: components, skills, paths, PREREQUISITES
hseos install --profile developer           # materialize the default
hseos install --skills pr-review,rfc        # baseline + individual skills only
hseos install-plan --list-components --family capability
```

## Components with prerequisites (all optional, all degrade gracefully)

| Component | Prerequisite | Behavior when unmet |
|---|---|---|
| `capability:ado` | `ado.enabled: true` in `.hseos/config/hseos.config.yaml` + `ADO_PAT` env (ADR-0011) | Every ADO hook/skill exits silently (no-op) |
| `capability:sandbox` | External `ai-jail` binary (bubblewrap); check with `hseos sandbox doctor` (ADR-0012) | No-op (`sandbox.required: false` default) |
| `capability:gitops` | Admin agent mode for `gitops-deploy`; kubectl/ArgoCD for real deployments | Skills never auto-activate outside admin mode |
| `capability:observability` | `OTEL_EXPORTER_OTLP_ENDPOINT` (+ Loki vars) for telemetry export (ADR-0014) | Export hooks stay inert; SQLite remains canonical |
| `capability:knowledge` | Vault path for `second-brain` (`--second-brain-path`) | Skill degrades (`vault_required: false`, P6) |
| `capability:research` | Axon code index for `repo-radar` | Falls back to Read+Grep exploration |
| `runtime:mcp` | `axon` binary for axon-bridge; env secrets for the enterprise MCP bundle (ADR-0008) | axon-bridge returns no-op fallbacks; enterprise bundle stays opt-in |

Components **without** external prerequisites: `baseline:*` (3), `runtime:{hooks,state,workflows}`,
`capability:{architecture,delivery,security,readiness,solo,verification}`, `adapter:{claude-code,codex,goose}`.

## Installer extras (`extra:*` components — pure opt-in)

Host-side conveniences are first-class catalog components since cycle 07: selectable via
`--components extra:<id>`, visible in `install-plan` with their prerequisites, and **never
bundled into any profile** (a tested invariant). Selecting a component activates the
corresponding flag; an explicit flag always wins.

| Component | Equivalent flag | Prerequisite / caveat |
|---|---|---|
| `extra:rtk` | `--rtk` | Downloads an external binary; **patches the user-global Claude Code settings** (cross-project side effect — the plan warns) |
| `extra:usage-dashboard` | `--usage-dashboard [local\|docker]` | Python or Docker; binds :8080 network-exposed by design |
| `extra:second-brain` | `--second-brain-path <path>` | Component signals intent; the path itself still comes from the flag or the wizard |
| `extra:git-hooks` | on by default; `--no-git-hooks` skips | Git working tree; existing hooks never overwritten |

```bash
hseos install-plan --components extra:rtk          # see the plan INCLUDING the global-patch warning
hseos install --profile developer --components extra:usage-dashboard
```

## Guarantees & invariants

- **Baseline is irremovable** — `resolveCapabilityPlan` always injects `required: true` components.
- **Referential integrity is tested** — `test/test-capability-catalog.js` fails if a profile references
  an unknown component, a component references an unknown skill, **any governed skill lacks a
  capability-family home**, or prerequisites are malformed.
- **Selection is persisted** — the resolved plan is written to `.hseos/config/capability-selection.yaml`
  for audit and reproducibility.
