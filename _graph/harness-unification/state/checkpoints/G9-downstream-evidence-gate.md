# G9 Downstream Evidence Gate Checkpoint

**Artifact type:** Governed goal checkpoint
**Scope:** Downstream plugin and installer compatibility release-window evidence
**Status:** Audit capability complete; downstream bundle and cutover remain absent
**Governing documents:** Enterprise Constitution; ADR-0022; ADR-0023; automated-validation policy
**Authority:** Evidence validation only; no installation, migration, compatibility removal or cutover

## False green closed

`compatibility-audit` previously omitted the downstream release-window evidence
required by G9 for `plugin-catalog-v1` and `installer-v4-detection`. All other
automated gates could therefore make `ready_for_human_gate` true while that
evidence was absent. The audit now requires the exact two-surface downstream
bundle and binds it to the observation release SHA and configuration digest.

The public CLI accepts an explicit `--downstream-evidence` path and otherwise
uses `.hseos/state/harness-g9-downstream-evidence.json`. Absence, scope drift,
unknown fields, malformed release windows, non-zero legacy consumers or an
incomplete surface set fail closed.

## Evidence semantics

- The envelope is strict canonical JSON and always declares
  `evidence_only: true` and `cutover_authorized: false`.
- Release R, release R+1, both surface inventories and every migrated consumer
  attestation reference real local artifacts through normalized relative paths
  under the adjacent `artifacts/` directory.
- Each artifact is size-bounded, regular, single-link, non-shared-writable and
  hash-verified from the bytes actually read. JSON artifacts must parse.
- Zero downstream consumers is representable without inventing a migrated
  consumer: the mandatory inventory artifact remains the evidence anchor.
- A descriptor-bound read uses no-follow semantics and compares descriptor and
  pathname identity before and after the read, rejecting concurrent replacement.
- A complete bundle advances only to `awaiting-human-authorization`; referenced
  external facts still require human verification and cannot authorize cutover.

## Independent refutation

The first adversarial review returned `NOT READY`: a syntactically valid bundle
could use fictitious hashes without locating artifacts, the renderer overstated
the evidence as verified, and the path-based read had a TOCTOU window. Those
findings were corrected with local artifact references, descriptor-bound reads,
release artifacts, a concurrent-swap regression and non-authorizing language.

The second review returned `READY` with no residual blocker, high, medium or low
finding. It confirmed artifact confinement and byte verification, stable
descriptor/path identity, and the separation between automated readiness and
human cutover authority.

## Deterministic verification

- Focused audit tests: 10 passed, 0 failed.
- Compatibility suite: 24 passed, 0 failed.
- ESLint: passed with zero warnings.
- `git diff --check`: passed.
- Complete governed quality gate: 0 failures, 1 historical documentation
  warning. Log: `.logs/validation/gate-20260824T233349.log`; SHA-256:
  `d72eddc350879458325b611b1e4a8d559f50cc367218aab95a2770cbac9cdf9f`.
- Live read-only audit: observation scope valid; downstream evidence absent;
  operational writers/sidecars active; legacy runtime references active;
  `ready_for_human_gate: false`; `activation_authorized: false`.

## Stop condition and rollback

No downstream bundle, external attestation, operational file or runtime was
created or changed. Before integration, discard this task commit to remove the
gate. G9 still requires 30 complete zero-use UTC days, stopped writers and a
stable migration snapshot, zero internal legacy runtime references, a real
downstream bundle reviewed by the human authority, and explicit cutover approval.
