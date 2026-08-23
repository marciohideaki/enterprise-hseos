# G1 Checkpoint — Cleanup and Truthful Plugin Surfaces

**Status:** superseded by `G1-independent-correction.md`
**Baseline:** feature commit `87e40e8`
**Risk class:** reversible cleanup; no operational state or security policy changed

## Changes

- Removed the unused `BaseIdeSetup.flattenFilename` method.
- Removed `tools/docs/fix-refs.md`, whose only purpose was mapping retired workflow names and which had no consumers.
- Reclassified four non-functional marketplace candidates from `active` to `scaffolded`.
- Prevented inactive plugins from being installed, emitted to vendor catalogs, or registered in the compiled manifest.
- Wired the existing dual-format plugin emitter into the agent-core compiler.
- Corrected scaffolded/implemented status drift for hook handlers, MCP Axon bridge, native MCP servers, and adapter SDK.
- Corrected plugin authoring destinations to canonical `.enterprise/governance` sources.

## Original verification (superseded)

- These original counts and the untracked log reference attached to event `harness-unification-0002` are not accepted as completion evidence.
- Independent verification refuted the original completion claim. Event `harness-unification-0003` invalidates it, and the durable replacement checkpoint records the corrected implementation and current results.
- Existing unrelated `format:check` baseline remains non-green in `state-session.js` and `agent-state-dal.js`; neither file was changed by G1.

## Residual boundary

The candidates remain in the internal registry because ADR-0009 explicitly defines them as the initial marketplace set. Eliminating or replacing those definitions is deferred to the architectural acceptance/retirement nodes. Previously installed copies require explicit deactivation by the compiler; this behavior is added and verified in the follow-up checkpoint.

## Rollback

Revert the G1 task commit. No schema, database, external system, or user-global state was changed.
