# Harness Unification State

- **Status:** in progress
- **Current node:** G6 — unified entry-point adapters and scheduler/exclusivity
- **Baseline:** `cfdcbbe692816aebca4623a3c878bb6c088ba664`
- **Completed evidence:** G0 ADR acceptance; G1 cleanup/plugin hardening; G2 gated relational ledger in `state/checkpoints/G2-ledger.md`; G3 rebuildable projections in `state/checkpoints/G3-projections.md`; G4 governed execution core in `state/checkpoints/G4-execution-core.md`; G5 MCP 2026 adapter in `state/checkpoints/G5-mcp-adapter.md`
- **Accepted decisions:** ADR-0022 and ADR-0023, explicitly approved by project authority on 2026-08-21
- **Pending gate:** operational schema/data migration remains prohibited until a separate human authorization
- **Next reversible node:** G6 adapter wiring for CLI, hooks, the four MCP servers, and SWARM, plus scheduler/exclusivity semantics; modern protocol activation remains gated on full parity
