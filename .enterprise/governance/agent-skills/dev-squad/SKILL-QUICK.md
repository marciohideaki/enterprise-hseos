---
name: dev-squad
tier: quick
version: "1.0"
description: "Use when SWARM is planning a heterogeneous batch of 3+ tasks and dispatching parallel worktree-isolated subagents. Opus plans, Sonnet/Haiku execute."
---

# Dev Squad — Quick Reference

> Tier 1: load when SWARM is activating the parallel batch flow or deciding if a batch qualifies.
> Load SKILL.md (Tier 2) or `~/.claude/skills/dev-squad/SKILL.md` (canonical, global) for full protocol.

---

## When to activate

- 3+ heterogeneous tasks (independent or with shallow dependency graph)
- Mix of bug fixes, small refactors, UI polish, BFF sweeps — areas that don't collide
- Token cost matters (Opus is planning only; execution should tier down)
- Session context is inflating (plan, `/clear`, resume with clean context)

## When to skip (delegate)

- Single story end-to-end → BLITZ (Solo Protocol)
- Strict sequential delivery with release flow → ORBIT (Epic Delivery)
- Exploratory work without defined scope → NYX discovery first
- Architectural pivot → CIPHER to draft ADR first

---

## Model matrix (default bias = lowest tier)

| Tier | Model | Criteria |
|---|---|---|
| trivial | haiku low | 1 file, ≤30 lines, known pattern |
| small | sonnet low | 1-2 files, ≤100 lines, test exists |
| medium | sonnet medium | 3-5 files, 1 layer, new tests |
| large | sonnet high | ≥5 files, ≥2 layers, no test coverage |
| strategic | opus (opt-in) | transversal arch, critical schema — explicit opt-in in PLAN.md |

Escalate by 1 tier for: auth/crypto/payments/fiscal; first greenfield task; handoff consumed by ≥2 tasks.

---

## 5 Phases

1. **Intake** — prose first, ≤4 questions via AskUserQuestion if gaps
2. **Study** (optional) — up to 3 parallel Explore agents
3. **Plan** — atomic tasks, wave graph, model matrix → **Gate G2 mandatory**
4. **Execute** — detached mode; per wave: check-branch → worktree-manager create → N parallel Agents → Commander extracts handoffs → validate → commit → merge → remove → WAVE-REPORT
5. **Consolidate** — draft PR body; human opens PR; human reviewer merges

---

## Governance invariants (HSEOS)

- **Worktree isolation:** `isolation: "worktree"` for every write task; never raw `git worktree add`
- **worktree-manager.sh mandatory:** `create` / `validate` / `commit` / `merge` / `remove`
- **Commit hygiene:** validated by `validate-commit-msg.sh`; NO `Co-Authored-By`, NO mentions of `Claude`, `AI`, `LLM`, `Anthropic`, `GPT`
- **Base branch:** validated by `check-branch.sh` → must match `feature/*`
- **Quality gates:** `quality-gates.sh` runs via `worktree-manager.sh validate` (6 gates)
- **1 task = 1 commit; 1 wave = 1 PR** (default)
- **Human only for merge** — agents never merge to protected branches

---

## Handoff rule

Subagents are zero-context. They return structured output per TASK-PROMPT OBLIGATORY format. **Commander (Opus) extracts** what downstream tasks need and writes `handoffs/T{a}-to-T{c}.md` (≤40 lines). Subagents never write handoffs.

---

## Gates

| Gate | Purpose | Decider |
|---|---|---|
| G1 | Intake disambiguation (conditional) | human |
| **G2** | **Plan approval (mandatory)** | **human** |
| G3 | Wave review (conditional: BLOCKED or risk flag) | human |
| G4 | PR open (human runs `gh pr create`) | human |
| G5 | Merge (human reviewer) | human |

Bypass = governance violation → halt + escalate.

---

## Anti-patterns

- Subagent writing handoff → prolixo, inconsistente → Commander extracts
- Opus as default executor → cost explosion → opt-in only
- Skipping G2 → bad decomposition parallelized = retrabalho ao quadrado
- Raw `git worktree add` in HSEOS repo → skips quality gates → use the script
- Commit with `Co-Authored-By` → validator fails → clean message

---

## Relationship

- Consumes: `multi-agent-orchestration` (SKILL-QUICK for pattern taxonomy)
- Delegates to: NYX (discovery), VECTOR (scope), CIPHER (arch), ORBIT (epic flow), BLITZ (solo)
- Canonical protocol: `~/.claude/skills/dev-squad/SKILL.md` (global, loaded in SWARM bootstrap)
