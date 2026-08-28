# ADR-0028: Project-Scoped Observability Side-Cars

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

Session tracking and the central kanban registry implicitly used files under a
user home directory. That contradicted the standalone invariant and made local
runtime behavior depend on host state. The state UI also allowed non-loopback
binding without authentication and described itself as read-only while opening
and migrating the SQLite database in write mode.

The side-car lifecycle commands invoked shell pipelines with interpolated port
values. Those paths expanded the command-injection surface and duplicated
process-management behavior already hardened elsewhere in the CLI.

## Decision

Session state and the central project registry are project-scoped by default:

- sessions use `<project>/.hseos/state/project.db`;
- the multi-project registry uses
  `<project>/.hseos/config/projects.json`;
- session hooks resolve the active Git root and skip execution outside a
  project;
- a host-wide registry remains possible only through an explicit path or
  environment override.

The state UI opens existing SQLite databases read-only and never creates or
migrates them. Non-loopback binding requires a bearer token supplied by a named
environment variable. The token is never accepted as a command-line value.
When authentication is configured, all HTTP and SSE routes require it.

Side-car lifecycle commands validate ports and use argument-vector process
calls plus `SIGTERM`; they do not interpolate shell commands.

## Alternatives Considered

### Keep the home-directory defaults

Rejected because host-global state would remain load-bearing and installations
would not be standalone.

### Allow unauthenticated non-loopback read-only access

Rejected because run names, paths, events, and project metadata are sensitive
even when the endpoint cannot mutate them.

### Let the UI bootstrap an empty database

Rejected because schema ownership belongs to the state runtime, not a read
side-car.

## Consequences

### Positive

- Default operation is project-local and reproducible.
- The UI is truthfully read-only.
- Remote exposure fails closed without authentication.
- Port values cannot become shell commands.
- Multi-project aggregation is explicitly a side-car configuration.

### Negative

- Existing host-wide registries require an explicit `--registry` path or
  `HSEOS_REGISTRY_PATH` during migration.
- The UI requires the state database to exist before startup.
- Browser access behind bearer authentication normally requires an
  authenticated reverse proxy that injects the header.

## Mitigations

- Preserve explicit absolute paths and the environment override.
- Keep loopback as the default binding.
- Return clear startup errors for missing databases, invalid ports, and absent
  authentication.
- Test authentication, read-only startup, project-scoped defaults, and central
  aggregation.

## References

- `ADR-0006-standalone-architecture.md`
- `ADR-0014-telemetry-export-bridge.md`
- `ADR-0027-explicit-hook-and-workflow-contracts.md`
- `tools/state-ui-server/index.js`
- `tools/state-ui-server/lib/registry.js`
- `tools/cli/lib/sidecar-lifecycle.js`
