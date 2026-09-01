# HSEOS Capability Packaging

Capability packaging is the native HSEOS layer that turns governance assets,
skills, hooks, workflows, adapters, and runtime support into reviewable install
intent.

It is a planning and selection layer. It does not replace the Enterprise
Constitution, agent authority files, skill registry, quality gates, worktree
lifecycle, or state management.

Both catalog documents use fail-closed schema v2 (`schema_version: "2.0"`).
Unknown fields, duplicate IDs, unsafe paths, invalid references, multiple
defaults, or a changed mandatory baseline reject the catalog before planning.

## Files

| File                                      | Purpose                                                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `profiles.yaml`                           | Operator-facing install profiles such as `minimal`, `developer`, `governance`, `gitops`, `ado`, `solo`, and `full` |
| `components.yaml`                         | Capability components grouped by `baseline`, `runtime`, `capability`, `adapter`, and `skill`                       |
| `surfaces.yaml`                           | Closed lifecycle classification for every component plus independently operated surfaces                           |
| `.hseos/config/capability-selection.yaml` | Installed project record of the resolved capability plan                                                           |

## Naming

Capability IDs use `<family>:<slug>`.

| Family       | Meaning                                                  | Example               |
| ------------ | -------------------------------------------------------- | --------------------- |
| `baseline`   | Mandatory governance and entrypoint assets               | `baseline:governance` |
| `runtime`    | Runtime support such as hooks, state, workflows, and MCP | `runtime:state`       |
| `capability` | Operator capability grouping across skills and workflows | `capability:delivery` |
| `adapter`    | Runtime/tool adapter surface                             | `adapter:codex`       |
| `skill`      | Synthetic selector for one governed skill                | `skill:pr-review`     |

Synthetic `skill:*` components are generated from the governed skill catalog.
They are selectable wrappers only; the authoritative content remains in
`.enterprise/governance/agent-skills/` and the generated portable view remains
under `.agents/skills/`.

## Hook Profiles

| Profile    | Use                                               |
| ---------- | ------------------------------------------------- |
| `advisory` | Warn-only first install and evaluation posture    |
| `standard` | Default development posture                       |
| `strict`   | Governance-heavy local execution posture          |
| `ci`       | CI/release posture with required repository gates |

Hook profiles are recorded as install intent. Mandatory repository gates remain
governed by HSEOS policy and are not disabled by selecting a lighter profile.

## Surface Lifecycle

Every catalog component has exactly one class in `surfaces.yaml`:

| Class           | Contract                                                             |
| --------------- | -------------------------------------------------------------------- |
| `core`          | Required for governance truth, execution control, or canonical state |
| `module`        | Selectable capability installed in-process                           |
| `sidecar`       | Separately operated process that cannot own canonical state          |
| `candidate`     | Pre-activation surface that cannot imply production readiness        |
| `compatibility` | Metered transition surface with explicit retirement evidence         |

Standalone surfaces also declare `active`, `opt-in`, `pre-activation`, or
`retiring`. Unknown classes, missing component coverage, unsafe paths, and any
attempt to classify a required baseline outside `core` fail closed. Synthetic
skill selectors inherit `module` because they package governed content without
becoming runtime authority.

## Install Planning

Use the CLI before installing or modifying a project:

```bash
hseos install-plan --profile developer
hseos install-plan --profile governance --json
hseos install-plan --skills pr-review,test-coverage --hook-profile strict
hseos install-plan --list-components --family capability
hseos install-plan --adapters
```

During install, the same selectors are available:

```bash
hseos install --profile developer
hseos install --profile gitops --hook-profile strict
hseos install --components capability:security,runtime:mcp
hseos install --skills pr-review,test-coverage
```

The installer resolves the capability plan, fills module/tool defaults when the
operator did not provide explicit values, and passes the exact selected skill
set to the compiler. The compiler reconciles generated skill directories,
fails if selected and emitted sets differ, and records the resolved plan at
`.hseos/config/capability-selection.yaml` only after a successful install.

Required baseline components are injected by the resolver. Profiles must not
repeat them, which keeps profile declarations normalized without making the
baseline optional.

## Agent Provider Binding

The `agent-openai-compatible-candidate` profile includes an immutable binding
example under `.agents/activation/provider-bindings/`. Copy it outside the
canonical tree, select a credential-free endpoint and model, and keep only a
secret reference in `secret_refs`.

```bash
hseos agent-provider-validate --binding ./provider-binding.yaml
hseos agent-provider-validate --binding ./provider-binding.yaml --probe
```

The first command is structural and performs no secret or network access. The
second resolves the declared secret at dispatch only after every required
sandbox check passes. Neither command authorizes activation.

The `agent-codex-delegated-candidate` profile binds directly to the official
Codex app-server JSONL/stdio protocol. Copy its example binding outside the
canonical tree, replace the executable and project paths with absolute paths,
and run a resumable instructions-only session:

```bash
hseos agent run --profile agent-codex-delegated-candidate --binding ./codex-binding.yaml --create-only
hseos agent resume --profile agent-codex-delegated-candidate --state /tmp/hseos-ledger-fixture-... --expected-sequence N --message "Continue"
```

The binding persists only executable identity, arguments, environment variable
names, and secret references. Environment values flow directly to the child
process and never enter the binding, canonical ledger, or CLI output. This is a
pre-activation L0 surface: observed effect-bearing items fail closed.

## Accommodation Rules

- Keep canonical profile/component manifests in `.enterprise/governance/capabilities/`.
- Treat `.agents/capabilities/` as compiler output. Compiled-only installations
  remain readable during the compatibility window.
- Keep generated or installed selection state in `.hseos/config/`.
- Keep adapter capability declarations in `.agents/adapters/`.
- Keep hook handlers in `.agents/hooks/handlers/`.
- Keep governed skill authority in `.enterprise/governance/agent-skills/`.
- Do not duplicate skill content into capability manifests.

## Capability Graph Discovery

The capability graph and discovery corpus are distinct governance surfaces:

- `registry.yaml` composes repository-owned graph fragments after deterministic validation.
- `reference-corpus.json` pins the portfolio sources that capability discovery must inspect. It is discovery-only and cannot establish ownership, publication, or adoption.
- `schemas/` defines the machine contracts for both surfaces.

```bash
node scripts/governance/validate-capability-graph.js --json
node scripts/governance/validate-capability-reference-corpus.js --json
node scripts/governance/validate-capability-reference-corpus.js --query messaging.event-envelope
```

Use `--repository-root repo.id=/absolute/path --require-all` to verify every pinned source. Candidate coverage is not adoption: verified consumption requires a repository-owned fragment, an immutable package version, and installation evidence.
