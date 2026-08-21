# G9 Checkpoint — Compatibility Retirement Readiness

**Status:** awaiting evidence; node not completed
**Checkpointed:** 2026-08-21T17:08:55Z
**Scope:** reversible retirement tooling, internal dead-compatibility removal, migration fixtures, caller inventory, and deprecation evidence
**Operational data:** unchanged; no activation or deletion performed

## Delivered

- Added `hseos compatibility-audit`, a machine-readable and human-readable read-only readiness report governed by ADR-0022 and ADR-0023.
- The audit requires 30 complete prior days with all 24 exact hourly observations for all four native MCP servers, zero legacy use, consistent daily usage counters, an integrity-preserving migration dry-run, zero retired internal symbols, zero legacy runtime references, and a separate human authorization.
- Migration evidence is produced only from a byte copy in a private temporary directory. Symlinks, hardlinks, WAL/SHM, and rollback journals fail closed before SQLite opens an evidence source.
- Data and schema digests prove every pre-existing table is unchanged when temporary schema migrations 005-007 are applied.
- The caller scan covers JavaScript, shell, PowerShell, and `src/` runtime surfaces, including aliased MCP imports and direct legacy state SQL.
- Removed the dead internal underscore/`Colon` naming APIs and generator methods. Dash naming is now the sole internal command-generation format; the scan reports zero residual callers.
- Kept MCP 2024-11-05, operational schema v4, plugin catalog v1 input, and legacy installation detection because their operational/external evidence windows are not satisfied.

## Current gate evidence

- The operational project has no `mcp-legacy-usage.db`; the 30-day observation window has not begun producing durable evidence.
- The operational `project.db` currently has live WAL/SHM sidecars, so the final audit correctly refuses to create a migration snapshot while a writer may be active.
- The repository currently reports 8 MCP legacy references across 4 native entrypoint files and 19 state-write references, including Bash and PowerShell writers.
- `ready_for_human_gate` is therefore `false`, `activation_authorized` is always `false`, and G9 remains active.
- The operational main database SHA-256 remains `99852724d4c4ab0a378f5931380fc4dd85d13648952283c0fbaaec56523421bf`.

## Deterministic evidence

- `node --test test/test-compatibility-audit.js`: **7 passed, 0 failed**.
- `node --test test/test-mcp-2026-adapter.js`: **23 passed, 0 failed**.
- Full repository suite through the strict quality gate: exit 0.
- `npm run lint`: exit 0.
- `git diff --check`: exit 0.
- `./scripts/governance/quality-gates.sh --phase code --strict`: exit 0, **0 failures, 0 warnings**.
- Final quality log: `.logs/validation/gate-20260821T170740.log`.
- Final quality log SHA-256: `279d8dfcdb8e94e900485e9c18b76dd5a40b6c3559448bc4fff21c5d41221cce`.

## Independent verification

The independent verifier first falsified hour coverage with `T99`, direct usage/counter divergence, aliased and cross-root callers, untracked Bash/PowerShell writers, symlinked WAL sources, and active rollback journals. Every finding became a regression or a fail-closed boundary. The final verdict was **READY**, with no residual findings for the readiness tooling.

## Stop condition and handoff

G9 is not complete and G10 must not start. Retirement can resume only after:

1. 30 consecutive complete zero-use days exist for every native MCP server;
2. all internal legacy runtime references have been removed through the approved activation release;
3. operational writers are stopped and SQLite sidecars are checkpointed for a stable migration snapshot;
4. plugin/install compatibility has downstream release-window evidence; and
5. project authority explicitly authorizes operational migration/deletion.

Any schedule extension beyond ADR-0022/0023 deadlines requires a new accepted ADR.
