# Capability governance artifacts

The canonical graph and the discovery corpus have different authority:

- `registry.yaml` composes repository-owned graph fragments and is authoritative after
  deterministic validation.
- `reference-corpus.json` pins the portfolio sources that every capability discovery must
  inspect. It is `discovery-only` and cannot create ownership, publication, or adoption.
- `schemas/` defines the machine contracts for both surfaces.

Validate the local contracts and inspect candidate sources:

```bash
node scripts/governance/validate-capability-graph.js --json
node scripts/governance/validate-capability-reference-corpus.js --json
node scripts/governance/validate-capability-reference-corpus.js --query messaging.event-envelope
```

To verify every reference against its pinned Git object, pass one
`--repository-root repo.id=/absolute/path` per source and add `--require-all`. Missing roots
are deferred by default so the HSEOS repository remains independently distributable.

Candidate coverage is not adoption. A product becomes a verified consumer only through a
repository-owned fragment, a published immutable package version, and installation evidence.
