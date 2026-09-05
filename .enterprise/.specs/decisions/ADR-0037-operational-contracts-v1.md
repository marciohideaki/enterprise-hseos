# ADR-0037 — Operational Contracts v1

**Status:** Proposed
**Date:** 2026-07-27
**Authors:** Platform Governance
**Affects Standards:** HSEOS runtime state, agent-state observability, evidence, and session continuity
**Supersedes:** N/A
**Superseded By:** N/A

---

## Context

HSEOS already has executable operational contracts, but they are distributed across the runtime:

- The compiled agent manifest has a versioned JSON Schema and keeps v1/v2 compatibility (`.agents/manifest.schema.json:2-17`).
- `hseos state-emit` appends `hseos-run-event/v1` JSONL records and projects them into SQLite (`tools/cli/commands/state-emit.js:1-4, 19-33, 103-123`).
- SQLite constrains run, task, agent-run, event, handoff, and wave state with SQL enums (`tools/mcp-project-state/migrations/001-agent-state-tables.sql:5-75`).
- Loop execution has a separate file contract (`scope.txt`, `budget.txt`, `heartbeat.jsonl`) and verifier requirements (`scripts/governance/loop-guard.sh:7-20, 68-123`).
- Evidence is independently versioned as a dedicated evidence-envelope concern (see the compatibility-evidence family under `tools/lib/compatibility-evidence-pack.js` and `tools/lib/compatibility-audit.js` for the closest existing analog as of 2026-09-05; the generic `hseos-operational-evidence/v1` envelope this ADR originally cited was never merged).

Agent skill outputs, including goal graphs and `HANDOFF.md`, are currently human-readable protocols. They are not harness contracts unless a named consumer parses them. For example, the session-handoff skill specifies a Markdown template (`.agents/skills/session-handoff/SKILL.md:56-110`), while state handoffs stored by the MCP state service are opaque `content` plus task identifiers and a version (`tools/mcp-project-state/migrations/001-agent-state-tables.sql:59-66`).

There is also a canonicity ambiguity: the runtime manifest calls SQLite canonical for cross-run/cross-project state (`.hseos/AGENT-MANIFEST.md:162-177`), while `state-emit` calls JSONL authoritative for new runs (`tools/cli/commands/state-emit.js:1-4`).

This ADR records a compatible, optional contract family. It does **not** activate validation, add a gate, change an existing producer, reinterpret agent prose, or alter historic artifacts.

> **Provenance note (2026-09-05):** this proposal was drafted 2026-07-27 as `ADR-0021` on an isolated task branch and was never committed. Recovered and renumbered to ADR-0037 because ADR-0021 was independently assigned in the interim to an unrelated, already-Proposed decision ("Brand Variants via Design Tokens, Not Forked Frontends"). File-path citations above were re-verified against the current repository on 2026-09-05; the one that no longer resolved (`scripts/governance/evidence-envelope.js`) was corrected to point at the closest current analog instead of a stale path. No other content was changed. The proposal remains exactly as originally scoped: additive, non-activating, pending the Human decisions below.

---

## Decision

We will reserve `hseos.contracts/v1` as an additive envelope for operational artifacts that need a future machine consumer. Until a type has both an approved schema and an explicit named consumer, it remains a documentation standard only.

### Common envelope

```yaml
schema_version: hseos.contracts/v1       # required
contract_type: <type>                    # required
project: <project-key-or-runtime>        # required
timestamp: <RFC3339 UTC>                 # required
authority:                               # required
  granted_by: <user|policy|system>
  scope: []                              # optional
  excludes: []                           # optional
evidence: []                             # required; may be empty
run_id: <run-id>                         # optional by type
node_id: <node-or-task-id>               # optional by type
status: <type-specific enum>             # required except autonomy_check
verdict: <type-specific enum>            # required only when specified
restrictions: []                         # optional
next_action: <safe-next-step>            # optional
human: {}                                # optional; never executable
extensions: {}                           # optional; namespaced only
```

The harness must ignore unknown `extensions` and `human` fields. No field in this envelope grants authority: authority is evidence of an external decision, not a permission primitive.

### Type profiles

| Type | Required additions | Allowed status/verdict | Proposed producer → consumer | Compatibility / automated validation |
|---|---|---|---|---|
| `autonomy_check` | `verdict`, `intent`, `allowed_now`, `blockers`, `required_decisions` | `proceed`, `ask_human`, `blocked` | agent → human | New documentation profile; validate YAML/JSON only. |
| `human_gate` | `gate_id`, `status`, `decision` | `approved`, `rejected`, `expired`, `superseded` | human record → audit UI | New observational record; must never trigger action. |
| `validation_result` | `checks`, `external_effects` | `pass`, `fail`, `partial`, `skipped`, `quarantined` | validator → audit/closeout | Map only for display; no replacement for current quality gates. |
| `execution_state` | `phase`, `state` | `initialized`, `active`, `checkpointed`, `completed`, `aborted`, `orphaned`, `blocked` | state producer → reader | Adapter only; preserve SQL source enums. |
| `handoff` | `from`, `to`, `summary`, `resume` | `ready`, `blocked`, `superseded` | agent/session → next agent | Do not parse legacy `HANDOFF.md` until explicitly approved. |
| `closeout` | `outcome`, `validations`, `rollback` | `complete`, `partial`, `blocked`, `rejected` | closeout producer → human | Documentation first; not a merge/deploy control. |

### Existing-contract inventory

| Existing surface | Classification | Canonical source / consumer | Action in this ADR |
|---|---|---|---|
| `.agents/manifest.yaml` + schema | Canonical and validated | compiler/adapters | Out of scope; no wrapping. |
| `.agents/hooks/registry.yaml` | Canonical compiled configuration | platform adapters; active status is emitted and other states are not (`.agents/hooks/registry.yaml:1-9`) | Out of scope; no gate changes. |
| `hseos-run-event/v1` JSONL | Canonical executable event | state CLI, event log, SQLite projection | Future `execution_state` is an optional view, not a replacement. |
| `as_*` SQLite state | Canonical executable state | CLI and MCP state tools | Retain database enums and foreign keys. |
| loop guard files and verifier result | Canonical executable state | `loop-guard.sh` | Retain specialized safety semantics; do not flatten verifier signatures. |
| compatibility-evidence family | Canonical and validated | compatibility-evidence CLI/inventory/pack | Retain its schema as a dedicated evidence contract. |
| workflow registry and Markdown workflow outputs | Used in practice, partially structured | workflow selection and humans | Treat outputs as presentation unless a parser exists. |
| goal graph, autonomy, handoff and closeout skills | Presentation/documentation | humans and next session | Profile them without claiming harness consumption. |

### Axon and second-brain extension

The base contract has no dependency on Axon or second-brain. An optional, non-gating extension may be used only when a consumer demonstrates reduced rediscovery or better evidence correlation:

```yaml
extensions:
  hseos.axon/v1:
    capsule_id: optional
    index_health: healthy|stale|unknown
  hseos.second_brain/v1:
    source_refs: []
    capture_status: pending|recorded|not_applicable
```

This is consistent with the existing evidence-envelope discipline elsewhere in the runtime, which can report Axon and second-brain roots and health but does not use them as authorization.

---

## Validation examples

The reference autonomy check, human gate, and validation result supplied with this proposal are valid against their corresponding profiles: `run_id` and `node_id` are optional for a human gate; `restrictions` and `next_action` are optional common fields.

```yaml
# Invalid autonomy check: verdict is required.
schema_version: hseos.contracts/v1
contract_type: autonomy_check
project: poynt-hub
timestamp: "2026-07-27T00:00:00Z"
authority: { granted_by: user }
evidence: []
```

```yaml
# Invalid human gate: pending is not a decision.
schema_version: hseos.contracts/v1
contract_type: human_gate
project: poynt-hub
gate_id: HFN1Y
timestamp: "2026-07-27T01:26:28Z"
status: pending
decision: {}
authority: { granted_by: user }
evidence: []
```

```yaml
# Invalid validation result: checks is required.
schema_version: hseos.contracts/v1
contract_type: validation_result
project: poynt-hub
timestamp: "2026-07-27T02:00:00Z"
status: partial
authority: { granted_by: system }
evidence: []
external_effects: []
```

Automatable validation is limited to schema/enum/format validation, namespace checking, and fixtures. It must not run quality gates, read secrets, invoke external systems, or make an allow/deny decision.

---

## Incremental adoption and rollback

1. Approve this ADR and add schemas plus valid/invalid fixtures in a separate change.
2. Add a read-only validator that accepts existing artifacts unchanged and validates only opt-in envelopes.
3. Add observational consumers (audit/search/dashboard), with no control-plane effect.
4. For each type, approve its first executable consumer separately, including precedence, ownership, retention, and failure behavior.

Rollback is immediate: stop producing the opt-in envelope or disable its consumer. Existing JSONL, SQLite, verifier, workflow, and Markdown artifacts remain authoritative according to their current implementation; no historical rewrite is required.

---

## Governance and security risks

- Treating agent prose as executable would create an unreviewed control plane. Mitigation: explicit consumer registration is required.
- Persisting evidence can expose sensitive content. Mitigation: evidence references and digests by default; never embed secrets.
- Collapsing verifier/evidence contracts into generic status loses signature and binding guarantees. Mitigation: retain specialized schemas.
- A new gate would change behavior. Mitigation: this ADR makes validators observational only.
- Conflicting JSONL/SQLite canonicity can mislead operators. Mitigation: a later ADR must define reconciliation and precedence before any state migration.

## Human decisions pending

1. Approve the `hseos.contracts/v1` namespace and schema ownership.
2. Decide the authoritative relationship between JSONL and SQLite.
3. Approve or reject each proposed type before implementation.
4. Define retention/redaction and access controls for evidence.
5. Decide whether Axon/second-brain extensions have a measurable consumer; default is not to adopt them.
6. Approve any future hook, runtime, skill, gate, migration, or historical-data change independently.

---

## Consequences

### Positive

- Makes operational formats discoverable without changing current execution behavior.
- Separates human-readable reports from machine-consumed contracts.
- Preserves specialized state, verifier, and evidence contracts.

### Negative / Trade-offs

- Adds a proposal layer before a universal schema exists.
- Requires explicit ownership before any consumer can rely on a profile.

## Compliance

- [ ] Approved by Engineering Leadership
- [ ] Schema owner assigned
- [ ] JSONL/SQLite precedence decided
- [ ] No runtime or hook activation included in this ADR
- [ ] Review date set after approval
