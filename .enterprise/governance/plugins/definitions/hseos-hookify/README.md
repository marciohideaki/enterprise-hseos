# `hseos-hookify`

> **Status: scaffolded.** Plugin implementation lands as a follow-up PR within Wave 5.

## Purpose

Planned wizard for authoring hook entries in the canonical
`.enterprise/governance/hooks/registry.yaml` source using the v1.1+ neutral format.
Generated entries must start with `status: pending` so they are reviewable before compilation.

## Implementation plan

- `commands/hook-new.md` — slash command surfacing the wizard
- `lib/registry-writer.js` — appends to `.enterprise/governance/hooks/registry.yaml` with idempotency guard (refuses to clobber existing entries)
- `lib/validate.js` — validates against the registry's status enum and event vocabulary

## Acceptance

- [ ] Generates a syntactically valid registry entry
- [ ] Default status is `pending` (compiler ignores until handler exists)
- [ ] Handler scaffold optionally written to `.enterprise/governance/hooks/handlers/` if user opts in
