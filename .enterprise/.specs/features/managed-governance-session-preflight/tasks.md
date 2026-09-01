# Managed Governance Session Preflight — Tasks

## T01 — Contract and application service

- Add the strict result vocabulary and comparison service to the managed-governance client package.
- Reuse repository identity and binding validation.
- Implement safe Constitution normalization and bounded atomic evidence.
- `verify_step`: focused service tests pass for equality, drift and degraded outcomes.

## T02 — CLI and MCP surfaces

- Add `hseos governance session preflight` with canonical envelope output.
- Add the stateless read-only `get_governance_session_preflight` MCP tool.
- Preserve successful process status for all completed managed-shadow outcomes.
- `verify_step`: managed CLI and MCP suites pass.

## T03 — Session hook and portable fallback

- Add the canonical project-scoped handler and active non-blocking registry entry.
- Compile `.agents` and adapter outputs from `.enterprise` sources.
- Document the fallback command for adapters without native `SessionStart`.
- `verify_step`: handler and compiler-hook suites pass.

## T04 — Documentation and conformance

- Update installation, operational and MCP documentation with the new lifecycle.
- State clearly that PostgreSQL/sidecar must already be running and local Markdown remains
  authoritative.
- `verify_step`: documentation neutrality and package-surface checks pass.

## T05 — Governed closeout

- Run focused tests, real local preflight, formatting, full quality gates and adversarial review.
- Commit through the task worktree lifecycle, merge to the feature branch and prepare the governed
  PR/release flow under existing human authorization.
- `verify_step`: clean task worktree, recorded validation evidence and green PR checks.
