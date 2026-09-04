# ADR-0035 — Explicit Enforcement-Boundary Doctrine and In-Process Guardrail Hardening

**Status:** Proposed
**Date:** 2026-09-04
**Authors:** Platform Governance
**Approved by:** —
**Affects Standards:** `AGENTS.md` §4 Execution Governance, `.enterprise/governance/hooks/registry.yaml`, `.enterprise/governance/hooks/handlers/*.sh`, `scripts/governance/anchor-guard.sh`, `scripts/governance/loop-guard.sh`, `tools/cli/commands/state-emit.js`, `tools/mcp-project-state/migrations/001-agent-state-tables.sql`, `.hseos/config/hseos.config.yaml`
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0006, ADR-0012, ADR-0015, ADR-0016, ADR-0027
**Related (forward-looking, no dependency):** ADR-0022 (Governed Execution Runtime with Relational Event Ledger) and ADR-0023 (MCP Stateless Adapter) — see Context

---

## Context

HSEOS enforces execution boundaries across four layers, already documented informally: real-time `PreToolUse` hooks, git commit hooks (husky `pre-commit`/`commit-msg`), CI, and server-side branch protection. The first two layers execute **inside** the same process/session as the agent they govern; the last two execute **outside** it.

This asymmetry is real, and design decisions already act on it without saying so out loud: the N1 autonomy pilot protects the constitutional anchor by isolating changes inside a worktree *before* any push reaches CI, precisely because a mistaken or adversarial loop could otherwise rewrite the very rule that would catch it downstream. But nothing in the standards states, as doctrine, which layer is the actual enforcement boundary and which layer is best-effort guidance. A hook is routinely described as "blocking" in `registry.yaml` without qualifying that "blocking" means "stops an honest agent that respects `permissionDecision: ask`," not "cannot be routed around." ADR-0027 tightened hook activation semantics (explicit `active`/`inactive`/`pending`/`deprecated` status, schema `2.0`) but did not address this deeper question of what "blocking" actually guarantees.

Two concrete gaps follow from that unstated asymmetry:

1. **In-process gates are stateless per invocation, and the event log built to fix that is half-wired.** `swarm-gate.sh`, `anchor-guard.sh`, and comparable handlers evaluate every tool call independently. Nothing stops an agent — malfunctioning, confused, or adversarially prompted — from retrying the same denied action with cosmetic variations until one slips past a regex. HSEOS already has exactly this pattern implemented, but only at the autonomous-loop layer: `scripts/governance/loop-guard.sh`'s `NO_PROGRESS_LIMIT` (default 3, rule F-017) halts an N1 run after N heartbeats without a verified fix. Ordinary interactive and dev-squad sessions, where the same hooks fire the same way, have no equivalent memory.
   The state substrate to close this gap already exists and is more capable than a loop-local counter: `as_events` (`tools/mcp-project-state/migrations/001-agent-state-tables.sql`) declares `kind IN (..., 'gate')` and ships a full-text index over it (`as_events_fts`, migration `002-events-fts.sql`, queryable today via the `events` MCP tool). But nothing ever emits `kind='gate'` — no hook handler calls `hseos state-emit gate` — and `tools/cli/commands/state-emit.js` still silently drops *every* event, of any kind, when `HSEOS_CURRENT_RUN_ID` is unset (`if (!run_id) { ...; return; }`, line 68). Since ordinary interactive sessions are not part of a tracked `as_runs` row, no gate decision — and today, no `tool_call`/`start` event either — ever reaches SQLite outside a dev-squad/workflow run. The searchable event log is real infrastructure sitting unused for exactly the case this ADR needs it for.
2. **Human-authorization escape hatches are read ambiently, not granted explicitly.** `scripts/governance/anchor-guard.sh` reads `ANCHOR_OVERRIDE=1` fresh from the environment on every invocation. A human setting it once, for one specific anchored change, has no way to scope that authorization to that change alone — the same env var silently covers every subsequent anchor-guarded call for the rest of the session.

Left undocumented, this asymmetry invites a predictable failure mode: a contributor (human or agent) reads "hook enforcement" and "CI enforcement" as the same kind of guarantee, and designs a control that depends on the weaker one holding.

**Relationship to the pending Governed Execution Ledger.** ADR-0022 (accepted 2026-08-21) and ADR-0023 (accepted 2026-08-21) already decided a much larger execution-runtime overhaul — an execution port, `operation_id`-scoped approvals, and Multi Round-Trip Request (MRTR) approval flows — with its schema staged under `tools/mcp-project-state/migrations-pending-activation/` (`005-governed-execution-ledger-v2.sql` through `009-delegated-worker-lifecycle.sql`) and **not yet activated** (ADR-0023's own compliance checklist still has "[ ] All four native MCP servers pass modern contract tests" unchecked as of this writing). This ADR hardens the *currently live* substrate (`as_events`, `state-emit.js`, the existing hook handlers) rather than the pending one. Item 2 below is deliberately built as a thin, reversible layer on top of live infrastructure, not a competing approval model — see Consequences for the explicit re-evaluation trigger once the ledger activates.

Separately, ADR-0033/ADR-0034 (Federated Platform Capability Graph, Capability Reuse Enforcement) govern cross-repository capability *discovery and reuse*. This ADR is unrelated in scope — it governs in-repo enforcement-layer honesty and hook-level state, not cross-repo capability ownership — and introduces no conflicting registry.

## Decision

Adopt the following as governance doctrine and required implementation.

### 1. Boundary Model Doctrine

Publish `.enterprise/governance/security/BOUNDARY-MODEL.md` as a new canonical document, linked from `AGENTS.md` §4 (Execution Governance). It classifies every enforcement mechanism into exactly two tiers and requires every hook, gate, and check in the repository to carry one of the two labels in its own header/description and in `.agents/manifest.yaml`:

- **Tier A — Accident Prevention (in-process).** `PreToolUse`/`PostToolUse` hooks, husky `pre-commit`/`commit-msg`, and any check that runs inside the same process or session as the agent it governs. Tier A catches honest mistakes and known-bad patterns. It MUST NOT be documented anywhere as "non-bypassable" — it is bypassable by local hook configuration, by `--no-verify` (prohibited by directive, not prevented by mechanism), or by an agent that never triggers the matcher in the first place.
- **Tier B — Enforcement (out-of-process).** CI (`ci.yaml`, `standalone-smoke.yaml`), server-side branch protection (`scripts/governance/apply-branch-protection.js`), and worktree-isolation-before-push. Tier B is the only tier that may be described as "non-bypassable" in documentation, because nothing an agent does inside its own session can alter it.

Existing docs that currently call a Tier A mechanism "non-bypassable" or "enforced" without qualification are corrected as part of adopting this ADR. `active`/`inactive`/`pending`/`deprecated` (ADR-0027) describes whether a hook *runs*; Tier A/B describes what its verdict is worth once it does — the two are orthogonal and both required on every hook.

### 2. Consecutive-Denial Circuit Breaker, on the Existing Event Log

Extend the `loop-guard.sh` no-progress pattern down to the hook layer, for every session — not only N1 runs — by finishing the wiring of `as_events`/`kind='gate'` instead of adding parallel state.

- **Emit real gate events.** Every hook handler capable of denying or blocking a tool call (`swarm-gate.sh`, `anchor-guard.sh`, `claude-md-guard.sh`, `ado-branch-guard.sh`) calls `hseos state-emit gate --payload '{"hook_id":"<id>","action_class":"<normalized-class>","verdict":"deny|ask|allow"}'` on every decision. `action_class` is a normalized command family (e.g., `git-push-protected-branch`), not the literal string, so trivial rewording of a denied command doesn't reset the count.
- **Fix `state-emit.js` so the event actually lands.** Today it returns early and drops the event whenever `HSEOS_CURRENT_RUN_ID` is unset (true for every plain interactive session). Add a session-scoped fallback: when no run id is supplied, auto-provision an `as_runs` row keyed by a synthetic id (`session-<session-id-or-pid+start-ts>`, `workflow_id='session'`) via `INSERT OR IGNORE`, and use it for that call. This reuses the SessionStart/Stop wiring that already exists (`state-emit-hook.sh` already fires `start` on `SessionStart` and `complete` on `Stop`) — once the fallback exists, those two calls open and close the synthetic session run for free; no new lifecycle code is needed beyond the fallback itself.
- **Count denials by querying `as_events`, not a new table.** The circuit breaker reads `SELECT COUNT(*) FROM as_events WHERE kind='gate' AND json_extract(payload_json,'$.hook_id')=? AND json_extract(payload_json,'$.action_class')=? AND json_extract(payload_json,'$.verdict')='deny'` scoped to the current run/session, ordered by `ts DESC`, stopping at the first non-`deny` verdict. This reuses the FTS5-indexed log that already exists instead of introducing a parallel schema.
- On the Nth consecutive denial of the same `hook_id` + `action_class` (default `N=3`, overridable per hook via a new optional `denial_threshold` field in `registry.yaml`), the handler stops denying silently and instead returns `permissionDecision: ask` with a `"repeated denial — human input required"` reason, surfacing the pattern instead of letting the agent keep iterating against it unattended.
- **Explicit sunset trigger:** once the Governed Execution Ledger (ADR-0022/ADR-0023) activates and its `007-execution-approvals.sql` projection is live, this ADR's authors must open a follow-up ADR evaluating whether gate-denial tracking should move onto the ledger's `operation_id`-scoped approval records instead of `as_events`. Until then, `as_events` is the correct substrate because it is the only one actually running.

### 3. Human-Override Freeze-at-Grant

Any environment-variable override that stands in for explicit human authorization (`ANCHOR_OVERRIDE=1` today; the same rule applies to any future override flag) MUST be captured once, at the moment a human grants it for one specific action, not re-read ambiently on every later hook invocation in the same session.

`scripts/governance/anchor-guard.sh` moves from `[[ "${ANCHOR_OVERRIDE:-0}" == "1" ]]` to consuming a single-use grant file (`.hseos/state/anchor-grants/<hash-of-path+commit>.json`, containing the authorized path, the commit it applies to, a timestamp, and a TTL) written by the human at grant time and deleted on first use. A bare env var can no longer authorize more than the one change it was set for.

### 4. Capability-Placement Ladder (addendum to ADR-0016)

Formalize an explicit escalation order for where a new agent capability is implemented, to be checked in PR review before a change lands:

```
prompt/skill instruction → hook → MCP tool → core CLI command
```

Each rung requires the PR description to justify why the rung below it was insufficient. This is a review requirement, not new code, and does not alter ADR-0016's capability-packaging layer — it governs where a capability is *built*, ADR-0016 governs how a built capability is *installed*. It is also distinct from ADR-0033/ADR-0034's Capability Graph, which governs *cross-repository* capability discovery and reuse, not *in-repo* implementation placement.

### 5. MCP Server Spawn Preflight (addendum to ADR-0023)

Before any HSEOS process spawns a native or bundled MCP server in stdio mode (`tools/mcp-*`, and any third-party server referenced from `.agents/mcp/bundles/`), run a dependency-advisory preflight against the resolved package/version. Default posture is fail-open with a logged warning (bounded timeout, no more than 12s) so a preflight-service outage never blocks legitimate work; a project may set `mcp.preflight.required: true` in `hseos.config.yaml` to fail closed instead. This is independent of, and precedes, the protocol-level hardening ADR-0023 already decided (bounded request bodies, schema validation, MRTR approvals) — it addresses what runs before the protocol handshake even starts, not the wire contract.

### 6. Credential Scoping for Hook-Spawned Subprocesses

Hooks and workflow steps that spawn subprocesses (git, `gh`, docker, MCP stdio servers) receive an explicitly filtered environment, not the full inherited process environment, by default. A hook opts into the full environment only by declaring `full_env: true` in its `registry.yaml` entry, with a one-line justification in `description`. This closes the gap where a compromised or over-broad hook command could exfiltrate credentials it never needed.

## Alternatives Considered

| Alternative | Why not chosen |
|---|---|
| Leave the boundary model implicit, as today | This is the status quo, and is exactly the kind of unstated architectural decision ADR policy §1 exists to prevent — silent regressions happen when nobody can point to which layer was ever supposed to hold. |
| Make Tier A hooks technically non-bypassable (remove `--no-verify`, hard-disable hook-skip config) | Breaks legitimate emergency workflows and contradicts ADR-0006's graceful-degradation principle (P6). The correct fix is honest labeling plus keeping real enforcement at Tier B, not pretending Tier A is a sandbox it isn't. |
| Full LLM-adjudicated review on every gate decision, replacing regex matchers | Premature scope for this ADR. Left as a future-ADR trigger: if measured false-positive/negative rates on a Tier A regex gate justify it, a follow-up ADR adds an adjudicated mode for that specific gate. |
| Store denial counters in-memory per hook process | Hook processes are short-lived (one per tool call); state would not survive between invocations, defeating the purpose of a *consecutive*-denial counter. |
| Add a new `gate_denials` table instead of finishing the `as_events`/`kind='gate'` wiring | `as_events` already declares `'gate'` as a valid kind and already has a working FTS5 index and MCP query tool over it (migration `002-events-fts.sql`, `tools/events.js`) — a parallel table would duplicate infrastructure that exists and is idle for exactly this purpose, and would need its own search tooling built from scratch. |
| Build the circuit breaker directly on the pending Governed Execution Ledger (`migrations-pending-activation/007-execution-approvals.sql`) instead of `as_events` | That schema is decided but not activated — no server code reads or writes it yet. Building on inactive migrations would ship a feature with nothing underneath it. The explicit sunset trigger in Decision §2 exists precisely to revisit this once the ledger is live. |

## Consequences

### Positive

- Removes a specific, previously undocumented false-confidence risk: nobody can again design a control assuming a Tier A hook is unbypassable.
- Closes the "agent keeps trying variations of a denied action" gap for ordinary sessions, using a pattern already proven at the loop layer.
- As a side effect, fixes a broader gap than the one this ADR targets: once the `state-emit.js` run-id fallback exists, `tool_call`/`start`/`complete` events from ordinary interactive sessions also stop being silently dropped, and become searchable through the existing `as_events_fts` index and MCP tool — not just gate denials.
- Scopes human override grants to the action they were actually given for, instead of a whole session.
- Gives PR review a concrete, checkable question ("why does this need to be a hook and not a skill instruction?") instead of ad hoc judgment.
- Ships as a small, reversible layer on infrastructure that is live today, instead of waiting on the Governed Execution Ledger's activation timeline.

### Negative / Trade-offs

- Every plain interactive session now opens a synthetic `as_runs` row; `as_runs`/`as_events` volume grows accordingly. Negligible per-row cost, but retention/pruning policy for `workflow_id='session'` rows should be revisited if `project.db` growth becomes noticeable.
- The single-use grant file for anchor overrides is slightly more friction than setting an env var, by design — the friction is the point.
- MCP preflight adds latency (bounded, ≤12s) to server startup; fail-open by default keeps this from becoming an availability risk.
- This ADR's gate-tracking design has a known, declared expiration of relevance: once the Governed Execution Ledger activates, a follow-up ADR must decide whether to migrate onto it. Shipping now means accepting a future migration rather than waiting an unknown number of months for the ledger's activation date.

### Risks & Mitigations

- **Risk:** `denial_threshold` escalation is itself routed around by an agent that varies the `action_class` normalization enough to avoid matching. **Mitigation:** normalization is defined server-side in the handler, not agent-visible, and is reviewed alongside the hook's regex during the same PR cycle that touches the matcher.
- **Risk:** Tier A/Tier B relabeling in existing docs is incomplete at rollout, leaving some docs still implying false non-bypassability. **Mitigation:** `BOUNDARY-MODEL.md` publication is gated on a one-time grep-and-fix pass over `AGENTS.md` and `.enterprise/governance/hooks/handlers/README.md` for the words "non-bypassable"/"cannot be bypassed" applied to Tier A mechanisms.
- **Risk:** `full_env: true` becomes a rubber-stamped default because filtering breaks something. **Mitigation:** `agent-core compile` warns (non-blocking) on any hook declaring `full_env: true` without a `description` justification, surfaced in `hseos agent-core doctor` output.
- **Risk:** this ADR's `as_events`-based tracking is built, then the Governed Execution Ledger activates shortly after, creating two parallel gate-history stores. **Mitigation:** the explicit sunset trigger in Decision §2 makes the re-evaluation a required follow-up ADR, not an optional cleanup task.

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| `AGENTS.md` | §4 Execution Governance | Adds link to `BOUNDARY-MODEL.md`, states the Tier A/B distinction as doctrine |
| `.enterprise/governance/hooks/registry.yaml` | Hook schema 2.0 (ADR-0027) | Adds optional `denial_threshold` and `full_env` fields per hook entry, additive to the existing `active`/`inactive`/`pending`/`deprecated` status field |
| `.enterprise/governance/hooks/handlers/swarm-gate.sh`, `anchor-guard.sh`, `claude-md-guard.sh`, `ado-branch-guard.sh` | Decision output | Each denial/ask/allow verdict is emitted as an `as_events` `kind='gate'` event via `hseos state-emit gate` |
| `tools/cli/commands/state-emit.js` | Run-id handling | Adds a session-scoped `as_runs` fallback instead of dropping events when `HSEOS_CURRENT_RUN_ID` is unset |
| `tools/mcp-project-state/migrations/001-agent-state-tables.sql` | `as_events.kind` | No schema change — `'gate'` is already a valid value; this ADR is what starts populating it |
| `scripts/governance/anchor-guard.sh` | Override handling | Replaces ambient env read with single-use grant file consumption |
| `scripts/governance/loop-guard.sh` | — | Unaffected in behavior; cited as the precedent pattern being generalized |
| ADR-0016 | Capability packaging | Gains the capability-placement ladder as an addendum, not a supersession |
| ADR-0023 | MCP stateless adapter | Gains the MCP spawn preflight requirement as an addendum, not a supersession — applies before the protocol handshake ADR-0023 governs |
| ADR-0022 / ADR-0023 (pending activation) | Governed Execution Ledger | Declared as a forward re-evaluation trigger, not a dependency — see Decision §2 and Consequences |

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] Affected standards updated to reference this ADR
- [ ] Teams notified
- [ ] Activation date: —
- [ ] Review date: 90 days after activation, or immediately upon Governed Execution Ledger activation (whichever is first)

## Validation

- `hseos agent-core doctor` includes a check that every hook in the compiled manifest carries a Tier A/B label.
- A test asserts that calling `hseos state-emit gate` with no `HSEOS_CURRENT_RUN_ID` set still results in a row in `as_events` (session fallback works) and that it is retrievable via the existing `events` MCP full-text-search tool.
- A test asserts that three consecutive `deny` verdicts for the same `hook_id`+`action_class`, read back from `as_events`, produce `permissionDecision: ask` with the repeated-denial reason on the next call, not a fourth silent deny.
- A test asserts `anchor-guard.sh` rejects a bare `ANCHOR_OVERRIDE=1` with no grant file present, and accepts a valid, unexpired, matching-path grant file exactly once.
- `hseos agent-core doctor` warns on any `full_env: true` hook lacking a justification string.

## Rollback

- Remove `BOUNDARY-MODEL.md` and its `AGENTS.md` link; revert the doc-language pass.
- Remove the `hseos state-emit gate` calls from hook handlers and the `denial_threshold` field; handlers revert to stateless per-call evaluation. Revert the `state-emit.js` session-scoped fallback; events outside tracked runs are dropped again as before.
- Revert `anchor-guard.sh` to ambient `ANCHOR_OVERRIDE` env read.
- Remove `mcp.preflight` from `hseos.config.yaml` and the preflight call site in the MCP server launcher.
- Remove `full_env` from the hook schema; all hooks revert to inheriting the full environment.
- Keep this ADR as `Deprecated`, or supersede it with a follow-up ADR if a different hardening strategy is adopted (including the Governed Execution Ledger migration named in Decision §2's sunset trigger).
