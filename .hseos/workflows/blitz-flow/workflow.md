# Blitz Flow

## Intent
Compressed solo dev pipeline from brief to working code in a single session.
Collapses the full HSEOS delivery flow into a sequence executable by one agent without team handoffs.
Same governance standards as the full pipeline — fewer ceremonies, not fewer gates.

## Owner
BLITZ

## Phase Model
0. Vault Context Load
   BLITZ reads strategic context from the second-brain vault before the session begins.
   Condition: `second_brain.enabled = true` (SKILL-QUICK.md §1 detection).
   Reads: `_memory/current-state.md`, `_knowledge/goals.md`, relevant `_decisions/` files.
   Fallback: vault unavailable → skip silently, proceed with HSEOS sources.

1. Session Brief
   BLITZ captures scope: what is being built, why, and what "done" means.
   No NYX formal discovery — BLITZ self-elicits requirements in compressed form.
   Output: one-paragraph scope statement + acceptance criteria list.

2. Architecture Check
   BLITZ checks if the change requires an ADR (architectural, breaking, security-posture change).
   If yes: draft ADR before writing any code. Human approval required before Phase 3.
   If no: proceed with existing architecture.

3. Implementation
   BLITZ implements story with TDD. One story = one session maximum (context-policy).
   Follows GHOST implementation standards: red-green-refactor, traceable commits.
   Commit hygiene enforced: conventional format, no AI attribution trailers.

4. Validation
   BLITZ runs available quality gates: lint, tests, type checks.
   Minimum bar: tests pass, lint clean. No skipping gates to meet velocity targets.

5. Knowledge Consolidation (second-brain, if enabled)
   Condition: `second_brain.enabled = true`

   BLITZ steps:
   1. Identify if any architectural decision was made (ADR drafted + approved in Phase 2)
   2. If yes: create `{vault_path}/_decisions/hseos/{YYYY-MM-DD}-{kebab-name}.md` (SKILL.md §2.1)
   3. Identify any cross-project learning from this session (SKILL.md §4 strategic threshold)
   4. If qualifying learning: create `{vault_path}/_learnings/hseos-{topic}.md` (SKILL.md §2.2)
   5. Prompt user: "Sessão concluída. Execute `/end-session` no seu segundo-cérebro para capturar o contexto completo."

   Stop condition: Phase 5 is optional enrichment. Never block delivery if vault write fails.

## Gates
- Hard-fail: ADR required but not approved before implementation
- Hard-fail: tests fail at end of Phase 4
- Clean-stop: scope is too large for one session → split into multiple BLITZ sessions

## Session Size Constraint
BLITZ scope must fit in one session (context-policy Tier 1). If the brief requires more than one session:
- Split into independent stories
- Each story gets its own BLITZ session
- Cross-session continuity via `_memory/current-state.md` vault reads at Phase 0

## Stateful Execution
- persist run state under `.hseos/data/runs/blitz-<id>/state.yaml`
- resume from Phase 3 if interrupted (implementation is the only resumable phase)
- Phase 0 (vault read) always re-runs on resume
