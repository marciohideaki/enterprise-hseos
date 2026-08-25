# G9 Downstream Evidence Packaging Checkpoint

**Artifact type:** Governed goal checkpoint  
**Scope:** Non-operational packaging of downstream plugin and installer release-window evidence  
**Status:** Packaging capability complete; real source artifacts and live bundle remain absent  
**Governing documents:** Enterprise Constitution; ADR-0022; ADR-0023; automated-validation policy  
**Authority:** Local evidence packaging only; no operational state write, compatibility removal or cutover

## Gap closed

The G9 audit could validate a finished downstream bundle but operators still
had to assemble its envelope and digests manually. That left a practical path
for inconsistent counts, mismatched attestations, partial publication or an
accidental write into the operational state directory.

`hseos compatibility-evidence-pack` now consumes a strict canonical collection
manifest, the selected project's canonical observation manifest, two release
artifacts, the exact two surface inventories and zero or more consumer
attestations. It publishes only to a new private directory outside
`.hseos/state` and never changes a source artifact.

## Evidence semantics

- The observation scope is derived from the project, not supplied as free-form
  release/configuration claims. Its schema, release path and SHA marker,
  state/telemetry paths, legacy schema/protocol, four-server set, services,
  clients, rollback and non-authorization state are checked.
- R and R+1 release artifacts are canonical JSON with distinct Git SHAs,
  predecessor and ordered publication timestamps bound to the window.
- Inventory artifacts are copied byte-for-byte. Legacy and migrated counts are
  derived from their strict consumer entries; the operator cannot override
  those counts.
- Every migrated consumer has exactly one canonical attestation whose byte
  digest, hashed identity, surface, timestamp and R/R+1 identifiers match the
  inventory. Zero-consumer inventories require no invented consumer.
- Stable non-linked reads, bounded sizes, unique source roles, `0600` files,
  a `0700` output and directory fsyncs precede publication of the evidence
  envelope. A failed build removes only the newly created output directory.
- Output under operational state and overwrite of an existing bundle fail
  before publication. Windows fails closed until equivalent ACL privacy
  validation exists.
- A bundle can become only `available-for-human-verification`;
  `cutover_authorized` remains false and truthful legacy consumers keep it
  incomplete.

## Independent refutation

The initial review returned **NOT READY**. It reproduced two material false
greens: a minimal fabricated observation manifest plus empty release artifacts
could produce a ready bundle, and an output below `.hseos/state` could be
written. It also identified the shared-writable observation anchor and missing
Windows ACL guarantee.

All findings became regressions. The final review returned **READY** with no
residual blocker, high or medium finding. It re-ran both original reproductions,
the shared-write case and the Windows fail-closed check.

## Deterministic verification

- Compatibility suite: 32 passed, 0 failed.
- Focused independent reproductions: 2 passed, 0 failed.
- ESLint and Prettier: passed with zero warnings.
- `git diff --check`: passed.
- Complete governed quality gate: 0 failures, 1 historical documentation
  warning. Log: `.logs/validation/gate-20260825T000006.log`; SHA-256:
  `8dac262e59b4916cad5720535a626ba121a4fab8b2a68cefea1070bc23508001`.

## Live boundary and required next action

No real collection manifest, R/R+1 artifact, inventory, attestation or output
bundle was created. The current live observation manifest and release SHA
marker are mode `0664`, so packaging correctly remains fail-closed until the
operator independently hardens those anchors and supplies externally verifiable
downstream artifacts. Those operational changes were not performed.

G9 still requires a real human-reviewed downstream bundle, 30 complete
zero-use UTC days, stopped writers and a stable migration snapshot, zero
internal legacy runtime references, and explicit cutover authorization.

## Rollback

Before integration, discard the task commit. After integration but before any
bundle is produced, revert the packer, CLI command, tests and documentation.
No operational rollback is necessary because this node changed no live state.
