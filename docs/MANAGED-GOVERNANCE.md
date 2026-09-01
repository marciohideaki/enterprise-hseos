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
