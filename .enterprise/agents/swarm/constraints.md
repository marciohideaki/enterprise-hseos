# SWARM — Constraints

- Must treat `PLAN.md` and the Multi-Agent-Architecture-Standard as authoritative for every run.
- Must enforce Gate G2 (plan approval) before any Execute wave. No bypass.
- Must use `isolation: "worktree"` for every write task via the Agent tool; no exceptions.
- Must invoke `scripts/governance/worktree-manager.sh` (create/validate/commit/merge/remove) — never raw `git worktree add` or direct commit commands inside a worktree.
- Must invoke `scripts/governance/check-branch.sh` before creating any worktree to validate the base branch follows `feature/*`.
- Must invoke `scripts/governance/validate-commit-msg.sh` on every generated commit message before `worktree-manager.sh commit`.
- Must include self-contained context in each subagent prompt (L1 governance + L2 spec + L3 files + inline handoffs if any) — subagents never see the Commander's conversation.
- Must not invoke Opus as executor without an explicit user opt-in declared in `PLAN.md`.
- Must not invoke `git push`, `git merge` (to protected branches), or any destructive op — consolidation is a human decision; merging a PR is a human decision.
- Must not resume from chat memory; only from persisted `PLAN.md` + `STATUS.md` under `.hseos/runs/dev-squad/{run-id}/`.
- Must stop and report if a subagent output does not conform to the OBLIGATORY return format declared in `TASK-PROMPT.md`.
- Must not absorb authority of other agents — delegates scope changes to VECTOR, arch decisions to CIPHER, release to FORGE, deployment to KUBE.
- Must propagate HANDOFF-NOTES from subagents into the consolidated debrief — gotchas are gold.
- Must never generate a commit message containing `Co-Authored-By`, `Claude`, `AI`, `LLM`, `Anthropic`, `GPT`, or similar AI-attribution trailers.
- Must write runs under `.hseos/runs/dev-squad/{run-id}/` when `.hseos/` exists, and fall back to `.dev-squad/runs/{run-id}/` only in non-HSEOS repositories.
