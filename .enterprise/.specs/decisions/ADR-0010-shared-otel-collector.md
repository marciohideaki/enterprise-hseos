# ADR-0010 — Shared OpenTelemetry Collector in `platform-shared-dev`

**Status:** Proposed
**Date:** 2026-05-24
**Authors:** Platform Architecture
**Affects Standards:** `.enterprise/policies/shared-infrastructure.md` (canonical mapping table)
**Supersedes:** N/A
**Superseded By:** N/A
**Depends on:** ADR-0002 (shared services in `platform-shared-dev`), ADR-0003 (cross-namespace addressing)

---

## Context

The 2026-05-20 shared-infrastructure policy explicitly listed "OTel Collector — not deployed in k3s — Tracing stack is external" as a known gap. This worked while no in-cluster capability needed structured OTLP ingestion, but the Enterprise Capability Platform (ECP) is now publishing real provider adapters behind capability contracts (`telemetry.publish/structured_log`, `telemetry.publish/prometheus`) and the third provider (`telemetry.publish/opentelemetry`) requires an OTLP endpoint to export to.

Two paths were considered:

1. Continue exporting metrics via the gateway `/metrics` endpoint, scraped by the shared Prometheus. Works for counters, but cannot carry traces or logs through the same contract.
2. Deploy a single shared OpenTelemetry Collector inside `platform-shared-dev` and route OTLP gRPC/HTTP through it. Allows traces, logs, and metrics to share one pipeline and one set of resource attributes per project.

The platform already runs the kube-prometheus-stack Prometheus in the `monitoring` namespace. Per-project collectors were rejected because every Hideaki project would otherwise stand up its own (the exact failure mode the shared-infrastructure policy was written to prevent).

## Decision

Deploy `otel-collector-shared` as a single Deployment + Service + ConfigMap in `platform-shared-dev`, using `otel/opentelemetry-collector-contrib:0.110.0`. Configure:

- **Receivers:** OTLP gRPC on `:4317` and HTTP on `:4318`.
- **Processors:** `memory_limiter` (80% / 25% spike), `batch` (1024 records / 5s), `resource` (adds `cluster=dev`, `shared=true` attributes; per-project attributes set by the exporter side).
- **Exporters:** `prometheus` (`:8889`) for metrics ingestion by the shared Prometheus via a dedicated `ServiceMonitor` in `monitoring`; `debug` exporter for traces and logs until a tracing/logging backend is provisioned (tracked separately).
- **Service:** ClusterIP exposing `4317`, `4318`, `8889`, `8888` (self-telemetry).

Per-project capabilities export via the cluster-internal FQDN `otel-collector-shared.platform-shared-dev.svc.cluster.local:4318` (HTTP) by default. gRPC is available for SDKs that require it.

The shared-infrastructure policy mapping table is updated in the same change set; the policy now references this ADR. The "Services NOT yet in shared" entry for OTel Collector is removed.

## Consequences

### Positive

- Single OTLP entry point for every project; no per-project collector deployments.
- Metrics flow into the existing Prometheus instance without changing the kube-prometheus-stack configuration (just one extra ServiceMonitor).
- Traces and logs are accepted today (debug exporter) and can later be routed to Loki / a tracing backend by editing only the collector ConfigMap.
- ECP's `telemetry.publish` capability can ship the OTLP provider with a stable external contract.

### Negative

- Single point of failure for OTLP ingestion in dev. Acceptable for the dev cluster; production should scale to N replicas with horizontal pod autoscaling once traffic justifies it.
- Backpressure tuning (`memory_limiter`) needs revisiting when real workload arrives.

### Neutral

- Trace and log retention remain external concerns; this ADR does not commit to a long-term storage backend.

## Validation

- `kubectl kustomize platform-shared-dev/infra/base` must include the three new resources.
- A `kubectl -n platform-shared-dev port-forward svc/otel-collector-shared 4318:4318` followed by a curl POST to `/v1/metrics` with a single OTLP payload must return `200`.
- After ECP gateway exports metrics via the OTLP provider, the series must appear in the shared Prometheus and in the ECP Grafana dashboard.

## Rollback

- Remove the three resources from `platform-shared-dev/infra/base/kustomization.yaml` and the `otel-collector-shared` ServiceMonitor from `monitoring/kustomization.yaml`. Capabilities consuming OTLP fall back to the `prometheus` or `structured_log` providers, which do not depend on the collector.

## Notes

- Vault / External Secrets are not required for the collector configuration: there are no secrets in `collector.yaml`. Should authenticated OTLP be added later, switch to the `ExternalSecret` pattern documented in the shared-infrastructure policy.
- The `monitoring-infra-dev-kube-prometheus` scrape interval is `30s`. The `prometheus` exporter sets `metric_expiration: 5m`, comfortably above two scrape windows.
