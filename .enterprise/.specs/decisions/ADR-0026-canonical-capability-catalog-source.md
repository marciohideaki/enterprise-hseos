# ADR-0026: Canonical Capability Catalog Source

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

ADR-0016 introduced capability profiles and components under
`.agents/capabilities/`. The repository subsequently established
`.enterprise/` as the governance source and `.agents/` as read-only compiler
output. Leaving capability manifests as an exception creates two competing
authoring models and makes generated artifacts appear canonical.

Existing installations may contain only the compiled `.agents` tree. Public
profile and component identifiers are already consumed by install plans and
must remain stable while the source location is normalized.

## Decision

The canonical capability catalog lives under
`.enterprise/governance/capabilities/`. The agent-core compiler materializes
that directory into `.agents/capabilities/` as portable output.

The runtime loader prefers a complete canonical catalog and reports which
source kind it selected. It accepts a compiled-only catalog as a bounded
compatibility path for existing installations. An incomplete canonical catalog
does not shadow a complete compiled catalog.

Profile IDs, component IDs, schema version 2.0, resolver behavior, and install
plan serialization remain unchanged. This decision supersedes only the source
location declared by ADR-0016; the rest of ADR-0016 remains authoritative.

## Alternatives Considered

### Keep the capability catalog as a permanent `.agents` exception

Rejected because contributors would continue editing compiler output directly
and the repository would retain inconsistent source-of-truth rules.

### Move the files without a compatibility reader

Rejected because compiled-only installations would fail immediately even
though their schema and identifiers remain valid.

### Rename profiles or components during the move

Rejected because normalization does not require a public contract break.

## Consequences

### Positive

- Capability governance follows the same source-to-compiled flow as skills,
  hooks, and plugins.
- Generated artifacts can be verified byte-for-byte against their source.
- Existing compiled-only installations remain readable.
- Public selectors and serialized install plans remain stable.

### Negative

- The compiler owns one additional synchronized output directory.
- The compatibility reader temporarily supports two physical layouts.
- Contributors must edit the enterprise source and regenerate the portable
  tree.

## Mitigations

- Validate both required YAML documents before replacing compiled output.
- Stage and replace the compiled directory transactionally.
- Test canonical precedence, compiled-only compatibility, and byte parity.
- Expose source selection as a diagnostic without adding it to install plan
  serialization.

## References

- `ADR-0007-compiler-v2-multi-adapter-contract.md`
- `ADR-0016-capability-packaging.md`
- `AGENTS.md`
- `.enterprise/governance/capabilities/README.md`
- `tools/cli/lib/capability-catalog.js`
- `tools/cli/installers/lib/core/agent-core-compiler/sources/capabilities-source.js`
