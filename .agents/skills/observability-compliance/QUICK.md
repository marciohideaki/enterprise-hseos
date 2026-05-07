---
name: observability-compliance
tier: quick
version: "1.0.0"
description: "Use when adding new service endpoints, background jobs, or integrations that require structured logging, metrics, or tracing"
---

# Observability Compliance — Quick Check

> Tier 1: use when reviewing code that adds logging, metrics, traces, or new service operations.
> Load SKILL.md (Tier 2) for full structured logging rules and metric requirements.

---

## Checklist

**Structured Logging**
- [ ] Logs use structured format (key/value pairs) — no string concatenation
- [ ] Every backend log entry includes: `service`, `environment`, `correlationId`
- [ ] `traceId` included when distributed tracing context is available
- [ ] No secrets, tokens, or PII in any log statement
- [ ] Log level is appropriate (Debug/Info/Warning/Error/Critical)

**Correlation**
- [ ] `correlationId` propagated from incoming request/message to all outbound calls
- [ ] `causationId` included on domain/integration events

**Metrics**
- [ ] New endpoints have request rate, error rate, and latency metrics
- [ ] New commands/queries tracked in metrics (executed count, failure count)
- [ ] New background jobs / consumers have processing metrics

**Tracing**
- [ ] Spans created for new inbound requests, DB calls, external HTTP calls, and broker operations
- [ ] Span attributes include use case name, aggregate id (when safe), event type

---

## Verdict

**PASS** → observability requirements met.
**FAIL** → gaps found — load `SKILL.md` (Tier 2) for complete observability rules.
