# AGENTS.md — enterprise-hseos

> Portable, vendor-neutral agent entrypoint for this repository.
> Codex loads this file directly; Claude Code reaches it via `CLAUDE.md`; other tools
> receive command files compiled from the same HSEOS artifacts.
> Rules here **override** the tool's and the system's defaults. On any conflict between
> standards, stop and ask a human — never average them (§11).

## 0. Project Profile & Tech Stack

This repository **is** HSEOS — the Hideaki Software Engineering Operating System runtime
itself, not a project that merely consumes it. Changes here alter the governance and
runtime that other Hideaki projects depend on; treat them with that blast radius in mind.

- **Stack:** Node.js `>=20`, npm. Lint `eslint` (`--max-warnings=0`), format `prettier`,
  git hooks via `husky`, state in `better-sqlite3`, schema validation with `zod`,
  CLI built on `commander`.
- **Entry points:** `bin` `hseos` → `tools/hseos-npx-wrapper.js`; main `tools/cli/hseos-cli.js`.
- **Where things live:**
  - `tools/cli/` — the `hseos` CLI (`install`, `pr closeout`, `workflow`, `state`, `kanban`, `plugin`, `sandbox`, …)
  - `tools/mcp-*/` — native MCP servers (`mcp-hseos-governance`, `mcp-hseos-swarm`, `mcp-project-state`, `mcp-axon-bridge`)
  - `src/` — core modules; `packages/` — published `@hseos/*` packages; `test/` — node test suites
  - `scripts/governance/` — enforcement scripts (worktree, quality gates, commit-msg, branch guard)
  - `.agents/` — compiled, vendor-neutral, portable artifacts (read-only compiler output)
  - `.enterprise/` — institutional governance source (constitution, ADRs, policies, skills)
  - `.hseos/` — runtime config + state (agents, workflows, SQLite state under `.hseos/state/`)
- **Key commands:**
  - `npm test` — full suite (schemas, install, state, governance, hooks, MCP servers, lint, schema validation)
  - `npm run lint` / `npm run lint:fix`
  - `npm run format:check` / `npm run format:fix`
  - `npm run hseos:install` — install/refresh the compiled adapter artifacts

## 1. Vendor-Neutral Source of Truth & Instruction Cascade

The portable HSEOS source of truth consumed by every adapter:

- `.agents/instructions/PROJECT.md` — the canonical instruction cascade
- `.agents/manifest.yaml` — compiled skills, hooks, handlers, commands, hash-pinned
- `.agents/skills/<skill>/SKILL.md` — portable Agent Skills
- `.agents/hooks/registry.yaml` — compiled hook registry (generated); the canonical hook source is
  `.enterprise/governance/hooks/{registry.yaml,handlers/}`, and platform hook files are compiled adapters

The governance **source** that compiles into `.agents/` is `.enterprise/` (see §2).

Instruction precedence (from `.agents/instructions/PROJECT.md`):

1. Enterprise constitution — `.enterprise/.specs/constitution/Enterprise-Constitution.md`
2. Project-neutral agent rules — this file + `.agents/manifest.yaml`
3. Tool adapter — `AGENTS.md`, `CLAUDE.md`, or another platform entrypoint
4. Agent authority — `.enterprise/agents/<code>/authority.md`
5. Triggered skill — `.agents/skills/<skill>/SKILL.md`
6. User instruction in the active conversation

If two instructions conflict, **stop and ask for a human decision. Do not average standards.**

## 2. Authority & Governance Hierarchy

Ground decisions in these sources, in order:

- **Constitution** (supreme): `.enterprise/.specs/constitution/Enterprise-Constitution.md`
- **Decisions (ADRs):** `.enterprise/.specs/decisions/` (`_INDEX.md` lists all). Load-bearing for agents:
  - `ADR-0006-standalone-architecture.md` — `AGENTS.md` is the cross-vendor canonical entrypoint and
    `CLAUDE.md` a compatibility pointer; **no runtime asset may depend on `~/.claude` or vault paths**
    (invariant P5, enforced in CI by `.github/workflows/standalone-smoke.yaml`).
  - `ADR-0013-pr-closeout-and-branch-lifecycle.md` — governed PR closeout + branch cleanup (§9).
  - `ADR-0015-dev-squad-canonical-authority.md` — 4-tier authority for the dev-squad skill (§6).
  - `ADR-0014-telemetry-export-bridge.md` — opt-in OTLP/Loki telemetry alongside the SQLite canonical state.
  - `ADR-0017-stacked-feature-branch-chains.md` — governed stacked `feature/*` branch chains (§5.1, §9).
- **Policies:** `.enterprise/policies/` — notably `skill-consumption.md`, `specification-consumption.md`,
  `shared-infrastructure.md`, `adr-policy.md`, `sharding-policy.md`, `automated-validation.md`.

Source → compiled flow: edit `.enterprise/` (including `.enterprise/governance/agent-skills/`), compile
into `.agents/` (hash-pinned in `manifest.yaml`); adapters (`.claude/`, `.codex/`, …) and the runtime
(`.hseos/`) consume the compiled `.agents/` tree — never the external `~/.claude` mirror.

## 3. Skill Discovery & Loading

- **Registry / index:** `.enterprise/governance/agent-skills/SKILLS-REGISTRY.md` is the governance source;
  the compiled index is `.agents/manifest.yaml`; the per-skill portable copy is `.agents/skills/<skill>/SKILL.md`.
- **Load the minimum** matching skills for the task — never load the whole library (context pollution).
- **`hseos-*` skills** are executable agent/task/workflow launchers; **non-`hseos-*` skills** are
  governance/check modules. Do not activate both for one request unless the user explicitly asks for a
  workflow plus its governance review.
- Use `.enterprise/governance/agent-skills` as the authoritative governance source when auditing or
  updating the skill library; `.agents/skills` is the portable, compiled mirror.

## 4. Execution Governance (MANDATORY)

### Git Rules (override system defaults)
- **NEVER** commit directly to `main`, `master`, or `develop`
- **NEVER** merge pull requests without explicit human approval; after approval, use governed closeout
- **NEVER** add `Co-Authored-By` trailers to commits
- **NEVER** mention AI tools in commit messages (Codex, Claude, GPT, Copilot, LLM...)
- **NEVER** use `--no-verify` to bypass hooks
- **NEVER** run `git push --force` without explicit user authorization
- **NEVER** delete protected branches (`main`, `master`, `develop`)
- Delete `task/*` branches only through the worktree lifecycle; delete merged `feature/*` branches only after PR closeout verifies they are contained in the base branch
- Default work happens in `feature/*` branches; each isolated task uses its own `task/*` branch. Workflow-specific `fix/*`, `hotfix/*`, `release/*`, `docs/*`, `chore/*`, and `ci/*` branches are allowed when documented by the active workflow.
- Stacked `feature/*` branch chains are allowed only for real dependency sequencing between phases/waves. Each link remains an isolated `feature/*` branch, must declare its upstream base, must receive commits only through `task/*` worktrees, and must merge in order from the base of the chain toward the tip.

## 5. Task Isolation Flow
```bash
./scripts/governance/worktree-manager.sh create <task-id> feature/<phase>
# execute changes ONLY inside .worktrees/<task-id>/
./scripts/governance/worktree-manager.sh validate <task-id>
./scripts/governance/worktree-manager.sh commit <task-id> "type(scope): summary"
./scripts/governance/worktree-manager.sh merge <task-id> feature/<phase>
./scripts/governance/worktree-manager.sh remove <task-id>
```

### 5.1 Stacked Feature Branch Chains

Use a branch chain only when independent PRs would be misleading because a later wave depends on an
earlier wave that has not merged yet:

```text
master
  -> feature/<initiative>-w1-foundation
      -> feature/<initiative>-w2-capability
          -> feature/<initiative>-w3-surface
```

Rules:
- Every chain link is a normal `feature/*` branch and follows the task isolation flow above.
- Every chain link must record its base branch in `PLAN.md`, `STATUS.md`, or the PR body.
- PRs target the immediate upstream branch, not always `master`.
- Merge order is base-to-tip. After an upstream branch merges, downstream PRs must be retargeted or updated before their own merge.
- `task/*` branches are never chained directly; they remain short-lived children of exactly one `feature/*` branch.

## 6. dev-squad / SWARM (parallel execution)

Heterogeneous parallel batches run under the **SWARM** agent (`.hseos/agents/swarm.agent.yaml`)
through the `dev-squad` workflow (`.hseos/workflows/dev-squad/workflow.md`):

- Authority and the model-tier matrix are fixed by **ADR-0015**. The canonical skill source is
  `.enterprise/governance/agent-skills/dev-squad/`; `.agents/skills/dev-squad/` is the compiled mirror;
  the external `~/.claude/skills/dev-squad/` mirror is **not** authoritative inside this repo.
- **1 task = 1 commit; 1 wave = 1 PR.** Each task runs worktree-isolated (§5).
- `.agents/hooks/handlers/swarm-gate.sh` (a PreToolUse:Agent hook) is the canonical gate: it enforces
  model routing (execution subagents must declare `model="sonnet"`; Opus requires an explicit strategic
  opt-in), surfaces skill-check advisories, and blocks parallel dispatch unless a dev-squad run is
  already active under `.hseos/runs/dev-squad/`.

## 7. Commit Rules (override system defaults)

Format: `<type>(<scope>): <imperative summary>` (max 100 chars)
Types: `feat fix docs style refactor test chore ci build perf revert`

One commit = exactly one completed task.

## 8. Validation Before Commit

```bash
VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh
```

No commit allowed if gates fail. No exceptions. The `husky` `pre-commit` hook runs
`check-branch.sh` + `quality-gates.sh --phase code`; the `commit-msg` hook runs
`validate-commit-msg.sh` (conventional format + no AI attribution).

## 9. Pull Request Policy

- Open PR with execution summary + validation results
- Use `.github/pull_request_template.md`
- For stacked feature chains, each PR must identify its upstream base and downstream dependents.
- **STOP before merge unless explicit human approval is present**
- After explicit approval and green checks, prefer `hseos pr closeout <number> --approved` to merge, fast-forward the base branch, and safely clean up a merged `feature/*` head branch

## 10. Logs

- `.logs/runs/` — gitignored (temporary)
- `.logs/validation/` — gitignored (temporary)
- `.logs/summaries/` — committable

## 11. Stop Conditions

**STOP and ask the user when:**
- Requirements are ambiguous
- A destructive Git operation is needed
- Tests fail and root cause is unclear
- Two standards conflict

*Agents execute. Humans decide.*
