# Harness Unification State

- **Status:** in progress
- **Current node:** G9 — compatibility retirement
- **Baseline:** `cfdcbbe692816aebca4623a3c878bb6c088ba664`
- **Completed evidence:** G0 ADR acceptance; G1 cleanup/plugin hardening; G2 gated relational ledger in `state/checkpoints/G2-ledger.md`; G3 rebuildable projections in `state/checkpoints/G3-projections.md`; G4 governed execution core in `state/checkpoints/G4-execution-core.md`; G5 MCP 2026 adapter in `state/checkpoints/G5-mcp-adapter.md`; G6 unified entrypoints and scheduler in `state/checkpoints/G6-entrypoints.md`; G7 capability schema v2 and profile-exact materialization in `state/checkpoints/G7-capabilities.md`; G8 canonical schema-v2 plugin catalog and atomic vendor publication in `state/checkpoints/G8-plugins.md`
- **Accepted decisions:** ADR-0022 and ADR-0023, explicitly approved by project authority on 2026-08-21
- **G9 readiness checkpoint:** reversible audit and internal dead-compatibility cleanup recorded in `state/checkpoints/G9-readiness.md`; G9 is not completed
- **Pending gate:** 30 complete zero-use days, zero internal legacy runtime references, stable migration snapshot, downstream compatibility evidence, and separate human authorization
- **Next reversible node:** remain on G9; destructive operational schema/data changes, compatibility deletion, modern protocol activation, and G10 remain gated
