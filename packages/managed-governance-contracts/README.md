# `@hseos/managed-governance-contracts`

Infrastructure-neutral v1 contracts for the HSEOS managed governance control plane.

The package contains strict Zod schemas for artifacts, immutable versions, relations, rules,
bindings, releases, snapshots, acceptance receipts, session leases, decisions and import plans. It
also provides deterministic canonical JSON and SHA-256 digest helpers.

Shadow-readiness contracts (`GovernanceReleaseManifestSchema`, `ExternalSignerBindingSchema`,
`ExternalSignatureEvidenceSchema`, `PatchPublicationBundleManifestSchema`, `ShadowReceiptSchema`,
`ReadinessReportSchema`, `ManagedNetworkProfileSchema`, `RecoveryProfileSchema`,
`RecoveryRehearsalEvidenceSchema`) add the wire shapes for release signing, deterministic patch
publication, cross-adapter shadow receipts, the 30-day readiness projection, the shared-network
admission profile and recovery rehearsal evidence. They carry the same `schema_version`/unknown-field
rejection guarantees as every other contract in this package, plus schema-level invariants specific
to their own risk: a `ReadinessReportSchema` can never set `authorizes_enforcement` to anything but
`false`; a `ManagedNetworkProfileSchema` in `shared-network` mode rejects an empty, malformed or
allow-all (`0.0.0.0/0`, `::/0`) client allowlist instead of silently widening it; a
`RecoveryRehearsalEvidenceSchema` cannot claim `within_declared_profile` without every evidence check
passing, and must explicitly confirm its target is disposable.

## Contract boundary

- Every top-level contract requires `schema_version: 1`.
- Unknown fields and unsupported versions fail closed.
- Parsed values are deeply frozen.
- Identifiers, content, arrays and nested JSON have explicit bounds.
- Contract code has no database, filesystem, HTTP or MCP dependency.
- `managed-enforced` is a reserved wire value. This package does not activate it.

```js
const { GovernanceRuleSchema, digestCanonical, parseContract } = require('@hseos/managed-governance-contracts');

const rule = parseContract(GovernanceRuleSchema, input, 'governance rule');
const digest = digestCanonical(rule);
```

Canonical JSON accepts only lossless JSON values. It rejects cycles, sparse arrays, non-finite
numbers, negative zero, custom prototypes, symbols and unpaired UTF-16 surrogates. Object keys are
serialized in lexical order so the same semantic object produces the same bytes and digest.

Published governance authority remains outside this package. The contracts describe data; they do
not approve, publish, assign or enforce it.
