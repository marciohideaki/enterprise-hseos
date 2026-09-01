# Managed Governance

Managed governance is an optional HSEOS control-plane capability for structured governance data,
organization and repository assignments, immutable releases, audit evidence, and policy comparison.
The approved delivery posture is `managed-shadow`: repository-owned governance remains authoritative
and the managed result is observational.

## Lifecycle boundaries

| Surface | Lifecycle | Authority |
| --- | --- | --- |
| Contracts and client | Opt-in module | Validates bindings, queries shadow decisions, and reads a bounded last-known-good snapshot |
| Preflight | Pre-activation candidate | Reports parity or degradation; it cannot block local execution |
| Control plane | Opt-in sidecar | Owns relational managed state behind versioned application ports |
| Console | Opt-in sidecar | Uses the HTTP API only and has no database or Git credentials |
| Repository files | Active portable path | Remain the published governance authority for this delivery |

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

## Project binding

A consumer supplies an explicit project-local binding and proves it against
`repository-contract.yaml` before any network request. Bindings contain identifiers and trusted key
references, never bearer tokens, passwords, database connection strings, or private keys. The client
has no home-directory or machine-global fallback.

The read-only MCP adapter uses `.hseos/config/managed-governance.json` when deliberately configured.
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

## Data and operational boundaries

The first delivery is an opt-in, loopback-only shadow capability and does not define a production
database profile. A production profile must be approved separately before non-loopback exposure or
use with institutional data. Until that approval:

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
node --test test/managed-governance/postgres.integration.test.js
node --test test/managed-governance/import-apply.test.js test/managed-governance/seed-current-governance.test.js
node --test test/managed-governance/conformance.test.js test/managed-governance/security.test.js
```

The PostgreSQL integration command runs migrations, seed/import, idempotent retry, tenant isolation
and batch rollback when `HSEOS_GOVERNANCE_TEST_DATABASE_URL` points to an ephemeral test database;
otherwise it reports an explicit skip. Backup restore is deliberately not advertised as executable
until a production database profile and recovery runbook receive separate approval.
