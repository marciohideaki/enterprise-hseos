# G1 Checkpoint — Independent Refutation Closed

**Status:** completed
**Baseline:** `cfdcbbe692816aebca4623a3c878bb6c088ba664`
**Risk class:** reversible cleanup and local plugin materialization; no operational database, deployment, security policy, or external system changed

## Refutations corrected

- Active plugin definitions fail closed before compile, install, or publication when identity, surfaces, conformance declarations, or behavior tests are invalid.
- Compile and install execute the declared behavior suite; a failing test writes neither manifest, marketplace entry, nor installed plugin.
- Install materializes `plugin.json`, `README.md`, and every declared surface for both Claude and Codex plugin roots.
- Dual-vendor install prepares both complete trees before exposure and restores both prior destinations if either coordinated swap fails.
- Inactive installed plugins are removed from vendor discovery and preserved under each vendor's `disabled/` quarantine, independent of the selected compile target.
- Marketplace catalogs and the compiled manifest derive from the same validated active-manifest set.
- ADR-0022 and ADR-0023 make the compatibility schedule satisfiable by gating release `R` on the 30-day zero-use observation and a 2026-10-31 latest activation date.
- The stale completion event and ignored-log-only evidence are explicitly invalidated by the append-only event stream.

## Durable verification record

Validated snapshot command:

```text
./scripts/governance/worktree-manager.sh validate harness-unification-refutation-fixes
```

Result on 2026-08-21:

- exit code: `0`
- governed quality gates: `0` failures, `1` warning
- warning: two pre-existing unresolved placeholders in `src/hsm/workflows/3-solutioning/create-epics-and-stories/templates/epics-template.md`
- plugin marketplace: `32` passed, `0` failed
- compiler hooks/adapters: `34` passed, `0` failed
- lint: passed with zero warnings
- `git diff --check master`: passed
- validation log SHA-256: `c0ad4c14ca2d021cea61909bd394bd10ee32c6911e9d2c8f8a6825e3762eef73`

The runtime log is intentionally ignored and is not the evidence source. This versioned checkpoint preserves the command, result, exception, focused-suite counts, and content hash needed to audit that run.

## Independent verification boundary

The independent verifier found the missing surface materialization, missing compile/install behavior enforcement, contradictory G1 evidence, and impossible compatibility timing. Those findings drove this correction. A final read-only verification is required against this exact corrected snapshot before integration.

## Rollback

Revert the G1 correction commit. Installed-plugin replacement uses a fully populated staging directory before swapping the local vendor destination. Inactive copies are preserved in `disabled/`; no operational state was mutated.
