# Plugin Marketplace — Authority and Activation

HSEOS keeps one governed plugin authority and two generated vendor views:

```text
.enterprise/governance/plugins/   canonical authoring source
              ↓ agent-core compile (exact replacement)
.agents/plugins/                  generated neutral catalog
              ↓ validated active manifests only
.claude-plugin/ + .codex-plugin/  generated vendor installations
```

Do not author plugin definitions under `.agents/`, `.claude-plugin/`, or
`.codex-plugin/`. Compilation replaces generated neutral output from the
canonical enterprise tree and quarantines previously installed inactive
plugins under each vendor's `disabled/` directory.

## Status model

- `scaffolded`: roadmap candidate only; visible to `plugin list`, but absent
  from the compiled manifest and vendor catalogs and rejected by `plugin install`.
- `active`: publishable only after schema, identity, surface containment, and
  declared behavior tests pass.
- `disabled`: retained catalog history; never published or installed.

The four bundled candidates are currently `scaffolded`. Their surface examples
are not evidence of implementation and cannot be activated merely by changing
the registry status: activation without non-empty passing behavior tests fails.

## Schema and safety

The canonical registry uses schema v2 and rejects unknown fields, duplicate or
unsafe IDs, invalid semantic versions, invalid status values, and an incorrect
source authority. Surface and test paths must be relative, remain inside the
plugin definition after symlink resolution, and exist before an active plugin
can be emitted.

`extends` is syntax-validated provenance metadata only. Compilation performs no
network lookup or implicit behavior layering; active plugins must bundle and test
every behavior they publish.

Plugin installation prepares both vendor trees before exposing either, restores
both previous versions on a failed swap, and validates the plugin ID before any
filesystem path is resolved. Removal applies the same ID validation.

## Commands

```bash
hseos plugin list
hseos plugin doctor
hseos plugin install <active-plugin-id>
hseos plugin remove <plugin-id>
```

Projects created before canonical plugin sources may temporarily compile from
their existing `.agents/plugins/` tree. This compatibility path is explicit and
is scheduled for retirement in the harness-unification G9 node.
