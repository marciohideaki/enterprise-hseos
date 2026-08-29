# G9 Durable Observation Capture Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Recurring-friendly persistence of compatibility observation evidence
**Status:** Implementation complete; operational scheduling not deployed
**Authority:** Evidence capture only; no compatibility, schema, protocol or runtime cutover

## Capability

`compatibility-observe --evidence-directory <absolute-path>` can append monitor
reports to a dedicated private directory. The default command remains read-only
and preserves its prior report shape when the option is absent.

The writer validates the monitor-only and non-authorizing invariants before any
directory creation. It then serializes a canonical JSON envelope, links it to
the preceding artifact by SHA-256, writes through an exclusive `0600` temporary
file, fsyncs, and atomically renames it. A private lock serializes concurrent
captures. Evidence must advance monotonically and is verified before every
append.

Verification rejects symlink traversal, hard links, public directory modes,
oversized files, non-canonical encoding, ambiguous filenames or stale
transaction residue, filename/timestamp disagreement, malformed envelopes,
chain discontinuity, replay and any report that could claim cutover authority.
The digest returned by each capture is the external anchor for the newest
member and should be retained by the supervising journal.

## Validation

- Focused compatibility observation tests cover private modes, atomic append,
  two-member chaining, source-database non-mutation, replay, tampering, stale
  transaction residue, symlink traversal, unsafe permissions and state-path
  rejection.
- Captured healthy or degraded evidence always retains `monitor_only: true`,
  `ready_for_cutover: false`, and `cutover_authorized: false`.
- Compatibility tests: 17/17 passed; full governed quality gate: 0 failures
  and 1 historical placeholder warning. Log:
  `.logs/validation/gate-20260824T223245.log`, SHA-256
  `19f3c060309f54f3de562f32745d2f01fafef01ec325e9e0b51ea11d88582401`.
- No scheduler, service, database, manifest or live evidence directory was
  installed or changed by this implementation.

## Boundary

This capability makes an externally scheduled observation auditable; it does
not itself schedule observations and does not satisfy G9. The active gate still
requires 30 complete consecutive zero-use UTC days, a final stable-snapshot
audit and explicit human cutover authorization.
