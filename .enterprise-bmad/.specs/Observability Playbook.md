# Observability Playbook
## Practical Guide for Logs, Metrics, Traces and Dashboards (Multi-Stack)

**Version:** 1.0  
**Scope:** Generic / Domain-agnostic  
**Stacks:** Backend (C#/.NET), Clients (Flutter/Dart, React/TypeScript)

> This playbook explains **how** to implement observability consistently.
> It does not replace the Observability NFRs; it operationalizes them.

---

## 1. Objectives

- Make incidents diagnosable within minutes
- Provide end-to-end request tracing
- Ensure metrics are actionable
- Keep logs safe (no secrets/PII)

---

## 2. Correlation & Trace Context

### 2.1 Required Identifiers

- `correlationId`: end-to-end flow identifier
- `causationId`: previous message/action identifier (events)
- `traceId` / `spanId`: tracing identifiers

### 2.2 Propagation

- HTTP: accept incoming correlation header, generate if missing, return it.
- Messaging: include correlation/causation IDs in message envelope.
- Background jobs: preserve correlation context.

---

## 3. Logging Guidelines

### 3.1 Structured Logs

- Use structured logs (key/value)
- Avoid concatenated string logs

### 3.2 Log Levels

- Debug: high-volume local diagnostics
- Info: lifecycle and business milestones
- Warning: recoverable anomalies
- Error: failed operations requiring attention
- Critical: immediate action required

### 3.3 Mandatory Fields

Every backend log entry must include:
- `service`
- `environment`
- `correlationId`
- `traceId` (when available)
- `eventName` / `operation`

### 3.4 Sensitive Data

- Never log tokens, secrets or PII
- Redact payloads by default

---

## 4. Metrics Guidelines

### 4.1 Metric Types

- Counters: events over time (requests, errors)
- Gauges: current values (queue depth)
- Histograms: latency distributions

### 4.2 Required Metrics (Backend)

- Request rate per endpoint
- Error rate per endpoint
- Latency percentiles (p50, p95, p99)
- Outbox dispatch success/fail
- Consumer processing success/fail
- DLQ count

### 4.3 Business-Critical Metrics (Domain-agnostic patterns)

- Commands executed
- Queries executed
- Events published
- Events consumed

---

## 5. Tracing Guidelines

### 5.1 Spans

- Create spans for:
  - inbound requests
  - database calls
  - external HTTP calls
  - message publish/consume

### 5.2 Attributes

- Add attributes for:
  - use case name
  - aggregate id (if safe)
  - event type

---

## 6. Dashboards (Baseline)

### 6.1 Service Overview

- Throughput
- Error rate
- Latency percentiles
- CPU/memory

### 6.2 Messaging Dashboard

- Outbox pending
- Consumer lag
- DLQ volume

### 6.3 Dependency Dashboard

- External dependency error rates
- Timeouts
- Circuit breaker state

---

## 7. Alerts (Baseline)

- p95 latency above threshold
- error rate above threshold
- DLQ above threshold
- outbox backlog above threshold
- authentication error spikes

---

## 8. Client Observability (Flutter / React)

- Capture:
  - crashes
  - slow screens
  - network failures
  - session start/end
- Propagate correlationId in API calls when available
- Do not log user-sensitive payloads

---

## Summary

This playbook provides the **practical checklist** for implementing observability across backend and clients.
It is intended to accelerate onboarding, reduce MTTR and enforce consistent telemetry.
