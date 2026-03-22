# ADR-0010 — Execution Observability Surface

**Status:** Accepted
**Date:** 2026-03-22
**Authors:** HSEOS Operations
**Affects Standards:** Runtime Operations, Governance Evidence, Operational Read Models
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS is acquiring runtime state, policy enforcement, and validation evidence, but operators still lack a
native consolidated surface to inspect execution posture quickly.

Without that surface:

1. runtime state remains fragmented across logs, validation outputs, and data files
2. blocked or invalidated execution paths are harder to inspect operationally
3. human reviewers lack a single read model for status, evidence, and governance posture

Wave 1 requires an HSEOS-native operational surface without introducing a separate product identity.

## Decision

HSEOS will introduce an **Execution Observability Surface** as a native read-first operational layer.

Effective immediately:

- HSEOS exposes an `ops` CLI command group for operational read models
- the observability surface aggregates runtime missions, validation evidence, and governance posture
- read models remain file-backed and local to the repository
- the surface is intentionally read-first in this wave

Public CLI surface:

- `hseos ops summary`
- `hseos ops runs`
- `hseos ops evidence`
- `hseos ops blockers`

## Consequences

### Positive
- Operators gain a consistent read model for runtime and governance posture.
- Observability remains HSEOS-native and auditable.
- Blockers and evidence become easier to review before human decisions.

### Negative / Trade-offs
- This wave stops short of a graphical console.
- The read model depends on existing runtime and evidence files being present.

### Risks
- Users may expect a full control plane immediately.
  Mitigation: document this as a foundational observability surface, not a complete console.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| Runtime Operations | Operational inspection | Adds consolidated read models for runtime missions |
| Governance Evidence | Reviewability | Aggregates validation and evidence into inspectable summaries |
| Operational Read Models | Read-first posture | Establishes a non-mutating surface for wave 1 |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Activation date: 2026-03-22
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Wait for a full graphical console | Leaves current runtime and governance state operationally fragmented |
| Expose raw files only | Not a coherent operational surface |
| Build a separate productized dashboard first | Breaks HSEOS coherence and naming discipline |
