---
skill: performance-profiling
tier: 2
version: "1.0"
description: "Use when investigating a performance regression, profiling a service under load, or auditing performance-sensitive code with regression baselines"
standard: Performance Engineering Standard
---

# Performance Profiling — Full Policy

> Full policy for profiling audits, regression investigations, and performance-sensitive PR reviews.
> Reference: `.enterprise/.specs/Performance Engineering Standard.md`

---

## 1. Activation Gate

Before applying any rule in this skill, verify the service has adopted the Performance Engineering Standard:
- ADR exists declaring service as performance-sensitive (PE-01).
- ADR defines: target throughput, latency budget (p50/p95/p99), memory constraints (PE-02).

If no ADR exists → flag this first. Do not apply hot path rules to non-activated services.

---

## 2. Path Classification Review

For every changed code path, determine its classification:

| Path | Latency Budget | Rules |
|---|---|---|
| Hot | < 1 µs typical | Zero-alloc, lock-free, no IO, no logging |
| Warm | < 1 ms | Low-alloc, prefer lock-free, logging sampled |
| Cold | No constraint | Standard rules apply |

**Check:** Are hot/warm paths annotated (`// HOT PATH`, `// WARM PATH`)?

---

## 3. Zero-Allocation Audit

For hot path changes:

1. Run escape analysis:
   - **Go:** `go build -gcflags="-m" ./...` — verify no unexpected heap escapes
   - **C++:** Run with AddressSanitizer + heaptrack, verify 0 allocations in hot loop
   - **Java:** Use JMH `@BenchmarkMode` with `allocs/op` measurement
2. Check for prohibited patterns:
   - `new` / `make` / `append` (Go) in hot path without pool
   - `std::vector::push_back` growing (C++) in hot loop
   - `String` / `StringBuilder` construction (Java) in hot loop
   - `json.Marshal` / `json.Unmarshal` (Go) in hot path
3. Verify pool usage:
   - `sync.Pool` (Go), `std::pmr` / custom pool (C++), object pool (Java)
   - Pool sized to steady-state — not unbounded

**Block merge if:** `allocs/op > 0` on hot path without documented justification ADR.

---

## 4. Lock-Free Pattern Audit

Verify correct pattern for concurrency topology:

```
1 producer + 1 consumer  → SPSC  (lowest overhead)
N producers + 1 consumer → MPSC
N producers + N consumers → MPMC / Disruptor
```

**Checks:**
- [ ] `std::mutex` absent on hot path
- [ ] `memory_order` used explicitly (not default `seq_cst`) with comment explaining ordering
- [ ] TSan CI build passes
- [ ] ABA problem addressed (tagged pointer, hazard pointer, epoch-based reclamation)
- [ ] Queue bounded — no unbounded growth

---

## 5. Cache Layout Audit

For data structures accessed on hot paths:

- [ ] **False sharing check:** fields accessed by different threads on same struct — if yes, pad to 64 bytes
- [ ] **AoS → SoA migration check:** if iterating over array of structs accessing 1-2 fields, SoA is more cache-friendly
- [ ] **Pointer chasing check:** linked list / tree traversal on hot path — flag for flat alternative
- [ ] **Alignment check:** hot structs marked `alignas(64)` (C++) or equivalent

---

## 6. Benchmark Review

Every hot path PR must include benchmarks:

### Required benchmark output format (in PR description):
```
BenchmarkXxx/before   10000000   120 ns/op   0 B/op   0 allocs/op
BenchmarkXxx/after    12000000    98 ns/op   0 B/op   0 allocs/op
Delta: -18.3% latency, 0 allocations (unchanged)
```

### Regression thresholds:
| Metric | Block threshold |
|---|---|
| p99 latency regression | > 10% |
| Allocations/op increase | Any increase |
| Throughput regression | > 5% |
| GC pause increase (Java) | > 20% |

### Benchmark quality checks:
- [ ] Warmup iterations included (Java JMH: ≥ 5 warmup + 10 measure)
- [ ] Benchmark runs in isolation — no background load
- [ ] `b.ResetTimer()` called after setup (Go)
- [ ] Benchmark input representative of production data size

---

## 7. Serialization Audit

On hot paths:

| Pattern | Verdict |
|---|---|
| JSON encode/decode | ❌ Forbidden |
| `fmt.Sprintf` / string format | ❌ Forbidden |
| protobuf (with arena) | ✅ Allowed |
| FlatBuffers / Cap'n Proto | ✅ Preferred (zero-copy) |
| Fixed-size binary struct cast | ✅ Allowed |

---

## 8. Observability Audit on Hot Paths

| Pattern | Verdict |
|---|---|
| Direct `log.Info(...)` in hot loop | ❌ Forbidden |
| `mutex`-protected counter in hot loop | ❌ Forbidden |
| `trace.StartSpan(...)` per hot call | ❌ Forbidden |
| `sync/atomic.Add` counter | ✅ Allowed |
| Ring-buffer log drain | ✅ Allowed |
| Sampled tracing (1 in N) | ✅ Allowed if rate externalized |

---

## 9. Profiling Workflow (Regression Investigation)

When a latency regression is reported:

1. **Reproduce** — run load test at production-equivalent throughput
2. **Profile** — collect flame graph (perf/async-profiler/pprof)
3. **Identify** — find the hot frame dominating wall time
4. **Isolate** — write a microbenchmark for the specific operation
5. **Optimize** — apply the cheapest fix first (avoid premature complexity)
6. **Validate** — run benchmark before/after, verify regression resolved
7. **Document** — PR description includes flame graph diff + benchmark diff

---

## 10. Output Format

When reporting a performance review, output:

```
## Performance Review

### Path Classification
- [function/module]: HOT PATH ✅ / ❌ Not annotated

### Zero-Allocation
- allocs/op: [value] — ✅ Pass / ❌ Fail
- Issues: [list or "none"]

### Concurrency
- Pattern: SPSC / MPSC / MPMC / N/A
- TSan: ✅ Pass / ❌ Fail / ⬜ Not run
- Issues: [list or "none"]

### Benchmark
- Before: [ns/op, allocs/op]
- After:  [ns/op, allocs/op]
- Delta:  [% change]
- Gate:   ✅ Pass / ❌ Fail (regression > threshold)

### Verdict
- ✅ Approved / ❌ Blocked — [reason]
```
