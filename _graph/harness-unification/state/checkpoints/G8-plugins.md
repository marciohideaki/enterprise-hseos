# G8 Checkpoint — Uniform Plugin Authority and Atomic Vendor Publication

**Status:** completed
**Completed:** 2026-08-21T16:38:41Z
**Scope:** canonical plugin catalog, schema v2, compiler synchronization, vendor publication, CLI lifecycle, tests, ADR, and documentation
**Operational data:** unchanged

## Delivered

- Established `.enterprise/governance/plugins/` as the single authoring authority and `.agents/plugins/` as its byte-exact generated neutral view.
- Made canonical synchronization transactional: registry, inactive manifests, active behavior tests, paths, and schema v2 are validated before the generated catalog is swapped. Invalid canonical input preserves the last valid output.
- Kept schema v1 only as a bounded legacy `.agents/plugins/` input for G9; canonical sources require v2 and unknown schema versions fail closed.
- Enforced exact registry and manifest shapes, SemVer 2.0, safe cross-platform paths, unique IDs/bundles/conformance fields, source authority, fixed emit targets, and containment after symlink resolution.
- Kept all four bundled candidates `scaffolded`; none appears in the compiled manifest, vendor indices, active directories, or install lifecycle.
- Made vendor publication one cross-vendor transaction over complete roots: indices, active directories, surfaces, and quarantine commit together or both prior roots are restored.
- Quarantined inactive and orphan installations, made repeated active/inactive cycles truthful, and rejected symlink/non-directory vendor roots, containers, plugin entries, README, surfaces, and behavior-test escapes.
- Normalized `extends` to syntax-validated provenance metadata only. G8 performs no network lookup or implicit behavior inheritance.

## Deterministic evidence

- `node test/test-plugin-marketplace.js`: **88 passed, 0 failed**.
- `node test/test-agent-core-compiler-hooks.js`: **34 passed, 0 failed**.
- `node test/test-capability-catalog.js`: **87 passed, 0 failed**.
- Canonical/generated comparison: **17/17 files byte-exact**.
- `npm run lint`: exit 0.
- `git diff --check`: exit 0.
- `./scripts/governance/quality-gates.sh --phase code --strict`: exit 0, **0 failures, 0 warnings**.
- Final quality log: `.logs/validation/gate-20260821T163719.log`.
- Final quality log SHA-256: `0a39097af860452bee2cdaa33b0f436f78e31a97a5f0275213dc28571875d751`.
- Operational DB SHA-256 remained `99852724d4c4ab0a378f5931380fc4dd85d13648952283c0fbaaec56523421bf`.

## Independent verification

Four adversarial rounds first found and then confirmed corrections for validation-before-swap, canonical v1 leakage, README and Windows traversal escapes, incomplete vendor materialization, doctor strictness, schema contradictions, aspirational `extends`, cross-vendor atomicity, quarantine cycles, stale symlinks, and symlinked vendor ancestors. The final independent verdict was **READY**, with zero residual findings.

## Safety and rollback

- No deployment, push, operational database migration, protocol activation, or production write occurred.
- Cleanup after a successful atomic vendor commit is best-effort and cannot roll back a complete published state.
- Rollback is the isolated G8 commit; the canonical catalog can regenerate neutral and vendor views deterministically.

## Handoff

G9 may measure and retire bounded compatibility readers, including plugin schema v1/generated-source fallback, only after proving zero internal callers. Operational schema/data deletion and modern protocol activation remain under the separate human gate.
