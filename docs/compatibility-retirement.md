# Compatibility Retirement

HSEOS treats compatibility as a temporary, observable adapter boundary. It is never a second source of truth and it cannot authorize an operational cutover.

The authoritative decisions are ADR-0022 and ADR-0023. Their owner is `platform-governance`; activation must occur no later than 2026-10-31, compatibility removal is due by 2026-11-30, and any extension requires a new accepted ADR with usage evidence.

## Current inventory

| Compatibility surface                         | Classification              | Current disposition            | Retirement evidence                                                                                      |
| --------------------------------------------- | --------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| MCP `2024-11-05` adapter                      | operational                 | retained and metered           | 30 complete consecutive zero-use days for every native server, with all 24 hourly observations per day   |
| Operational state schema v4 and legacy writes | operational                 | retained; v5-v7 remain pending | successful dry-run over a backup, zero internal legacy writers/callers, and explicit human authorization |
| Plugin catalog v1/generated-source input      | external installation       | retained                       | downstream usage evidence and one documented release window                                              |
| Legacy v4 installation detection              | external installation       | retained                       | downstream migration evidence and one documented release window                                          |
| IDE underscore/`Colon` command naming         | internal dead compatibility | removed                        | repository scan proves zero callers; dash naming is the only generated format                            |

Generic fallbacks are not removed merely because they are named “fallback.” Platform adapters, optional input defaults, recovery behavior, and generated compatibility pointers remain when they serve a current contract.

## Observation deployment

Every running legacy entrypoint must write to one telemetry database. Resolution is deterministic:

1. absolute `HSEOS_LEGACY_TELEMETRY_DB`;
2. `mcp-legacy-usage.db` beside the resolved `HSEOS_STATE_DB`;
3. project-local `.hseos/state/mcp-legacy-usage.db` only when neither operational path is configured.

`HSEOS_LEGACY_TELEMETRY_DB` intentionally rejects relative paths. A client process may start an
MCP server with the client's current working directory, so using that directory as an implicit
shared authority would fragment the 30-day evidence.

Before starting the observation window:

- deploy the same reviewed release SHA to every configured entrypoint;
- configure `governance`, `project_state`, `swarm`, and `axon_bridge` with the same absolute
  telemetry path, whether or not all four are exposed by one client bundle;
- restart each MCP client/server process and verify all four server IDs appear in the current UTC
  hour in `mcp_legacy_observation_hourly`;
- inventory other launchers and project/user-scoped MCP configuration so an older unmetered
  entrypoint cannot remain reachable;
- record the release SHA, configuration digest, telemetry path and first complete UTC day. The
  partial deployment day never counts.

Starting telemetry is not protocol or schema activation. Production remains on MCP `2024-11-05`
and operational schema v4 until G9 and the separate A13 cutover gate are satisfied.

### Live observation monitor

While the writers remain active, run:

```sh
node tools/cli/hseos-cli.js compatibility-observe --directory /path/to/project
```

Use `--json` for automation and `--require-current-hour` to exit with status 2 when the release
manifest is inconsistent or any required server is absent or stale. The default freshness limit is
75 minutes and can be changed with `--max-staleness-minutes`.

An external supervisor such as cron or a systemd timer may append each report to a dedicated
evidence directory:

```sh
node tools/cli/hseos-cli.js compatibility-observe \
  --directory /path/to/project \
  --evidence-directory /absolute/private/path/compatibility-observation \
  --require-current-hour
```

Capture is opt-in: without `--evidence-directory`, the command writes no report. The directory must
be absolute, private, outside `.hseos/state`, and free of symlink traversal. Each canonical JSON
artifact is created with mode `0600`, atomically renamed, ordered by `as_of`, and linked to the
previous artifact by SHA-256. Replay, ambiguous transaction residue, unsafe permissions, malformed
envelopes, filename/timestamp disagreement, or a broken chain fail closed. Retain the emitted digest
in the supervisor log as the external anchor for the newest chain member. Degraded reports are also
captured: durable evidence never converts monitor health into cutover authority.

This command copies the live database and WAL into a private snapshot, verifies that their content
did not change during the copy, and opens only that copy in SQLite query-only mode. It never opens
or mutates the operational files, initializes tables, records a heartbeat, runs migrations, or emits
cutover readiness. Its progress counter includes only complete UTC days after
`first_candidate_complete_utc_day`, requires all 24 hourly buckets for all four server IDs, and
resets after a gap or any legacy request. Even at 30/30 it reports `ready_for_cutover: false` because
the stable-snapshot audit and explicit human gate remain separate.

HSEOS does not install or enable a recurring job through this command. Scheduling, log retention and
the evidence-directory lifecycle remain explicit operational deployment decisions.

## Read-only audit

Run:

```sh
node tools/cli/hseos-cli.js compatibility-audit --directory /path/to/project
```

Use `--json` for machine-readable evidence and `--require-ready` in a gate that should exit non-zero until all pre-authorization evidence is complete. The audit:

1. reads the legacy MCP telemetry database without creating tables or recording observations;
2. backs up the operational state database into a private temporary directory;
3. applies pending migrations only to that copy;
4. runs SQLite integrity checks and compares a digest of every pre-existing table;
5. hashes both databases plus WAL, SHM, or rollback-journal sidecars before and after their read-only checks;
6. scans internal JavaScript, shell, and PowerShell runtime surfaces for retired symbols and still-active legacy entrypoints.

For safety, evidence databases must be stable regular files with one link and no SQLite sidecars. Stop writers and checkpoint WAL or rollback journals first; symlinks, hardlinks, and live `-wal`, `-shm`, or `-journal` files fail closed before SQLite opens the file.

Even when every automated check passes, the report says `awaiting-human-authorization`; it never grants the ADR gate itself.

## Stop conditions

- Do not activate migrations 005-007 against an operational path through development or audit code.
- Do not delete schema v4 data, MCP compatibility, plugin v1 readers, or installation detectors based only on repository-local tests.
- Missing telemetry, incomplete hourly coverage, any legacy use, changed migration data, active internal writers, or absent human authorization blocks cutover.
- Rollback before cutover is removal of the isolated change. After cutover, follow ADR-0022: preserve the ledger and rebuild a compatibility projection before switching readers.
