# `hseos-pr-review`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5.

## Purpose

Layers HSEOS commit-hygiene rules and commit-msg validation on top of the upstream `pr-review-toolkit` plugin. When the upstream is reachable, this plugin acts as a thin extension; when unreachable (offline / airgapped install), it falls back to its own bundled subset of the review toolkit per ADR-0009 §`extends` behaviour.

## What this plugin adds on top of upstream

- Commit-msg validation (no `Co-Authored-By`, no AI mentions, conventional format)
- Commit-hygiene checks (1 task = 1 commit, branch protection adherence)
- ADR-required gate (architectural changes flagged when no ADR draft exists)
- Skill-loading audit (verifies tier-policy compliance in newly added skills)

## Implementation plan

- `surfaces/agents/pr-reviewer.agent.yaml` — extends upstream agent with HSEOS hooks
- `surfaces/skills/commit-msg-validator/SKILL.md`
- `surfaces/commands/review-pr.md`
- `tests/` — round-trip conformance against both reachable and unreachable upstream

## Acceptance

- [ ] Loads cleanly with upstream reachable
- [ ] Falls back gracefully when upstream is unreachable
- [ ] Rejects PRs that violate commit-hygiene without bypass
