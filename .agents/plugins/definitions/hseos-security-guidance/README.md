# `hseos-security-guidance`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5.

## Purpose

Single-install bundle for the three foundational HSEOS security skills. Activates them with sane defaults so a fresh project gets baseline security guidance without per-skill configuration.

## Skills bundled

- `secure-coding` — Tier-2 reference (loaded only when triggers fire: PR review, commit, security-sensitive file edit)
- `threat-modeling` — Tier-2 reference (loaded for new feature design)
- `dependency-audit` — Tier-1 quick (loaded on every commit that touches `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`)

## Implementation plan

- `surfaces/skills/` — symlinks or activation entries for the three skills
- `surfaces/hooks/registry.yaml fragment` — adds `posttooluse-deps-changed-audit` hook entry that fires `dependency-audit` skill on dependency-file edits
- `surfaces/commands/security-review.md` — slash command running the three skills sequentially
- `tests/` — verifies the three skills load on cue

## Acceptance

- [ ] All three skills load on their respective triggers
- [ ] dependency-audit hook fires on package.json edit and rejects unaudited transitive vulns
- [ ] security-review slash command produces a unified report across the three skills
