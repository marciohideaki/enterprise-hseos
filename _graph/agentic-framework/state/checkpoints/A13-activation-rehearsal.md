# A13 Checkpoint — Activation and Rollback Rehearsal

**Status:** rehearsal passed in an isolated task worktree; operational activation remains blocked
**Baseline:** `d7886b571a7b`
**Authority:** prior explicit authorization to proceed with HSEOS and GitHub work; no cutover was inferred
**Scope:** candidate provider profile, private-copy migration, rollback and operational-environment readiness

## Outcome

HSEOS now has an explicit `agent-openai-compatible-candidate` profile instead of reusing the non-operational scripted reference profile. Its immutable candidate manifest binds the model-neutral Agent Kernel to the OpenAI-compatible provider port, declares only a secret reference, requires the `ai-jail` lockdown sandbox and keeps both `operational` and `activation.authorized` false.

`hseos agent-activation-rehearsal` performs a fail-closed rehearsal. It accepts a stable schema-v4 database or, only with `--live-snapshot`, creates a verified private snapshot of a live WAL and checkpoints that private copy. It migrates another private copy to v7, verifies integrity and all legacy-table digests, discards the migrated candidate, reopens the retained v4 rollback copy through the operational schema boundary, and fingerprints the source before and after.

## Real-state evidence

The command was run against `/opt/hideakisolutions/enterprise-hseos/.hseos/state/project.db` in explicit live-snapshot mode on 2026-08-23. It reported:

- private migration v4 → v7: passed; migrations 005, 006 and 007 applied;
- changed legacy tables: none;
- candidate integrity: `ok`;
- rollback v4 integrity and table preservation: passed;
- migrated candidate discarded: yes;
- operational DB, WAL and SHM fingerprints before/after: byte-identical;
- OpenAI-compatible normalized probe: `content.delta`, `usage`, `completed`;
- credential behavior: resolved only at dispatch and absent from evidence;
- required sandbox: blocked because `ai-jail` and `bwrap` are absent and AppArmor restricts unprivileged user namespaces.

## Verification

- `npm run test:agentic-activation` — 4/4.
- `npm run test:compatibility` — 12/12.
- `npm run test:capabilities` — 97/97.
- `npm run test:model-providers` — 15/15.
- ESLint — passed.
- Strict worktree-manager gate — 0 failures, 1 unrelated historical placeholder warning.
- Gate log — `.logs/validation/gate-20260823T234433.log`.
- Gate SHA-256 — `a199f5f729a3033d4ce551158c172198b30ec15c17957ffb5c2d5dbacba8dcd0`.
- `git diff --check` — passed.

## Boundary and remaining gates

No operational database, schema, protocol, service, provider credential or external model was changed or invoked. This checkpoint does not complete A13 and cannot authorize cutover. Remaining gates are required-sandbox runtime readiness, validation of the selected real provider endpoint/model through secret references, the 30-complete-day G9 zero-legacy window, final stable audit and explicit human cutover authorization.
