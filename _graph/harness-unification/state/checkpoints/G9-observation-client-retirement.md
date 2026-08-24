# G9 Observation Client Retirement Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Reversible retirement of global legacy MCP clients
**Status:** Applied; observation remains at 0/30 complete zero-use days
**Authority:** Explicit human authorization on 2026-08-24 to disable the legacy HSEOS MCP clients and begin the observation window

## Applied configuration

- Codex: `hseos-governance`, `hseos-state-tracking`, `hseos-swarm` and
  `hseos-axon-bridge` are preserved as definitions with `enabled = false`.
- Claude: the three stdio HSEOS entries were removed from the user MCP catalog
  and from `allowedMcpServers`.
- Axon, Playwright, filesystem and every unrelated MCP remained unchanged.
- Timestamped pre-G9 copies of the three edited user configuration files were
  retained for rollback.
- Observation services remain active so heartbeats continue independently of
  client request traffic.

Existing Codex/Claude sessions retain the configuration loaded at process
start and were not terminated. Consequently 2026-08-24 already contains
legacy requests and cannot count as a zero-use day. Once all pre-change
sessions close normally, the earliest candidate streak begins on the next
complete UTC day.

## Read-only monitor evidence

- Status: `legacy-use-observed`.
- Observation health: healthy; 4/4 required servers present and fresh.
- Manifest: valid; release
  `5df935d180cf57a36ad321a40bdb09c7552cbe35`.
- Progress: 0/30 complete zero-use days; 30 remaining.
- Cutover readiness/authorization: false.

## Boundary

No observer service, operational schema, database, compatibility code or
protocol was removed. This checkpoint starts observation hygiene only. G9
cannot complete until 30 complete consecutive zero-use days and all remaining
audit/human gates pass.
