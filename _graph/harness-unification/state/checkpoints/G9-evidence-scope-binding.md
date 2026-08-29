# G9 Evidence Scope Binding Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Prevent cross-release or cross-target evidence-chain continuity
**Status:** Implementation complete; operational capture not deployed
**Authority:** Evidence integrity only; no compatibility, schema, protocol or runtime cutover

## Gap

The first durable-capture envelope chained canonical reports by timestamp and
artifact digest, but it did not prove that every member observed the same
release and operational scope. A caller could therefore append a report from a
different database, manifest, configuration or server set and retain an
apparently continuous chain.

## Correction

Evidence schema v2 derives one canonical observation binding from each report:

- report schema and verified snapshot mode;
- telemetry, operational-state and release-manifest paths;
- manifest validity, release SHA, configuration digest and first candidate day;
- sorted required server IDs and required complete-day count.

The envelope stores both the binding and its SHA-256. Verification reconstructs
the binding from the embedded report, checks the digest and requires the same
binding across every chain member. The append path compares the new report with
the established chain before creating an artifact. Any scope drift fails closed
and requires a separate evidence directory rather than silently preserving G9
continuity.

## Verification

- Two reports from the same release and target preserve one binding digest.
- Configuration, release SHA, telemetry path and server-set drift are rejected.
- Direct binding-envelope tampering is rejected during chain verification.
- Existing replay, canonical encoding, hash-chain, private-mode, symlink,
  source-non-mutation and non-authorization regressions remain green.
- Compatibility tests: 17/17 passed; full governed quality gate: 0 failures
  and 1 historical placeholder warning. Log:
  `.logs/validation/gate-20260824T224808.log`, SHA-256
  `502b8d197305f9943a2cc99061dcbc0daa1c5cd1114c1eed3463c27b9820cc04`.

## Boundary

No live evidence directory, timer, service, database, manifest or provider was
changed. This closes an integrity gap in future evidence collection; it does
not advance the temporal 0/30 counter or authorize A13/G9 cutover.
