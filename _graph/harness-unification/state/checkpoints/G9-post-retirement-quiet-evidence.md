# G9 Post-Retirement Quiet Evidence Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Distinguish legacy request time from observation heartbeat time
**Status:** Observing; 0/30 complete zero-use UTC days
**Authority:** Diagnostic hardening only; no compatibility, schema, protocol or runtime cutover

## Live evidence

- The latest legacy request in the shared telemetry database occurred at
  `2026-08-24T21:07:20.167Z` on `axon_bridge`. The other three required
  servers last recorded legacy requests at approximately `21:07:02Z`.
- All four compatibility observer services restarted at
  `2026-08-24T21:13:11Z` from release
  `5df935d180cf57a36ad321a40bdb09c7552cbe35`.
- No legacy request was recorded after that restart through the read-only
  snapshots captured at `21:57Z`, `22:07Z` and `22:13:24Z`. The final snapshot
  reported 66.1 informational quiet minutes.
- The `22:07Z` snapshot was intentionally degraded because the first
  15-minute observer tick for the new UTC hour had not occurred yet. The
  monitor therefore failed closed instead of carrying the previous hour's
  heartbeat forward.
- At `22:13:12Z`, all four services wrote the expected first heartbeat for the
  hour. The `22:13:24Z` snapshot recovered automatically to healthy 4/4
  coverage with no integrity error and no new legacy request.
- The manifest remained valid and continued to declare
  `cutover_authorized: false`.

## Monitor hardening

`compatibility-observe` now reports today's per-server `first_seen_at` and
`last_seen_at`, plus the cross-server `latest_legacy_use_at` and
`legacy_quiet_minutes` across the complete retained telemetry window. These
values come from bounded usage rows rather than heartbeat rows, and the latest
request remains visible after a UTC-day rollover. Invalid, inconsistent or
future usage timestamps degrade observation health.

The quiet duration is diagnostic only. It cannot create partial-day progress,
repair a missing hourly bucket or override any legacy use earlier in the same
UTC day. Only 24-hour coverage for all four servers across complete UTC days
can advance G9.

## Validation

- Compatibility observation tests: 8/8 focused and 15/15 combined audit plus
  observation tests passed.
- MCP 2026 adapter tests: 23/23 passed.
- Full governed quality gate: 0 failures, 1 pre-existing documentation warning.
- Local gate log: `.logs/validation/gate-20260824T221917.log`, SHA-256
  `8b78e6aa63967d9683d67867a22916c4cf4d40b419cb92221e1d0bf5e9c3ca18`.

## Boundary

The deployment day `2026-08-24` remains invalid because it contains legacy
requests. Progress remains 0/30, readiness remains false, and G9 still requires
30 complete consecutive zero-use days, a stable-snapshot final audit and
explicit human cutover authorization.
