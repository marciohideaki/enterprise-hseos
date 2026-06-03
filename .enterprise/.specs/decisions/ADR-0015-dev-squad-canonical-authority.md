# ADR-0015 — dev-squad Canonical Authority Hierarchy

**Status:** Accepted
**Date:** 2026-06-03
**Authors:** Platform Governance
**Affects Standards:** SKILLS-REGISTRY source-of-truth claims; `.hseos/workflows/dev-squad/workflow.md` canonical pointer
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006 (standalone architecture — P1 single source of truth, P5 zero global path dependency)

---

## Context

The dev-squad protocol is the primary multi-agent execution surface in HSEOS. It is referenced across at least four distinct locations:

1. `~/.claude/skills/dev-squad/SKILL.md` — the personal global skill, which several files declared "canonical" or "authoritative".
2. `.agents/skills/dev-squad/{SKILL,QUICK}.md` — the compiled mirror inside the repo.
3. `.enterprise/governance/agent-skills/dev-squad/SKILL.md` (+ `SKILL-QUICK.md`) — the governance-layer source inside the HSEOS repo.
4. `.hseos/agents/swarm.agent.yaml` + `.hseos/workflows/dev-squad/workflow.md` — the HSEOS runtime execution surface.

Two concrete problems emerged from this distribution:

**ADR-0006 P1 violation.** ADR-0006 establishes that only `.agents/`, `.hseos/`, and `.enterprise/` are authoritative sources inside an HSEOS-enabled repository. Multiple files within HSEOS — including `SKILL.md` headers and workflow comments — declared `~/.claude/skills/dev-squad/SKILL.md` canonical or authoritative, directly contradicting the standalone-architecture principle.

**ADR-0006 P5 violation.** ADR-0006 P5 prohibits runtime assets from referencing `~/.claude` paths as canonical. The same references caused a concrete model-matrix drift: the personal global file carried a 5-tier effort model matrix while the compiled mirror carried a 4-effort model matrix. Because both were independently edited as "canonical", the divergence was silent and accumulated across sessions.

The drift class is reproducible: any edit applied to the global file as a canonical change will not propagate to the repo mirror, and vice versa. A clean-clone bootstrap of HSEOS from the repo must not require the operator's personal `~/.claude` state to be in any particular form.

---

## Decision

We will establish a single, explicit authority hierarchy for all dev-squad protocol assets.

**Tier 1 — Source of Truth:**
`.enterprise/governance/agent-skills/dev-squad/SKILL.md` and `SKILL-QUICK.md` are the sole authoritative definitions of the dev-squad protocol, model matrix, tier assignments, Commander/Squad contract, and wave governance invariants. All normative changes to the protocol are made here first.

**Tier 2 — Compiled Mirror (repo-internal):**
`.agents/skills/dev-squad/{SKILL,QUICK}.md` are auto-generated outputs of the HSEOS compiler from the Tier 1 source. They are hash-pinned in `.agents/manifest.yaml`. They must never be hand-edited. The compiler is the only permitted writer. SWARM (`swarm.agent.yaml`) and `workflow.md` consume exclusively from this tier.

**Tier 3 — External Mirror (non-HSEOS use only):**
`~/.claude/skills/dev-squad/{SKILL,SKILL-QUICK}.md` are a convenience mirror for non-HSEOS projects and bare Claude Code sessions that lack an `.hseos/` directory. Inside any HSEOS-enabled repository, this tier is explicitly NOT canonical. It must not be referenced as authoritative by any runtime asset in `.hseos/`, `.agents/`, or `.enterprise/`.

**Tier 4 — HSEOS Execution Surface:**
`.hseos/agents/swarm.agent.yaml`, `.hseos/workflows/dev-squad/workflow.md`, and `.hseos/workflows/dev-squad/resume/workflow.md` constitute the runtime execution surface. They consume the Tier 2 compiled mirror via the HSEOS bootstrap path. They must never reference the Tier 3 external mirror.

**Invariant (extends ADR-0006 P5):** No runtime asset in `.hseos/`, `.agents/`, or `.enterprise/` may reference a `~/.claude` path as canonical. References to `~/.claude` paths in documentation are permitted only as "external mirror" cross-references, clearly labeled as non-canonical.

**Sync protocol for the external mirror:** When the Tier 1 source is updated and compiled, the resulting Tier 2 mirror should be manually copied to `~/.claude/skills/dev-squad/` as an operator-performed sync step. This is an operator convenience, not a compile-time requirement. The external mirror may lag by one or more releases; this is acceptable because it is non-load-bearing inside HSEOS-enabled repos.

---

## Consequences

### Positive

- The model-matrix drift class is eliminated: there is exactly one normative definition; all other copies are derived and never hand-edited.
- A clean-clone bootstrap of an HSEOS-enabled repo brings up SWARM with zero host-state requirements — the Tier 2 compiled mirror is present in the repo.
- ADR-0006 P1 and P5 are fully satisfied by the hierarchy.
- The Tier 3 external mirror continues to serve its non-HSEOS use case without breaking the non-load-bearing pattern.
- A future quality gate (static grep of runtime assets for `~/.claude` canonical references) can mechanically enforce the invariant.

### Negative / Trade-offs

- The external mirror (`~/.claude`) must be manually re-synced from canonical after non-trivial Tier 1 changes. This is a one-step operator task, but it will not happen automatically. Drift in the external mirror for non-HSEOS use is accepted as the design trade-off.
- The compiler is now the single permitted writer to Tier 2. Any workflow that previously hand-patched `.agents/skills/dev-squad/` must be updated to patch the Tier 1 source and recompile.

### Risks

- **Risk:** A future contributor edits the Tier 2 compiled mirror directly, believing it to be the source. **Mitigation:** The compiled mirror will carry a machine-generated header warning (`# AUTO-GENERATED — do not edit; see .enterprise/governance/agent-skills/dev-squad/SKILL.md`) and the `manifest.yaml` hash-check fails on compiler re-run if the file was modified externally.
- **Risk:** The external mirror is re-introduced as canonical inside an HSEOS repo by a future ADR or CLAUDE.md edit. **Mitigation:** The quality-gate grep (proposed above) catches this at PR time; this ADR itself is the reference for rejection.
- **Risk:** The Tier 3 mirror drifts far enough from Tier 1 that non-HSEOS users experience behavior inconsistent with the documented protocol. **Mitigation:** The sync step is documented in the `ai-observability` runbook and the dev-squad skill header; major protocol changes should trigger a manual sync as part of their release checklist.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| SKILLS-REGISTRY | Source-of-truth claims for `dev-squad` | Overrides: replaces any reference to `~/.claude/skills/dev-squad/` as canonical with the Tier 1 / Tier 2 hierarchy defined here |
| `.hseos/workflows/dev-squad/workflow.md` | Canonical pointer / authority header | Clarifies: must reference Tier 2 compiled mirror, not the external mirror |
| `.hseos/workflows/dev-squad/resume/workflow.md` | Canonical pointer / authority header | Clarifies: same as above |
| `.hseos/agents/swarm.agent.yaml` | Skills/protocol reference | Clarifies: must not cite `~/.claude` as canonical source |
| `.enterprise/governance/agent-skills/dev-squad/SKILL.md` | Document header | Extends: adds explicit `## Authority` section declaring Tier 1 status |
| ADR-0006 | P5 (zero global path) | Extends: ADR-0015 adds the dev-squad hierarchy as a concrete enforcement instance of P5 |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Teams notified through PR summary and docs
- [x] Activation date: 2026-06-03
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Keep `~/.claude/skills/dev-squad/SKILL.md` as canonical and sync to repo | Rejected: this is the exact pattern ADR-0006 already rejected. A global host-side file as the source of truth requires every contributor to maintain personal state, which is incompatible with clean-clone bootstrap and violates P1 and P5. |
| Delete the external mirror entirely | Rejected: the external mirror provides a valid non-HSEOS use case (bare Claude Code sessions without `.hseos/`). Deleting it would break the portable-skill pattern without providing any additional safety inside HSEOS repos. |
| Make the Tier 2 compiled mirror canonical (skip Tier 1) | Rejected: the compiled mirror is derived by definition. If it is also canonical, the compiler has no source to compile from; any hand-edit is immediately contradicted by the next compile run. A human-readable governance source (Tier 1) is necessary. |
| Treat all four locations as co-equal peer sources | Rejected: co-equal peers with no conflict-resolution rule produced the exact model-matrix drift this ADR was written to fix. A strict hierarchy with a single Tier 1 is the only arrangement that prevents silent divergence. |
