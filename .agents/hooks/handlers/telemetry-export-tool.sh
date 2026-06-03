#!/usr/bin/env bash
# HSEOS telemetry-export-tool handler — PostToolUse, opt-in OTLP metrics
#
# Event:     PostToolUse
# Matcher:   * (all tools)
# Blocking:  false (non-blocking; background POST; exit 0 always)
# Status:    active (self-suppresses when OTEL_EXPORTER_OTLP_ENDPOINT unset)
#
# Purpose:
#   TEE of tool events to an OTLP-compatible metrics endpoint.
#   When the opt-in env var is absent this script exits immediately with
#   ZERO network calls — the SQLite state-emit (state-emit-hook.sh) remains
#   the canonical sink and is unaffected by this handler's presence or absence.
#
# Opt-in:
#   Set OTEL_EXPORTER_OTLP_ENDPOINT  (standard OTel env, e.g. http://localhost:4318)
#   OR  HSEOS_OTEL_EXPORT=1          (HSEOS-specific convenience alias)
#
# Authority: ADR-0014 (telemetry export bridge)
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: invoking with the same payload twice produces the same metric shape
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: no host-state side effects
#   - Fail-open: any error → exit 0 silently

set -u

# ── Opt-in gate ──────────────────────────────────────────────────────────────
# Exit immediately unless the user has explicitly configured an OTLP endpoint
# OR has set the HSEOS convenience alias. This is the FIRST executable line
# after the header to guarantee zero network calls when unset.
if [[ -z "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" && "${HSEOS_OTEL_EXPORT:-0}" != "1" ]]; then
  exit 0
fi

# ── Tool guards ───────────────────────────────────────────────────────────────
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

# ── Read stdin payload ────────────────────────────────────────────────────────
STDIN=$(cat)
[[ -z "$STDIN" ]] && exit 0

TOOL_NAME=$(printf '%s' "$STDIN" | jq -r '.tool_name // "unknown"' 2>/dev/null) || TOOL_NAME="unknown"
DURATION_MS=$(printf '%s' "$STDIN" | jq -r '.duration_ms // 0' 2>/dev/null) || DURATION_MS=0
EXIT_CODE=$(printf '%s' "$STDIN" | jq -r '.exit_code // 0' 2>/dev/null) || EXIT_CODE=0
SESSION_ID=$(printf '%s' "$STDIN" | jq -r '.session_id // ""' 2>/dev/null) || SESSION_ID=""

# ── Resource attributes ───────────────────────────────────────────────────────
SVC_NAME="hseos-agent"
HOST_NAME="${HOSTNAME:-unknown}"
ENV_NAME="${HSEOS_ENV:-dev}"
RUN_ID="${HSEOS_CURRENT_RUN_ID:-}"

# ── Build minimal OTLP resourceMetrics JSON ───────────────────────────────────
TIMESTAMP_NS=$(( $(date +%s) * 1000000000 ))

OTLP_PAYLOAD=$(jq -nc \
  --arg svc    "$SVC_NAME" \
  --arg host   "$HOST_NAME" \
  --arg env    "$ENV_NAME" \
  --arg run_id "$RUN_ID" \
  --arg sess   "$SESSION_ID" \
  --arg tool   "$TOOL_NAME" \
  --argjson exit_code  "$EXIT_CODE" \
  --argjson duration   "$DURATION_MS" \
  --argjson ts         "$TIMESTAMP_NS" \
  '{
    "resourceMetrics": [{
      "resource": {
        "attributes": [
          {"key": "service.name",    "value": {"stringValue": $svc}},
          {"key": "host.name",       "value": {"stringValue": $host}},
          {"key": "environment",     "value": {"stringValue": $env}},
          {"key": "hseos.run.id",    "value": {"stringValue": $run_id}},
          {"key": "session.id",      "value": {"stringValue": $sess}}
        ]
      },
      "scopeMetrics": [{
        "metrics": [
          {
            "name": "claude_tool_use_total",
            "description": "Total tool invocations by tool name",
            "sum": {
              "dataPoints": [{
                "attributes": [
                  {"key": "tool_name",  "value": {"stringValue": $tool}},
                  {"key": "exit_code",  "value": {"intValue":    $exit_code}}
                ],
                "startTimeUnixNano": $ts,
                "timeUnixNano":      $ts,
                "asInt": 1
              }],
              "aggregationTemporality": 2,
              "isMonotonic": true
            }
          },
          {
            "name": "claude_tool_duration_ms",
            "description": "Tool execution duration in milliseconds",
            "gauge": {
              "dataPoints": [{
                "attributes": [
                  {"key": "tool_name", "value": {"stringValue": $tool}}
                ],
                "timeUnixNano": $ts,
                "asDouble":     $duration
              }]
            }
          }
        ]
      }]
    }]
  }' 2>/dev/null) || exit 0

# ── POST in background — non-blocking, 3s hard timeout ───────────────────────
ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT%/}/v1/metrics"
(
  curl -sf -m 3 \
    -H "Content-Type: application/json" \
    -d "$OTLP_PAYLOAD" \
    "$ENDPOINT" \
    >/dev/null 2>&1
) &

exit 0
