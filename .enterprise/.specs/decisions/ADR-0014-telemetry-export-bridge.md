# ADR-0014 — Telemetry Export Bridge: Optional OTLP/Loki Sidecar for HSEOS Agent-State Events

**Status:** Accepted
**Date:** 2026-06-03
**Authors:** Platform Governance
**Affects Standards:** `ai-observability` skill, `.agents/hooks/registry.yaml`
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0010 (shared OTel collector), ADR-0006 (standalone / zero-global-path / graceful degradation)

---

## Context

HSEOS emits agent-state telemetry exclusively to an internal SQLite sink via `scripts/governance/state-emit-hook.sh`. This is the canonical, always-present data path: every agent PostToolUse and Stop event is recorded locally with no external dependency, which satisfies ADR-0006 P3 (graceful degradation) and P5 (zero global path dependency).

Since ADR-0010, the shared `platform-shared-dev` namespace provides a running OpenTelemetry Collector (`otel-collector-shared`) that accepts OTLP gRPC/HTTP. The shared-infrastructure policy has also provisioned Loki and OpenSearch in the same namespace (ADR-0010 and the 2026-06-03 policy expansion). These backends are available to consuming projects today, but HSEOS itself has no mechanism to export agent-state events to them.

The gap creates two pain points:

1. Debugging multi-agent SWARM sessions requires manual SQLite queries; there is no live dashboard over agent tool calls or session durations.
2. Projects that adopt HSEOS inside the shared k3s cluster cannot correlate agent-state events with their application traces in Loki or the shared Prometheus without writing their own glue.

A naive fix — making `state-emit-hook.sh` also POST to OTLP — was rejected because that script owns the canonical SQLite path and mixing two I/O contracts (stdin JSON vs. bash-arg input) into one script couples the canonical path to an optional export.

Two optional registry adapters (`rtk-rewrite`, `build-resource-guard`) were identified during the same design pass. They are operational hooks that belong in the registry with a well-defined lifecycle status, but their scope is narrower and they do not warrant independent ADRs; they are documented here as an appendix to the registry governance section.

---

## Decision

We will add two standalone, env-gated TEE hooks — one per canonical event boundary — that export agent-state events IN ADDITION to the existing SQLite sink.

**`telemetry-export-tool.sh`** fires on `PostToolUse`. It reads the same hook payload, builds an OTLP metrics JSON body (one gauge per tool call, tagged with `agent`, `tool_name`, `session_id`, `duration_ms`), and POSTs it via `curl --max-time 3` to `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/metrics`. The hook is backgrounded (`&`) so it never blocks the tool return path.

**`telemetry-export-session.sh`** fires on `Stop`. It emits a single OTLP logs record (one log entry per session, with `agent`, `session_id`, `total_tool_calls`, `wall_ms`) to `$OTEL_EXPORTER_OTLP_ENDPOINT/v1/logs`. When `HSEOS_LOKI_ENDPOINT` is set instead, the hook switches to a Loki push-format POST (`application/json`, `/loki/api/v1/push`), enabling zero-config integration with the shared Loki instance.

**Opt-in gate:** both hooks perform an early-exit check at line 3:

```bash
[[ -z "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" && -z "${HSEOS_LOKI_ENDPOINT:-}" ]] && exit 0
```

When neither variable is set (the default for every portable consumer), the hooks exit immediately and are effectively inert. The bridge only activates when a consumer explicitly sets at least one endpoint variable.

**SQLite remains the single source of truth.** The bridge writes nothing to SQLite; `state-emit-hook.sh` is untouched. Consumers must not rely on OTLP/Loki availability for correctness; it is a visibility layer only.

**No new skill.** The runbook for configuring and troubleshooting the bridge folds into the existing `ai-observability` skill under a new `## Telemetry Export Bridge` section. This avoids duplicating the `observability-compliance` trigger surface.

**Registry adapters (appendix to registry governance).** Two hook entries are added to `.agents/hooks/registry.yaml` with `status: inactive`:

- `rtk-rewrite` — rewrites shell commands through the RTK proxy when `RTK_ENABLED=1` is set; default-off, self-degrading.
- `build-resource-guard` — checks CPU/memory headroom before starting a compiler or test runner; fires on `PreToolUse` for build-class tools; default-off.

Both adapters follow the same opt-in gate pattern as the telemetry bridge. They ship inactive so consumers can activate selectively without modifying registry defaults.

---

## Consequences

### Positive

- OTLP and Loki visibility over agent-state events is available on demand with a single env-var; no code change is needed after the hooks ship.
- Reuses the ADR-0010 shared OTel collector without adding a new k3s workload.
- SQLite contract is fully preserved; the bridge is additive-only.
- Hook failure is isolated: POST errors are discarded (`2>/dev/null`), the `--max-time 3` ceiling prevents network hangs, and backgrounding (`&`) ensures the agent tool path is never blocked.
- OTLP payloads are hand-built in bash — no SDK dependency — keeping the install footprint at zero new packages.
- The `rtk-rewrite` and `build-resource-guard` adapters are registered at a known, versioned location rather than documented only in prose.

### Negative / Trade-offs

- Dual-sink configuration drift is now possible: SQLite records every event; OTLP/Loki records only what the hook successfully POSTs. Consumers must not treat OTLP/Loki as authoritative for completeness.
- OTLP payloads are hand-assembled in bash. The schema is intentionally minimal (no spans, no resource SDK attributes beyond what is injected manually) and will not pass strict OTLP conformance tests without a real SDK.
- `jq` and `curl` are soft runtime dependencies for the bridge hooks. If absent, the hooks silently skip export (handled by the early-exit gate plus a `command -v jq` guard).

### Risks

- **Risk:** A mis-configured endpoint causes the hook to spam stderr on every tool call. **Mitigation:** all `curl` output is redirected to `/dev/null`; the hook uses `set -u` (not `set -e`) so a missing variable triggers an explicit error rather than silent misbehavior; the early-exit opt-in gate ensures the hook is fully inert unless intentionally configured.
- **Risk:** A slow OTLP endpoint causes the backgrounded POST to accumulate zombie processes under high-frequency tool calls. **Mitigation:** `--max-time 3` is enforced before backgrounding; `wait` is not called, so the hook never accumulates pending waits in the Claude session.
- **Risk:** Registry `inactive` adapters (`rtk-rewrite`, `build-resource-guard`) are activated project-wide without reading their documentation. **Mitigation:** the registry schema requires an explicit `status: active` change per project; the hook entry includes a `requires` field listing the gating env variable.

---

## Affected Standards

| Standard | Section / Rule | Change |
|---|---|---|
| `ai-observability` skill | Runbook | Extends: adds `## Telemetry Export Bridge` section documenting env-var configuration and troubleshooting |
| `.agents/hooks/registry.yaml` | Hook entries | Extends: adds `telemetry-export-tool`, `telemetry-export-session`, `rtk-rewrite`, `build-resource-guard` with `status: inactive` |
| `.enterprise/policies/shared-infrastructure.md` | Canonical mapping table | Clarifies: OTLP endpoint consumed by HSEOS hooks via `OTEL_EXPORTER_OTLP_ENDPOINT` (opt-in only) |

---

## Compliance

- [x] Approved by Engineering Leadership
- [x] Affected standards updated to reference this ADR
- [x] Teams notified through PR summary and docs
- [x] Activation date: 2026-06-03
- [x] Review date: Permanent

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Extend `state-emit-hook.sh` to also POST to OTLP | Rejected: that script owns a different input contract (stdin JSON) and mixes the canonical SQLite path with optional export. Coupling them creates a regression risk on every canonical-path change. |
| Add a new `telemetry-export` skill | Rejected: duplicates the trigger surface of `ai-observability` and `observability-compliance`. The runbook section inside the existing skill is the correct boundary. |
| Always-on localhost default (mirror the personal global script pattern) | Rejected: violates ADR-0006 P3 (graceful degradation) and P5 (zero global path dependency) for portable consumers who have no local OTLP endpoint. |
| Use the OpenTelemetry Collector agent mode (sidecar per pod) | Rejected: HSEOS runs in the developer terminal session, not in a pod. A sidecar would require containerizing the agent runtime, which is out of scope for the standalone architecture (ADR-0006). |
