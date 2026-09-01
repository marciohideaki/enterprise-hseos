# Managed Governance

Managed governance is an optional HSEOS control-plane capability for structured governance data,
organization and repository assignments, immutable releases, audit evidence, and policy comparison.
The approved delivery posture is `managed-shadow`: repository-owned governance remains authoritative
and the managed result is observational.

## Lifecycle boundaries

| Surface              | Lifecycle                | Authority                                                                                  |
| -------------------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| Contracts and client | Opt-in module            | Validates bindings, queries shadow decisions, and reads a bounded last-known-good snapshot |
| Preflight            | Pre-activation candidate | Reports parity or degradation; it cannot block local execution                             |
| Control plane        | Opt-in sidecar           | Owns relational managed state behind versioned application ports                           |
| Console              | Opt-in sidecar           | Uses the HTTP API only and has no database or Git credentials                              |
| Repository files     | Active portable path     | Remain the published governance authority for this delivery                                |

The reserved enforcement mode is accepted only as a wire-compatible value. It returns
`enforcement_unavailable`, performs no managed enforcement, and requires a separate future approval
before its status can change.

## Selection

No built-in profile selects managed governance. Operators must request the module explicitly:

```bash
hseos install-plan --components runtime:managed-governance-client --json
hseos install --components runtime:managed-governance-client
```

Selection records install intent. It does not create a database, start a sidecar, write a binding,
or activate a policy mode.

## Release installation and quick verification

Install the immutable GitHub asset before selecting the optional client:

```bash
release_version=3.2.0
release_dir="$(mktemp -d)"
gh release download "v${release_version}" --repo marciohideaki/enterprise-hseos --dir "${release_dir}"
(cd "${release_dir}" && sha256sum -c SHA256SUMS)
npm install --global "${release_dir}/hseos-${release_version}.tgz"
hseos --version
hseos install-plan --components runtime:managed-governance-client --json
```

Check `npm prefix --global` before installing. Use `sudo npm install --global`
only for an intentionally system-managed, non-writable prefix. With NVM, fnm,
asdf, Volta, or a user-owned prefix, install without `sudo` and keep all
subsequent `npm root --global` and `hseos` commands in that same runtime context.

The expected version is `3.2.0`. The plan must list
`runtime:managed-governance-client`; it must not select a managed profile or
start a sidecar. Apply the client to a project only after reviewing that plan:

```bash
hseos install --directory . --components runtime:managed-governance-client
hseos status
```

For a non-interactive smoke in a disposable repository, make every side effect
explicit:

```bash
hseos install --directory . \
  --components runtime:managed-governance-client \
  --tools none \
  --no-git-hooks \
  --yes
```

This still installs the mandatory portable baseline and records the optional
component in `.hseos/config/capability-selection.yaml`. The managed client
libraries remain owned by the verified global HSEOS distribution; they are not
copied into the consumer repository as standalone modules.

## End-to-end PostgreSQL installation

The package is deployment-agnostic. It consumes a PostgreSQL database supplied
by the operator; it does not install PostgreSQL, start a container, assume a
hostname, choose an organization or database name, or discover credentials from
the host. The same flow works with a local service, shared development service,
cluster-managed PostgreSQL or an external managed service.

### 1. Provision an empty database and two login roles

Run the following as a PostgreSQL administrator, replacing every example value.
The migration role requires `CREATEROLE` because the immutable migrations create
the bounded `hseos_governance_*` NOLOGIN roles. The runtime role receives only
membership in `hseos_governance_application` during setup.

```sql
CREATE ROLE example_hseos_migrator LOGIN CREATEROLE;
CREATE ROLE example_hseos_runtime LOGIN;
CREATE DATABASE example_hseos_governance OWNER example_hseos_migrator;
\password example_hseos_migrator
\password example_hseos_runtime
```

The `\password` commands prompt interactively and do not persist credentials in
shell history or this configuration. In automated environments, use the
PostgreSQL service's secret manager instead.

Password values above are interactive examples only. Do not store executed SQL
or connection strings in the repository. Platform-managed environments may
provide the database and roles through their normal infrastructure workflow.

### 2. Create the secret-free sidecar configuration

Copy the packaged template into the target project and replace identifiers only:

```bash
install -m 600 \
  "$(npm root --global)/hseos/tools/managed-governance-control-plane/config.example.json" \
  .hseos/config/managed-governance-sidecar.json
```

The configuration contains environment-variable names, never their values. Set:

- `database.migration_connection_string_env` — migration-role PostgreSQL URL;
- `database.runtime_connection_string_env` — runtime-role PostgreSQL URL;
- `organization.id` and `organization.display_name` — tenant identity;
- `control_plane.host` and `control_plane.port` — loopback endpoint;
- `control_plane.authentication_token_env` — bearer-token environment name;
- binding issuer/key identifiers — references only, never key material.

The example values are illustrative and are not package defaults.

### 3. Export secrets only to the process environment

```bash
export HSEOS_GOVERNANCE_MIGRATION_DATABASE_URL='postgresql://example_hseos_migrator:...@db-host:5432/example_hseos_governance'
export HSEOS_GOVERNANCE_RUNTIME_DATABASE_URL='postgresql://example_hseos_runtime:...@db-host:5432/example_hseos_governance'
export HSEOS_GOVERNANCE_TOKEN='replace-with-at-least-16-random-characters'
```

Use the environment names declared in your configuration; the names above are
only the packaged example. Prefer a process supervisor or secret manager over
interactive exports outside disposable development environments.

### 4. Commit the installed governance source

The importer accepts only a verified `repository-contract.yaml`, a fixed Git
commit and clean canonical governance roots. Review and commit the files created
by `hseos install` through the repository's normal governed workflow before seed.

### 5. Apply migrations, seed and binding idempotently

```bash
hseos governance setup install \
  --database-config .hseos/config/managed-governance-sidecar.json \
  --actor managed-governance-setup \
  --json
```

The command performs configuration validation, migrations, runtime-role grant,
deterministic seed and parity verification, then atomically writes:

- `.hseos/config/managed-governance-binding.json`;
- `.hseos/config/managed-governance.json` for the read-only MCP adapter.

Running the same command again must report zero migrations and an unchanged
catalog. No generated file contains either database URL or bearer token.

### 6. Start the database-backed control plane and console

```bash
hseos governance server start \
  --database-config .hseos/config/managed-governance-sidecar.json \
  --json
```

Open the configured loopback URL, such as `http://127.0.0.1:4319/`. The same
origin serves the console, `/health` and `/api/v1/*`. Stop the foreground process
with `Ctrl+C`. Non-loopback binding and `managed-enforced` remain unavailable.

### 7. Validate the complete installation

```bash
curl --fail --silent http://127.0.0.1:4319/health
curl --fail --silent 'http://127.0.0.1:4319/api/v1/artifacts?limit=50'
hseos governance catalog status --endpoint http://127.0.0.1:4319 --json
hseos status
```

Successful health reports migration state `current`, projection state `current`,
`ready: true`, `mode: managed-shadow` and a non-zero artifact count. The MCP
adapter reads the generated project-local endpoint and never receives database
credentials.

### What remains operator-owned

- PostgreSQL service lifecycle, database creation, backup, restore and retention;
- secret distribution and rotation;
- TLS/authenticated reverse proxy if a future approved external profile is used;
- production identity federation, telemetry and signing-key custody;
- Git review and merge of publication artifacts.

## Project binding

A consumer supplies an explicit project-local binding and proves it against
`repository-contract.yaml` before any network request. Bindings contain identifiers and trusted key
references, never bearer tokens, passwords, database connection strings, or private keys. The client
has no home-directory or machine-global fallback.

Setup writes `.hseos/config/managed-governance.json` only after migrations, seed and binding succeed.
The read-only MCP adapter uses it when deliberately configured.
It accepts only a loopback HTTP endpoint and remains stateless. Mutation credentials belong to the
control-plane application boundary and are never exposed to MCP or the browser console.

## Operational behavior

- The sidecar binds to loopback by default.
- Import planning is read-only and deterministic; applying a plan requires explicit authenticated
  mutation context.
- Online shadow reads use bounded timeout, retry, response-size, and circuit-breaker contracts.
- Offline comparison may use a digest-verified snapshot only within the binding's age limit and is
  always marked degraded.
- Missing, expired, corrupt, substituted, or identity-mismatched snapshots never become valid.
- The console is served with a restrictive browser policy and calls only versioned HTTP routes.

The local CLI exposes discovery and shadow operations under `hseos governance`. Starting the local
server shell does not imply database readiness; health remains non-green until an explicit
database-backed composition satisfies migrations and projection checks.

## Publication and rollback

Managed drafts and database state do not silently replace published repository governance.
Publication produces reviewable Git artifacts, and merge remains a separate human decision.
Rollback disables the project binding or sidecar while portable governance continues unchanged;
catalog history and audit evidence remain append-only.

To roll back the CLI in this environment, download and verify `v3.0.3` with the
same procedure above, then install `hseos-3.0.3.tgz` globally. Disabling the
optional binding or sidecar is sufficient to restore portable-only behavior;
do not reverse applied migrations.

## Data and operational boundaries

The first delivery is an opt-in, loopback-only shadow capability. It defines a portable operational
configuration but not a production platform topology. A production profile must be approved
separately before non-loopback exposure. Until that approval:

- identifiers used in audit records are technical, pseudonymous actor references;
- bearer credentials, secret values and personal content are forbidden in bindings, snapshots,
  logs, metrics and audit metadata;
- audit and outbox retention is not shortened automatically; deletion requires a separately
  approved retention schedule and evidence-preserving procedure;
- PostgreSQL backup, restore, recovery-point and recovery-time targets remain deployment-owned and
  are not represented as active HSEOS capabilities;
- structured operational telemetry remains a deployment integration requirement. The local shell
  exposes health state but does not claim production logging or metrics readiness.

## Non-interactive validation commands

The following commands validate the implemented data lifecycle without activating a managed
deployment:

```bash
HSEOS_GOVERNANCE_TEST_DATABASE_URL='postgresql://...' node --test test/managed-governance/postgres.integration.test.js
node --test test/managed-governance/installation.test.js
node --test test/managed-governance/import-apply.test.js test/managed-governance/seed-current-governance.test.js
node --test test/managed-governance/conformance.test.js test/managed-governance/security.test.js
```

The PostgreSQL integration command runs migrations, seed/import, idempotent retry, tenant isolation
and batch rollback when `HSEOS_GOVERNANCE_TEST_DATABASE_URL` points to an ephemeral test database;
otherwise it reports an explicit skip. Backup restore is deliberately not advertised as executable
until a production database profile and recovery runbook receive separate approval.
