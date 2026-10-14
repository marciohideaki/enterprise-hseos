# ADR-0048 — DG-27 scope: integrity checksums vs. irreversible PII hashing

**Status:** Proposed. Not ratified. Ratification belongs to the owners of the source (governance and privacy); acceptance of this ADR activates nothing on its own.
**Date:** 2026-10-14
**Authors:** Platform Architecture Owners (proposal prepared for review)
**Affects Standards:** Data Governance & LGPD Standard (§3.3, rule DG-27; version 1.0 → 1.1)
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

DG-27 v1.0 reads: "MD5, SHA-1 and unsalted hashes are forbidden for PII." The rule sits under *Irreversible Hashing* (§3.3), but its wording does not delimit its purpose. An independent diagnosis found no authoritative delimitation of integrity checksums in the inspected pins.

Consumers need a SHA-256 digest of a complete, protected command or record for integrity, chain continuity and idempotency identity. In that use the original representation stays protected and recoverable for the contracted purpose, and the digest is never used to identify, match or anonymise a person. Whether the broad phrase also reaches that use is undecided, and the contextual reading is plausible but not authoritative. This change narrows the literal reach of a currently valid global prohibition, so it requires an explicit versioned decision and is not an editorial fix.

## Decision

We will amend DG-27 to version 1.1 with the exact text of the accompanying change:

1. MD5 and SHA-1 remain forbidden for PII.
2. Unsalted irreversible hashes of PII used for identity matching, personal-field deduplication, cohort/blacklist analysis or replacement of the original personal value remain forbidden, and salt is required for those uses.
3. A cryptographic SHA-256 checksum used exclusively for integrity, chain continuity or idempotency identity of a complete command/record is a separate purpose from irreversible PII transformation. The distinction applies only when the protected original representation is retained/recoverable for that contracted purpose and command equality is verified against the complete canonical bytes, not against the digest alone.
4. Such a checksum MUST NOT serve as a person/subject matching key, replace required tokenization, or claim anonymity.
5. Classification, authorized access, protection and finite retention/erasure apply to the checksum, its associations and every copy. Deriving a digest never declassifies PII.
6. The clarification does not permit MD5/SHA-1, unprotected checksums, implicit exceptions, retention renewal through copies, or bypass of DG-26/tokenization. It does not certify chain retirement or successor-proof protocols, which keep their own finite lifecycle.

## Consequences

### Positive
- Removes the ambiguity between PII hashing and integrity checksums without weakening classification, protection or retention.
- Keeps salt mandatory for every identification/matching use.

### Negative / Trade-offs
- Reduces the literal reach of the current global prohibition.
- Introduces a purpose test that reviewers must apply case by case.

### Risks
- A digest reused as a matching key would defeat the clarification. Mitigation: item 4 forbids it explicitly, and the exception requires equality over complete canonical bytes.
- Retention could be extended through copies. Mitigation: item 5 and item 6 forbid renewal through copies.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Data Governance & LGPD Standard | §3.3, DG-27 | Clarifies (v1.0 → v1.1) |

## Compliance

- [ ] Approved by the governance and privacy owners of the source
- [ ] Affected standard updated to reference this ADR
- [ ] New producer pin published and consumed by downstream compositions
- [ ] Activation date: pending ratification
- [ ] Review date: 2027-01-14

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep the broad prohibition and redesign identity/chain mechanisms of consumers (for example salt) | Changes published designs and schemas and needs new review and compatibility work. Remains the fallback if the owners decide the prohibition also covers integrity checksums of PII content. |
| Leave the wording unchanged and rely on the contextual reading | The reading is plausible but not authoritative, and consumers stay unresolved against DG-27. |
