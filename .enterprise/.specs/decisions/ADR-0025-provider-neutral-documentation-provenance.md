# ADR-0025: Provider-Neutral Documentation Provenance

## Status

Accepted on 2026-08-28 by explicit human authorization.

## Context

HSEOS documentation contained historical product comparisons, external
provenance language, and a provider reference that the human authority has
designated as restricted. Those statements made internally owned capabilities
appear derived from another harness or framework and allowed a product
comparison to substitute for HSEOS requirements and evidence.

The affected material includes accepted ADRs. The normal append-only ADR rule
protects decision history from silent semantic rewrites, while the explicit
restriction requires the designated reference to be removed from all narrative
documentation. Both requirements cannot be satisfied without a narrowly
governed redaction exception.

## Decision

HSEOS documentation describes capabilities exclusively through HSEOS-owned
requirements, contracts, decisions, and reproducible evidence.

Documentation must not:

- attribute an HSEOS capability to an external harness or framework;
- describe HSEOS work as a port, fork, copy, adaptation, derivation, or
  absorption of an external harness or framework;
- include a provider or product reference designated as restricted by human
  authority;
- use cross-product parity as evidence of HSEOS completeness.

The affected accepted ADRs may receive a one-time content-neutral redaction.
The redaction must preserve each decision, status, constraints, and operational
consequences. Git history remains the audit record of the exact textual change.
This exception does not authorize future semantic edits to accepted ADRs.

Runtime-only identifiers, implementation symbols, executable configuration,
and compatibility tests remain outside the narrative-documentation rule. They
may retain provider-specific identifiers where changing them would alter a
runtime contract. Narrative documentation must refer to those boundaries in
provider-neutral terms whenever an exact identifier is unnecessary.

Automated validation scans narrative documentation content and filenames for
the restricted reference and for claims of derivation from an external harness
or framework.

## Alternatives Considered

### Keep accepted ADR text unchanged

Rejected because the repository would continue to publish the prohibited
reference and the misleading provenance narrative.

### Add only a new ADR and leave historical documents untouched

Rejected because a superseding rule would not remove the prohibited material
from documentation that remains directly discoverable.

### Rename provider-specific runtime contracts

Rejected for this documentation change because it would alter executable
profiles, configuration, tests, and compatibility contracts without a runtime
migration requirement.

### Remove historical records entirely

Rejected because deletion would destroy decision evidence and violate the ADR
lifecycle. Content-neutral redaction preserves the decisions and their Git
history.

## Consequences

### Positive

- HSEOS capability claims are grounded in its own contracts and evidence.
- Narrative documentation no longer exposes the restricted reference.
- Historical decisions retain their status and technical meaning.
- Automated validation prevents silent reintroduction.

### Negative

- Some historical evidence lists become less specific about external fixtures.
- Runtime identifiers can differ from the neutral names used in narrative docs.
- Reviewers must use Git history when auditing the exact redacted wording.

## Mitigations

- Keep protocol names, evidence counts, hashes, and HSEOS acceptance criteria
  where they remain useful without exposing restricted provenance.
- Limit redaction to wording and documentation filenames; do not change runtime
  behavior or compatibility contracts in this decision.
- Require the documentation-neutrality test in the standard test chain.
- Continue enforcing the normal append-only ADR rule after this one-time
  authorized redaction.

## References

- `.enterprise/policies/documentation-policy.md`
- `.enterprise/policies/adr-policy.md`
- `_graph/agentic-framework/A12-COMPLETION-AUDIT.md`
- `_graph/agentic-framework/state/checkpoints/`
- `test/test-documentation-neutrality.js`
