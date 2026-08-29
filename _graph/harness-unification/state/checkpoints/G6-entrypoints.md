# G6 Checkpoint — Unified Entrypoints and Scheduler

**Status:** completed and independently verified; production cutover remains prohibited
**Baseline:** feature integration `f2bb36b46c771c3648dc1d670dbf404aed746612`
**Decision:** accepted ADR-0022 and ADR-0023

## Delivered

- One canonical six-field execution envelope and one governed port shared by CLI, hook, project-state, SWARM, and native MCP adapters in the gated modern fixture.
- A bounded scheduler with FIFO exclusivity barriers, concurrency limits, queue limits, cancellation, absolute deadlines, deterministic operation binding, and durable cancellation outcomes.
- Native modern adapters for project-state, governance, SWARM, and Axon that expose handler-free catalogs and dispatch only through the governed scheduler.
- A signed and encrypted MRTR elicitation flow that binds explicit approval to actor, input, resource scope, operation, policy, and idempotency key before approval-required mutations dispatch.
- Production-safe transition behavior: operational MCP and CLI paths remain functional on legacy protocol/schema v4, record durable compatibility usage, and do not apply migrations 005–007.
- Continuous activation evidence: 24 hourly coverage buckets for each native MCP server across the preceding 30 complete UTC days, zero legacy usage including the current day, bounded identity cardinality, overflow aggregation, and 45-day retention.
- State-purge approval bound to the exact target run and operation; forced production purge remains closed until the governed boundary activates.
- Hook resolution restricted to the repository CLI, the project-local installed `node_modules/.bin/hseos`, or an explicitly configured owner-trusted non-writable path. Global and `npx` resolution remain prohibited.
- Strict lossless JSON validation, OS-derived local actor identity, exact state-database resource scope, and governed stale-run sweeping.

## Deliberate boundaries

- `MCP_PROTOCOL_VERSION` remains `2024-11-05`; the modern runtime is reachable only with `NODE_ENV=test`, `HSEOS_GOVERNED_EXECUTION_FIXTURE=1`, and a fresh non-linked database confined under the real temporary root.
- The production migration runner remains v4. Production CLI and project-state reject `user_version > 4` and reject pending execution tables even if the version is disguised as v4.
- Migrations 005–007 remain in `migrations-pending-activation`. No operational database, deployment, service, or external system was migrated.
- Legacy compatibility is explicitly transitional and metered. It does not claim governed-ledger conformance before the separate cutover decision.
- The generated `.goose/` output created during local compiler verification was removed; it was an untracked test artifact, not part of the approved surface.

## Deterministic evidence

- Entrypoint parity/scheduler/real-server suite: `15` passed, `0` failed.
- MCP 2026 adapter suite: `23` passed, `0` failed.
- State core suite: `62` node tests passed plus all CLI/render/UI/kanban/purge/session smokes.
- Hook suites: `77` handler tests and `11` blocking-hook tests passed.
- Adjacent native MCP suites: `50` passed, `0` failed.
- Full governed quality gate: exit `0`, `0` failures, `1` pre-existing documentation-placeholder warning.
- Lint and `git diff --check`: passed.
- Quality log SHA-256: `5aeea426104411434a0679126f495fa38a6b85e4bb6f72ab0426ea0ad2b0e974`.
- Operational main database remained byte-identical: SHA-256 `99852724d4c4ab0a378f5931380fc4dd85d13648952283c0fbaaec56523421bf`.
- Final independent verification: `0 BLOCKER / 0 HIGH / 0 MEDIUM / 0 LOW`; verdict `PRONTO para G6`.

## Independent corrections absorbed

- Closed temporary-path escapes through direct `/var/tmp`, symlink, hardlink, and real-parent validation.
- Restored operational v4 compatibility instead of leaving production entrypoints dormant.
- Bound purge approval to the requested run and rejected cross-run reuse.
- Replaced sparse daily readiness with complete hourly coverage and current-day usage blocking.
- Removed universal provider-idempotency claims and supplied explicit approval flow for remaining mutations.
- Rejected pre-existing or disguised pending schemas in production.
- Restored installed-consumer hook resolution without trusting arbitrary global executables.
- Bounded durable telemetry cardinality and retention.

## Required next

G7 must normalize capability schema v2 and prove exact selected-set-to-emitted-set materialization for every profile. The mandatory governance baseline must remain impossible to omit.

## Rollback

Revert/discard the isolated G6 commit. This restores the pre-G6 entrypoints without deleting or downgrading any operational database. No production schema migration or modern-protocol activation occurred.
