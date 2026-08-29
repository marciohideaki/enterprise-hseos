# Migration Guide — HSEOS v2.x → v3.0

HSEOS v3.0 makes project isolation and explicit surface contracts the default.
The release changes state locations, direct network exposure, workflow catalog
schema, capability lifecycle metadata, and one active hook identifier. Perform
the migration per project and commit the resulting governed artifacts.

## Before upgrading

1. Stop state, state UI, and central kanban processes that write or read the
   project being migrated.
2. Back up the repository and any existing machine-scoped SQLite database or
   project registry.
3. Confirm that the destination paths do not already contain newer data. Never
   overwrite a destination database to combine histories.

## State database

The v3 default is `<project>/.hseos/state/project.db`. A previous machine-scoped
database remains reachable only through an explicit root, for example
`hseos state-session list --directory /absolute/legacy/root`. HSEOS does not
silently inspect a user home directory.

For a one-time move, stop all writers and use SQLite's backup operation:

```bash
mkdir -p /absolute/project/.hseos/state
test ! -e /absolute/project/.hseos/state/project.db && \
  sqlite3 /absolute/legacy/project.db \
  ".backup '/absolute/project/.hseos/state/project.db'"
```

Validate the copy before retiring the source:

```bash
hseos state-session list --directory /absolute/project --all --json
hseos state status --directory /absolute/project
```

If both databases contain independent history, keep them separate and perform
an application-specific merge under review. File concatenation or replacement
is not a valid SQLite migration.

## Central kanban registry

The v3 default is `<project>/.hseos/config/projects.json`. Inspect the previous
registry explicitly, copy it while no central side-car is running, and validate
every project path:

```bash
hseos kanban-central list --registry /absolute/legacy/projects.json
mkdir -p /absolute/project/.hseos/config
test ! -e /absolute/project/.hseos/config/projects.json && \
  cp /absolute/legacy/projects.json /absolute/project/.hseos/config/projects.json
hseos kanban-central list --directory /absolute/project
```

An intentionally shared registry can continue to use `--registry <absolute>` or
`HSEOS_REGISTRY_PATH`; the choice is explicit and is not the default.

## Workflow and capability catalogs

Run the compiler after installing v3:

```bash
hseos agent-core compile --directory /absolute/project
hseos agent-core verify --directory /absolute/project
```

The reader accepts a version 1 workflow registry during the v3 compatibility
window and deterministically supplies `kind` and sequential execution metadata.
Persisted canonical registries must use `version: 2` and
`schema_version: "2.0"`.

A compiled-only capability catalog that has `profiles.yaml` and
`components.yaml` but no `surfaces.yaml` remains readable. Unknown lifecycle
intent is classified conservatively as compatibility; required baselines remain
core. The next compiler run writes `surfaces.yaml`, after which strict lifecycle
validation applies. Canonical capability sources must always contain all three
files.

## Hooks

Recompilation activates
`sessionstart-all-session-track-register-project-store`. The prior machine-store
identifier remains visible only as deprecated migration metadata and is not
emitted to platform adapters. Custom automation that refers to hook IDs must be
updated to the project-store identifier.

## Remote state UI access

Direct non-loopback HTTP is no longer supported, including when a bearer token
is configured. Bind the side-car to its loopback default and place an
authenticated TLS reverse proxy in front of it. The proxy may inject the bearer
header from the environment variable selected with `--auth-token-env`.

The unauthenticated `/health` endpoint is intentionally minimal: it contains
only status, server marker, and managed-instance identifier. All data, asset,
and event routes remain protected when bearer authentication is enabled.

## Compatibility and rollback

- Version 1 workflow input and missing compiled surface metadata are bounded
  compatibility inputs for v3. Their removal requires a later major release and
  an explicit governance decision.
- Explicit legacy state and registry paths remain supported; implicit
  machine-scoped discovery does not.
- To roll back, stop v3 side-cars, restore the backed-up v2 artifacts, and run
  the v2 compiler. Do not let two versions write the same SQLite database.

Record the source paths, backup timestamp, validation commands, and compiler
result in the migration pull request so downstream consumers can verify the
transition.
