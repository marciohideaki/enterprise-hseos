#!/usr/bin/env bash
# HSEOS telemetry-export-session handler — Stop, opt-in OTLP/Loki session log
#
# Event:     Stop
# Matcher:   * (all)
# Blocking:  false (non-blocking; background POST; exit 0 always)
# Status:    active (self-suppresses when no OTLP/Loki endpoint is set)
#
# Purpose:
#   At session end, emit a structured "session_ended" log record to either:
#     • OTLP /v1/logs  (when OTEL_EXPORTER_OTLP_ENDPOINT is set)
#     • Loki push API  (when HSEOS_LOKI_ENDPOINT is set; takes precedence if both)
#
#   The shared OTLP/Loki collector referenced by ADR-0010 is the intended
#   downstream receiver. SQLite (via state-emit-hook.sh) remains canonical;
#   this handler is an ADDITIONAL opt-in sink.
#
# Opt-in:
#   OTEL_EXPORTER_OTLP_ENDPOINT  — e.g. http://localhost:4318
#   HSEOS_LOKI_ENDPOINT          — e.g. http://localhost:3100
#
# Authority: ADR-0014 (telemetry export bridge), ADR-0010 (shared collector)
# Authoring rules (per .agents/hooks/handlers/README.md):
#   - Idempotent: invoking twice produces the same log shape
#   - Best-effort: never blocks the triggering action; exit 0 always
#   - Project-scoped: no host-state side effects
#   - Fail-open: any error → exit 0 silently

set -u

# ── Opt-in gate ───────────────────────────────────────────────────────────────
if [[ -z "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" && -z "${HSEOS_LOKI_ENDPOINT:-}" ]]; then
  exit 0
fi

# ── Tool guards ───────────────────────────────────────────────────────────────
command -v jq >/dev/null 2>&1 || exit 0
command -v curl >/dev/null 2>&1 || exit 0

# ── Read stdin payload ────────────────────────────────────────────────────────
STDIN=$(cat)

SESSION_ID=$(printf '%s' "$STDIN" | jq -r '.session_id // ""' 2>/dev/null) || SESSION_ID=""

# ── Resource attributes ───────────────────────────────────────────────────────
SVC_NAME="hseos-agent"
HOST_NAME="${HOSTNAME:-unknown}"
ENV_NAME="${HSEOS_ENV:-dev}"
RUN_ID="${HSEOS_CURRENT_RUN_ID:-}"
TIMESTAMP_NS=$(( $(date +%s) * 1000000000 ))
TIMESTAMP_S=$(date +%s)

LOG_BODY="session_ended service=${SVC_NAME} session_id=${SESSION_ID} run_id=${RUN_ID} host=${HOST_NAME} env=${ENV_NAME}"

# ── Dispatch: OTLP logs path ──────────────────────────────────────────────────
if [[ -n "${OTEL_EXPORTER_OTLP_ENDPOINT:-}" ]]; then
  OTLP_PAYLOAD=$(jq -nc \
    --arg svc    "$SVC_NAME" \
    --arg host   "$HOST_NAME" \
    --arg env    "$ENV_NAME" \
    --arg run_id "$RUN_ID" \
    --arg sess   "$SESSION_ID" \
    --arg body   "$LOG_BODY" \
    --argjson ts "$TIMESTAMP_NS" \
    '{
      "resourceLogs": [{
        "resource": {
          "attributes": [
            {"key": "service.name", "value": {"stringValue": $svc}},
            {"key": "host.name",    "value": {"stringValue": $host}},
            {"key": "environment",  "value": {"stringValue": $env}},
            {"key": "hseos.run.id", "value": {"stringValue": $run_id}},
            {"key": "session.id",   "value": {"stringValue": $sess}}
          ]
        },
        "scopeLogs": [{
          "logRecords": [{
            "timeUnixNano":   $ts,
            "severityText":   "INFO",
            "body":           {"stringValue": $body},
            "attributes": [
              {"key": "event.name", "value": {"stringValue": "session_ended"}}
            ]
          }]
        }]
      }]
    }' 2>/dev/null) || exit 0

  ENDPOINT="${OTEL_EXPORTER_OTLP_ENDPOINT%/}/v1/logs"
  (
    curl -sf -m 3 \
      -H "Content-Type: application/json" \
      -d "$OTLP_PAYLOAD" \
      "$ENDPOINT" \
      >/dev/null 2>&1
  ) &

# ── Dispatch: Loki push API path ──────────────────────────────────────────────
elif [[ -n "${HSEOS_LOKI_ENDPOINT:-}" ]]; then
  LOKI_PAYLOAD=$(jq -nc \
    --arg svc    "$SVC_NAME" \
    --arg env    "$ENV_NAME" \
    --arg run_id "$RUN_ID" \
    --arg ts_s   "${TIMESTAMP_S}000000000" \
    --arg body   "$LOG_BODY" \
    '{
      "streams": [{
        "stream": {
          "service":     $svc,
          "environment": $env,
          "event":       "session_ended",
          "run_id":      $run_id
        },
        "values": [[ $ts_s, $body ]]
      }]
    }' 2>/dev/null) || exit 0

  LOKI_URL="${HSEOS_LOKI_ENDPOINT%/}/loki/api/v1/push"
  (
    curl -sf -m 3 \
      -H "Content-Type: application/json" \
      -d "$LOKI_PAYLOAD" \
      "$LOKI_URL" \
      >/dev/null 2>&1
  ) &
fi

exit 0
