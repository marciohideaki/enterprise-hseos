# `hseos-hookify`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5.

## Purpose

Wizard for authoring hook entries directly into `.agents/hooks/registry.yaml` using the v1.1+ neutral format (event, matcher, type, command, status, platform_support, fallback). Generated entries always start with `status: pending` so they are reviewable before activation.

## Implementation plan

- `commands/hook-new.md` — slash command surfacing the wizard
- `lib/registry-writer.js` — appends to `.agents/hooks/registry.yaml` with idempotency guard (refuses to clobber existing entries)
- `lib/validate.js` — validates against the registry's status enum and event vocabulary

## Acceptance

- [ ] Generates a syntactically valid registry entry
- [ ] Default status is `pending` (compiler ignores until handler exists)
- [ ] Handler scaffold optionally written to `.agents/hooks/handlers/` if user opts in
