# Managed Governance Session Preflight

**Status:** Approved for implementation in `managed-shadow` on 2026-09-01
**Decision:** `.enterprise/.specs/decisions/ADR-0032-managed-governance-control-plane.md`

## Objective

Close the managed-shadow session-start loop by comparing the project-local Constitution and
repository identity with the catalog projection exposed by the configured control plane. The local
files remain authoritative and the check never blocks a session.

## Scope

- A reusable session-preflight application service.
- A CLI surface: `hseos governance session preflight`.
- A read-only MCP tool: `get_governance_session_preflight`.
- A non-blocking `SessionStart` hook for adapters that support the event.
- An explicit manual fallback for adapters without native session hooks.
- Atomic, project-local evidence under `.hseos/state/managed-governance/`.

## Requirements

- **FR-001:** The preflight MUST validate `repository-contract/v1`, the managed binding and the
  project-local query configuration before contacting the control plane.
- **FR-002:** The preflight MUST compute the local Constitution digest using the same UTF-8, BOM and
  line-ending normalization as the deterministic importer.
- **FR-003:** The preflight MUST compare repository identity, Constitution source path and content
  digest with the active remote catalog projection.
- **FR-004:** The result MUST use exactly one of `equivalent`, `drift_detected`,
  `remote_unavailable`, `invalid_local_contract` or `not_configured`.
- **FR-005:** Every completed check MUST state `mode: managed-shadow`,
  `authoritative_source: local`, `blocking: false`, a stable reason code and the compared digests
  when available.
- **FR-006:** CLI and native session-hook execution MUST atomically replace a bounded latest-evidence
  document under `.hseos/state/managed-governance/session-preflight.json` with owner-only
  permissions. The evidence MUST contain no credentials or environment values.
- **FR-007:** Drift, invalid configuration and unavailability MUST be visible advisories and MUST
  return a successful process status in `managed-shadow`.
- **FR-008:** The MCP tool MUST be stateless and read-only; it MUST return the same comparison
  semantics without persisting evidence.
- **FR-009:** The native hook MUST self-suppress when managed governance is not configured and MUST
  have a five-second bounded runtime.
- **FR-010:** Adapters without `SessionStart` MUST document the CLI preflight as the explicit
  session-start fallback.
- **FR-011:** The increment MUST NOT activate, emulate or prepare a blocking
  `managed-enforced` path.

## Acceptance Criteria

1. Matching local and remote Constitution digests produce `equivalent`.
2. A changed local or remote digest produces `drift_detected` while local authority is preserved.
3. An unreachable sidecar produces `remote_unavailable` without blocking.
4. Repository or binding identity divergence produces `invalid_local_contract` without a network
   request.
5. A missing managed configuration produces `not_configured` and the hook emits no advisory.
6. CLI, MCP and hook tests demonstrate the same reason-code vocabulary.
7. Existing portable and managed-governance conformance suites remain green.

## Non-Goals

- Starting or repairing PostgreSQL or the sidecar automatically.
- Importing changed governance automatically.
- Replacing Markdown governance at runtime.
- Activating session leases, signed releases or `managed-enforced`.
