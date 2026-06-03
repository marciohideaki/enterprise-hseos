# Agent-Core Compiler v2 — Rollout Plan

Implementation roadmap for the remaining scope of **ADR-0007** (Agent-Core
Compiler v2 — Multi-Adapter Contract), with **ADR-0008** (MCP bundles) and
**ADR-0009** (plugin marketplace).

> ADR-0007 is currently **Proposed**. Waves W2+ are gated on its acceptance by
> Engineering Leadership (see *Acceptance gate* below). W1 is delivered.

---

## Status

The modular pipeline from ADR-0007 already exists and the manifest registers the
full project inventory.

**Done**

- Modular compiler (`agent-core-compiler/` directory layout per ADR-0007).
- Sources: `instructions`, `skills`, `hooks`, `commands`, `agents`, `plugins`, `mcp`.
- Adapters: claude-code (`.claude/hooks.json`), codex (`.codex/`), `AGENTS.md`, root pointer.
- Manifest builder registers `skills`, `hooks`, `commands`, `agents`, `plugins`,
  `mcp_servers`, `mcp_bundles_active` (+ `counts`).
- Self-verification: `verify` (integrity — skills **and** agents), `audit`, `doctor`.

**Remaining (this plan)** — the manifest *registers* plugins/MCP/agents but the
compiler does not yet *emit* per-adapter plugin/MCP configs or rendered
subagents, is not yet in the v2.0 manifest form, has no per-asset signatures, and
ships only 2 of the 6 ADR-0007 adapters.

---

## Waves

| Wave | Scope | ADR | Status |
|------|-------|-----|--------|
| **W1** | Manifest integrity hardening — `verify` covers the agent catalog (CRLF-normalized sha256), closing the drift foot-gun introduced with the agent catalog | 0007 | **Done (this PR)** |
| **W2** | Per-adapter **MCP emit** — `.mcp.json` (root), `.codex/config.toml [mcp_servers]`, `.cursor/mcp.json` from the active bundles | 0008 | Planned |
| **W3** | Per-adapter **plugin emit** — marketplace manifests per adapter format from the plugin registry | 0009 | Planned |
| **W4** | **Rendered subagents** — emit agents as adapter-specific subagent files; populate `agents[].rendered` map | 0007 | Planned |
| **W5** | **v2.0 manifest form** — `adapters[]` array (`id, enabled, spec, output, capabilities, sha256`), `schema_version: "2.0"`, `generated_at`, `CAPABILITY-MATRIX.md` generated from adapter specs | 0007 | Planned |
| **W6** | **Signatures & drift** — `.agents/.signatures/<adapter>.sha256`, `adapters[].sha256`, drift detection in CI and at SessionStart | 0007 | Planned |
| **W7** | **BYOA** — extract `@hseos/adapter-sdk` + `@hseos/adapter-template`, Goose reference adapter, `node_modules/@hseos/adapter-*` discovery; bring the 4 pending vendor adapters (cursor, continue, aider, cline) onto the contract | 0007 | Planned |

### Dependencies

```
W1 (done)
W2 ─┐
W3 ─┼─→ W4 ─→ W5 ─→ W6 ─→ W7
    │         (manifest form)  (signatures)  (BYOA SDK)
```

- W2 and W3 are independent (MCP vs plugin emit) and may run in parallel.
- W4 (rendered subagents) depends on the agent catalog (done) and informs W5's
  `adapters[].output` records.
- W5 (manifest form) must land before W6 (signatures pin `adapters[].sha256`).
- W7 (BYOA SDK) is the last extraction — it factors the now-stable adapter base
  into a publishable package.

### Per-wave acceptance criteria

Every wave must satisfy, before its PR merges:

- `hseos agent-core verify` green; `doctor` green.
- **Round-trip idempotency** per touched adapter: `compile → diff → recompile`
  produces zero diff (ADR-0007 compliance item).
- Tests added for the new source/adapter/emit path.
- No regression to the additive/graceful contract: a project missing the
  relevant registry keeps its prior manifest/output shape.

---

## Execution Protocol

This is coordinated, multi-wave parallel work. It runs under **SWARM** via the
`dev-squad` workflow.

### Coordination model

- **Commander:** SWARM (Opus) — decomposes each wave into atomic tasks, extracts
  handoffs, consolidates. Plans only; never executes destructive ops.
- **Squad:** Sonnet/Haiku executors in worktree-isolated parallel tasks
  (`.worktrees/T{n}/`). Opus-as-executor only with explicit opt-in recorded in
  `PLAN.md`.
- **Unit of work:** `1 task = 1 commit`; `1 wave = 1 PR`. Commander-extracted
  handoffs between dependent tasks (`handoffs/T{a}-to-T{c}.md`).

### Governance invariants (non-negotiable)

- Worktree isolation via `scripts/governance/worktree-manager.sh` — never raw
  `git worktree`.
- `scripts/governance/check-branch.sh` (governed branch prefix) +
  `validate-commit-msg.sh` (conventional, no AI attribution / co-author trailers)
  on every commit, enforced by the `.husky` pre-commit + commit-msg gates.
- `quality-gates.sh --phase code` must pass (lint + full `npm test`).
- Human reviewer merges; no self-approval. Branch protection on `master`
  (required checks `test (20.x)`, `test (22.x)`, `Standalone clean-env smoke`).
- **Gate G2:** `PLAN.md` for the wave is approved before any task executes.

### Wave ↔ squad ↔ model-tier mapping

| Wave | Parallelism | Tier | Rationale |
|------|-------------|------|-----------|
| W2 / W3 | 2 tasks (MCP, plugin emit) in parallel | Sonnet | Mechanical emit from existing registries |
| W4 | 1 task per adapter format | Sonnet | Template-driven rendering |
| W5 | 1 task (manifest form) + 1 (capability matrix) | Opus plan → Sonnet | Schema-critical; Opus opt-in for the contract change |
| W6 | 1 task (signatures) + 1 (drift wiring) | Sonnet | Hash plumbing |
| W7 | 1 task (SDK extract) + 1 per pending adapter | Opus plan → Sonnet | Cross-cutting package boundary; Opus opt-in |

### Versioning per wave

- Tag `git tag compiler-v2-w{n}` on the merge commit.
- Update this doc's status table + the relevant ADR compliance checklist in the
  same PR.

---

## Acceptance gate

ADR-0007 is **Proposed**. Before W2 begins:

- [ ] ADR-0007 accepted by Engineering Leadership (Marcio Hideaki).
- [ ] ADR-0008 and ADR-0009 acceptance confirmed (they gate W2/W3 emit targets).
- [ ] This rollout plan reviewed; wave order and tier matrix confirmed.

W1 (integrity hardening) is delivered independently of the gate — it hardens the
already-shipped agent catalog and introduces no new adapter contract.
