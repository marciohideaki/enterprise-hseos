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
previous artifact by SHA-256. Evidence schema v2 also binds the complete chain to one report schema,
database mode, telemetry/state/manifest path set, manifest validity, release SHA, configuration
digest, candidate start day, required server set and day count. A changed release or observation
scope must start a new evidence directory; it cannot silently continue an earlier G9 window. Replay,
ambiguous transaction residue, unsafe permissions, malformed envelopes, filename/timestamp
disagreement, scope drift, or a broken chain fail closed. Retain the emitted artifact and binding
digests in the supervisor log as external anchors for the newest chain member. Degraded reports are
also captured: durable evidence never converts monitor health into cutover authority.

Prepare a deterministic hourly systemd user-unit plan without writing or enabling anything:

```sh
node tools/cli/hseos-cli.js compatibility-observe-plan \
  --directory /absolute/path/to/project \
  --evidence-directory /absolute/private/path/compatibility-observation \
  --json
```

The plan validates the project, Node executable, CLI and evidence paths; derives a project-specific
unit name; and renders a persistent hourly timer plus a hardened networkless oneshot service. The
service disables update checks, requires the current hour to be healthy, writes only to the declared
evidence directory and sends the JSON result and binding digest to the supervising journal. Paths
with spaces or systemd metacharacters are escaped using directive-specific rules. The emitted plan
always says `plan_only: true` and `activation_authorized: false`; it does not create the evidence
directory, write unit files, reload systemd or enable the timer.

This command copies the live database and WAL into a private snapshot, verifies that their content
did not change during the copy, and opens only that copy in SQLite query-only mode. It never opens
or mutates the operational files, initializes tables, records a heartbeat, runs migrations, or emits
cutover readiness. Its progress counter includes only complete UTC days after
`first_candidate_complete_utc_day`, requires all 24 hourly buckets for all four server IDs, and
resets after a gap or any legacy request. Even at 30/30 it reports `ready_for_cutover: false` because
the stable-snapshot audit and explicit human gate remain separate.

HSEOS does not install or enable a recurring job through either observation command. Creating the
private evidence directory, independently verifying the unit on the target host, installation,
enablement, journal retention and rollback remain explicit operational deployment decisions.

## Downstream evidence packaging

Package externally collected release, inventory and consumer artifacts without manually writing
the audit envelope:

```sh
node tools/cli/hseos-cli.js compatibility-evidence-pack \
  --manifest /absolute/private/collection.json \
  --directory /absolute/project \
  --output-directory /absolute/private/new-bundle \
  --require-ready
```

The command requires the complete canonical observation manifest under the selected project's
`.hseos/state`, plus an absent output directory beneath an existing private parent outside that
state directory. It reads every
source through a stable non-linked descriptor, copies source bytes with mode `0600`, derives
consumer counts from the two inventory artifacts, and publishes the evidence envelope last. It
never writes under `.hseos/state`, changes a source artifact, invents a consumer, or grants cutover.
The release SHA and configuration digest come from the observation manifest rather than from the
collection request. `--require-ready` returns status 2 when a truthful inventory still contains a
legacy consumer.

The canonical collection manifest has the following strict shape. Both required surfaces must be
present exactly once. Release artifacts, inventories and consumer attestations are canonical JSON.

```json
{
  "schema_version": 1,
  "evidence_only": true,
  "cutover_authorized": false,
  "release_window": {
    "activation_release": "R",
    "compatibility_release": "R+1",
    "opened_at": "2026-07-01T00:00:00.000Z",
    "closed_at": "2026-08-20T23:59:59.000Z",
    "activation_artifact": {
      "source_path": "/absolute/private/release-r.json",
      "media_type": "application/json"
    },
    "compatibility_artifact": {
      "source_path": "/absolute/private/release-r-plus-1.json",
      "media_type": "application/json"
    }
  },
  "surfaces": [
    {
      "surface_id": "installer-v4-detection",
      "inventory": {
        "source_path": "/absolute/private/installer-v4-inventory.json",
        "media_type": "application/json"
      },
      "attestations": []
    },
    {
      "surface_id": "plugin-catalog-v1",
      "inventory": {
        "source_path": "/absolute/private/plugin-v1-inventory.json",
        "media_type": "application/json"
      },
      "attestations": [
        {
          "consumer_id_sha256": "<64 lowercase hexadecimal characters>",
          "source_path": "/absolute/private/plugin-consumer.json"
        }
      ]
    }
  ]
}
```

An inventory artifact declares `schema_version`, `surface_id`, `observed_at`, and a bounded
`consumers` array. A legacy item has only `consumer_id_sha256` plus `disposition: "legacy"`. A
migrated item additionally declares `observed_at` and the SHA-256 of its attestation:

```json
{
  "schema_version": 1,
  "surface_id": "plugin-catalog-v1",
  "observed_at": "2026-08-20T12:00:00.000Z",
  "consumers": [
    {
      "consumer_id_sha256": "<64 lowercase hexadecimal characters>",
      "disposition": "migrated",
      "observed_at": "2026-08-20T12:00:00.000Z",
      "attestation_sha256": "<SHA-256 of the canonical attestation JSON>"
    }
  ]
}
```

Each attestation must repeat the surface, hashed consumer identity, observation instant and exact
R/R+1 identifiers, and must set `migration_verified: true`. The packer cross-checks all of those
facts and requires an exact one-to-one mapping between migrated inventory entries and source
attestations. A consumer observation cannot be newer than the inventory, source files cannot be
reused across evidence roles, and the R/R+1 artifacts must have distinct bytes. The resulting
hashes remain review anchors: a human must still verify the external meaning of the supplied
artifacts.

Packaging currently fails closed on Windows until equivalent ACL privacy validation exists. On
POSIX, the observation manifest, collection manifest and every source artifact must not be
group/world-writable; the private output parent and SHA-addressed observation release directory
must have no group/other access. The release's `RELEASE_SHA` marker is read through the same stable
file boundary and must match the observation manifest.

## Read-only audit

Run:

```sh
node tools/cli/hseos-cli.js compatibility-audit --directory /path/to/project
```

Use `--json` for machine-readable evidence and `--require-ready` in a gate that should exit non-zero until all pre-authorization evidence is complete. Downstream plugin and installer migration evidence defaults to `.hseos/state/harness-g9-downstream-evidence.json`; use `--downstream-evidence /absolute/path/evidence.json` only when the evidence is stored separately. The audit:

1. reads the legacy MCP telemetry database without creating tables or recording observations;
2. backs up the operational state database into a private temporary directory;
3. applies pending migrations only to that copy;
4. runs SQLite integrity checks and compares a digest of every pre-existing table;
5. hashes both databases plus WAL, SHM, or rollback-journal sidecars before and after their read-only checks;
6. scans internal JavaScript, shell, and PowerShell runtime surfaces for retired symbols and still-active legacy entrypoints.
7. validates a canonical, integrity-checked downstream release-window artifact for the exact `plugin-catalog-v1` and `installer-v4-detection` surfaces and binds it to the observation release SHA and configuration digest.

The downstream artifact is evidence-only and has this strict shape:

```json
{
  "schema_version": 1,
  "evidence_only": true,
  "cutover_authorized": false,
  "release_sha": "<40 lowercase hexadecimal characters>",
  "configuration_sha256": "<64 lowercase hexadecimal characters>",
  "release_window": {
    "activation_release": "R",
    "compatibility_release": "R+1",
    "opened_at": "2026-07-01T00:00:00.000Z",
    "closed_at": "2026-08-20T23:59:59.000Z",
    "activation_artifact": {
      "artifact_path": "artifacts/release-r.json",
      "media_type": "application/json",
      "sha256": "<SHA-256 of the referenced file>"
    },
    "compatibility_artifact": {
      "artifact_path": "artifacts/release-r-plus-1.json",
      "media_type": "application/json",
      "sha256": "<SHA-256 of the referenced file>"
    }
  },
  "surfaces": [
    {
      "surface_id": "installer-v4-detection",
      "legacy_consumers": 0,
      "migrated_consumers": 1,
      "inventory_artifact": {
        "artifact_path": "artifacts/installer-v4-inventory.json",
        "media_type": "application/json",
        "sha256": "<SHA-256 of the referenced file>"
      },
      "inventory_observed_at": "2026-08-20T12:00:00.000Z",
      "attestations": [
        {
          "consumer_id_sha256": "<64 lowercase hexadecimal characters>",
          "artifact": {
            "artifact_path": "artifacts/installer-v4-consumer-01.json",
            "media_type": "application/json",
            "sha256": "<SHA-256 of the referenced file>"
          },
          "observed_at": "2026-08-20T12:00:00.000Z"
        }
      ]
    },
    {
      "surface_id": "plugin-catalog-v1",
      "legacy_consumers": 0,
      "migrated_consumers": 1,
      "inventory_artifact": {
        "artifact_path": "artifacts/plugin-v1-inventory.json",
        "media_type": "application/json",
        "sha256": "<SHA-256 of the referenced file>"
      },
      "inventory_observed_at": "2026-08-20T12:00:00.000Z",
      "attestations": [
        {
          "consumer_id_sha256": "<64 lowercase hexadecimal characters>",
          "artifact": {
            "artifact_path": "artifacts/plugin-v1-consumer-01.json",
            "media_type": "application/json",
            "sha256": "<SHA-256 of the referenced file>"
          },
          "observed_at": "2026-08-20T12:00:00.000Z"
        }
      ]
    }
  ]
}
```

The file must use canonical pretty-printed JSON with a final newline, be a real single-link file, and not be writable by group or other users. Every artifact reference is a normalized relative path under the adjacent `artifacts/` directory; the audit opens that regular single-link file through a stable descriptor, bounds its size, verifies its media type and computes the declared SHA-256. Missing, escaping, aliased, shared-writable, changed or digest-mismatched artifacts fail closed. Both surfaces require a verified inventory artifact, zero remaining legacy consumers, and observations inside the closed release window. `migrated_consumers` may be zero when that inventory proves there were no downstream consumers; otherwise it must exactly equal the number of unique hashed consumer attestations. The bundle hashes are review anchors, not self-authorizing proof: the human gate still evaluates the external facts captured by those artifacts before cutover.

For safety, evidence databases must be stable regular files with one link and no SQLite sidecars. Stop writers and checkpoint WAL or rollback journals first; symlinks, hardlinks, and live `-wal`, `-shm`, or `-journal` files fail closed before SQLite opens the file.

Even when every automated check passes, the report says `awaiting-human-authorization`; it never grants the ADR gate itself.

## Stop conditions

- Do not activate migrations 005-007 against an operational path through development or audit code.
- Do not delete schema v4 data, MCP compatibility, plugin v1 readers, or installation detectors based only on repository-local tests.
- Missing telemetry, incomplete hourly coverage, any legacy use, changed migration data, active internal writers, absent or scope-drifted downstream evidence, or absent human authorization blocks cutover.
- Rollback before cutover is removal of the isolated change. After cutover, follow ADR-0022: preserve the ledger and rebuild a compatibility projection before switching readers.
