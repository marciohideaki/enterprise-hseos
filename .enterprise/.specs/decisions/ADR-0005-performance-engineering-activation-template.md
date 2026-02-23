# ADR-0005 — [SERVICE NAME] — Performance Engineering Standard Activation

> **This is a template ADR for activating the Performance Engineering Standard.**
> Copy this file, fill all fields, rename to `ADR-XXXX-<service>-performance-activation.md`,
> and submit via PR. This ADR is required before applying any rule from PE-05 onwards.

**Status:** Proposed
**Date:** YYYY-MM-DD
**Authors:** [Service team / Tech Lead]
**Affects Standards:** Performance Engineering Standard (PE-01, PE-02, PE-04 — all rules become mandatory upon acceptance)
**Supersedes:** N/A

---

## Context

[SERVICE NAME] processes [describe the throughput-sensitive workload, e.g., "real-time market data ticks at ~50,000 events/second" or "payment authorization requests with <100ms SLA"]. Standard NFR latency SLOs are insufficient for this workload. The Performance Engineering Standard must be activated to enforce hot-path rules, zero-allocation requirements, and benchmarking gates.

---

## Decision

We activate the **Performance Engineering Standard** for **[SERVICE NAME]** as of [DATE].

All rules PE-01 through PE-55 become mandatory for this service from the activation date.

---

## Performance Profile (PE-02 — Required)

| Metric | Target |
|---|---|
| **Throughput** | [e.g., 50,000 ops/sec sustained] |
| **p50 latency** | [e.g., < 50 µs] |
| **p95 latency** | [e.g., < 200 µs] |
| **p99 latency** | [e.g., < 500 µs] |
| **Memory footprint** | [e.g., < 512 MB heap, 0 heap allocs on hot path] |
| **GC pause budget** | [e.g., < 1 ms p99 GC pause] |

---

## Hot Path Identification (PE-05)

The following code paths are classified as **HOT PATH** (must be annotated `// HOT PATH`):

| Path | Description | Latency Budget |
|---|---|---|
| [e.g., `OrderMatchingEngine.Match()`] | [e.g., Core matching loop per tick] | < 1 µs |
| [e.g., `MarketDataFeed.Publish()`] | [e.g., Fan-out to subscribers] | < 500 ns |

The following paths are classified as **WARM PATH** (annotated `// WARM PATH`):

| Path | Description | Latency Budget |
|---|---|---|
| [e.g., `OrderBook.Snapshot()`] | [e.g., Periodic state snapshot] | < 1 ms |

---

## Baseline Benchmarks (PE-33 — Required Before Activation)

Benchmarks must exist before this ADR is accepted. Link to benchmark results:

```
BenchmarkXxx   N      ns/op   B/op   allocs/op
[service]       [n]     [x]     [y]     [z]
```

Benchmark file location: `[path/to/benchmark_test.go or BenchmarkSuite.java]`

---

## Consequences

### Positive
- Enforces zero-allocation hot paths
- Benchmark regression gates block performance regressions in CI
- Lock-free patterns enforced for concurrency topology

### Negative / Trade-offs
- Increased code complexity for hot-path implementations
- Benchmark maintenance overhead
- Stricter PR review process (performance-profiling skill loaded for all PRs)

---

## Compliance

- [ ] Baseline benchmarks exist and linked above
- [ ] Hot paths identified and listed above
- [ ] performance-profiling skill will be loaded for all PRs touching this service
- [ ] CI gate added: benchmark regression > 5% blocks merge (PE-40)
- [ ] Approved by Engineering Leadership
- [ ] Activation date: [YYYY-MM-DD]

---

## Alternatives Considered

| Alternative | Why Rejected |
|---|---|
| Apply only specific PE rules | PE-04: once activated, all rules mandatory — partial compliance not allowed |
| Optimize without activating standard | Lacks governance — regressions undetected, no benchmark gates |
