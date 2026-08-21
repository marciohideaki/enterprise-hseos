# `hseos-pr-review`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5.

## Purpose

Plans HSEOS commit-hygiene rules and commit-msg validation with `pr-review-toolkit` recorded as upstream provenance. The scaffold inherits no runtime behavior: activation requires bundling and testing every published behavior locally.

## What this plugin adds on top of upstream

- Commit-msg validation (no `Co-Authored-By`, no AI mentions, conventional format)
- Commit-hygiene checks (1 task = 1 commit, branch protection adherence)
- ADR-required gate (architectural changes flagged when no ADR draft exists)
- Skill-loading audit (verifies tier-policy compliance in newly added skills)

## Implementation plan

- `surfaces/agents/pr-reviewer.agent.yaml` — extends upstream agent with HSEOS hooks
- `surfaces/skills/commit-msg-validator/SKILL.md`
- `surfaces/commands/review-pr.md`
- `tests/` — local behavior and dual-vendor materialization conformance

## Acceptance

- [ ] Publishes no behavior that is only available from an unresolved upstream
- [ ] Rejects PRs that violate commit-hygiene without bypass
