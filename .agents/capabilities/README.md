# HSEOS Capability Packaging

Capability packaging is the native HSEOS layer that turns governance assets,
skills, hooks, workflows, adapters, and runtime support into reviewable install
intent.

It is a planning and selection layer. It does not replace the Enterprise
Constitution, agent authority files, skill registry, quality gates, worktree
lifecycle, or state management.

## Files

| File | Purpose |
|---|---|
| `profiles.yaml` | Operator-facing install profiles such as `minimal`, `developer`, `governance`, `gitops`, `ado`, `solo`, and `full` |
| `components.yaml` | Capability components grouped by `baseline`, `runtime`, `capability`, `adapter`, and `skill` |
| `.hseos/config/capability-selection.yaml` | Installed project record of the resolved capability plan |

## Naming

Capability IDs use `<family>:<slug>`.

| Family | Meaning | Example |
|---|---|---|
| `baseline` | Mandatory governance and entrypoint assets | `baseline:governance` |
| `runtime` | Runtime support such as hooks, state, workflows, and MCP | `runtime:state` |
| `capability` | Operator capability grouping across skills and workflows | `capability:delivery` |
| `adapter` | Runtime/tool adapter surface | `adapter:codex` |
| `skill` | Synthetic selector for one governed skill | `skill:pr-review` |

Synthetic `skill:*` components are generated from the governed skill catalog.
They are selectable wrappers only; the authoritative content remains in
`.enterprise/governance/agent-skills/` and the generated portable view remains
under `.agents/skills/`.

## Hook Profiles

| Profile | Use |
|---|---|
| `advisory` | Warn-only first install and evaluation posture |
| `standard` | Default development posture |
| `strict` | Governance-heavy local execution posture |
| `ci` | CI/release posture with required repository gates |

Hook profiles are recorded as install intent. Mandatory repository gates remain
governed by HSEOS policy and are not disabled by selecting a lighter profile.

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
operator did not provide explicit values, and records the resolved plan at
`.hseos/config/capability-selection.yaml` after a successful install.

## Accommodation Rules

- Keep canonical profile/component manifests in `.agents/capabilities/`.
- Keep generated or installed selection state in `.hseos/config/`.
- Keep adapter capability declarations in `.agents/adapters/`.
- Keep hook handlers in `.agents/hooks/handlers/`.
- Keep governed skill authority in `.enterprise/governance/agent-skills/`.
- Do not duplicate skill content into capability manifests.
