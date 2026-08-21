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
