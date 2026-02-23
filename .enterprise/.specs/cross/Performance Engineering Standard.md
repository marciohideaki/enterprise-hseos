# Performance Engineering Standard
## Cross-Cutting — Opt-In

**Version:** 1.0
**Status:** Canonical / Normative
**Scope:** All stacks — activation requires ADR
**Classification:** Cross-Cutting (Opt-In)

> Defines mandatory rules for services where performance is a first-class concern.
> Adoption requires an ADR documenting the service's performance profile.
> Services not adopting this standard are still bound by NFR latency SLOs.

---

## 1. Activation

- PE-01: Adoption of this standard requires an approved ADR declaring the service a **performance-sensitive service**.
- PE-02: The ADR must define: target throughput (ops/sec), latency budget (p50/p95/p99), and memory footprint constraints.
- PE-03: Services not explicitly activated are NOT bound by this standard but remain bound by stack NFR SLOs.
- PE-04: Once activated, all rules in this standard are **mandatory** — partial compliance is not allowed.

---

## 2. Path Classification

Every code path in a performance-sensitive service MUST be classified.

### 2.1 Definitions

| Path | Definition | Latency Budget |
|---|---|---|
| **Hot Path** | Executed per request/event on the critical throughput lane | < 1 µs per call typical |
| **Warm Path** | Executed frequently but not on the critical lane | < 1 ms per call |
| **Cold Path** | Infrequent — startup, config reload, error handling, admin | No hard constraint |

### 2.2 Rules
- PE-05: Hot and warm paths MUST be explicitly annotated in code comments: `// HOT PATH` / `// WARM PATH`.
- PE-06: Cold path code MUST NOT be inlined into hot path code.
- PE-07: Error handling, logging, and telemetry are always cold or warm — never hot.
- PE-08: Memory allocation is forbidden on hot paths unless using pooled/pre-allocated memory.

---

## 3. Zero-Allocation Rules (Hot Path)

- PE-09: No heap allocation on the hot path — validated via profiler / escape analysis.
- PE-10: Pre-allocated object pools MUST be used for any struct/object needed at high frequency.
- PE-11: Stack allocation preferred over heap where size is bounded and known at compile time.
- PE-12: `string` concatenation forbidden on hot paths — use pre-allocated buffers.
- PE-13: Closures / lambdas that capture variables and allocate on hot paths are forbidden.
- PE-14: Allocation-free code paths must have a benchmark proving zero allocations (allocs/op = 0).

### 3.1 Stack-Specific Zero-Alloc Guidance

| Stack | Technique |
|---|---|
| **C++** | Stack allocation, `std::array`, placement new, custom allocators, `std::pmr` |
| **Go** | `sync.Pool`, value types, `go test -bench` with `AllocsPerRun`, escape analysis (`-gcflags="-m"`) |
| **Java** | Object pooling, value types (Project Valhalla / records), JVM escape analysis, off-heap via `ByteBuffer` |
| **Rust** | Stack allocation by default; `Box` only when needed; arena allocators |

---

## 4. Cache-Friendly Memory Layout

- PE-15: Hot path data structures MUST be laid out to minimize cache misses.
- PE-16: Prefer **Structure of Arrays (SoA)** over **Array of Structures (AoS)** for batch-processed hot data.
- PE-17: False sharing MUST be prevented — hot path fields accessed by different threads/cores padded to cache line boundary (typically 64 bytes).
- PE-18: Pointer chasing on hot paths forbidden — prefer flat, contiguous data structures.
- PE-19: `alignas(64)` (C++) or equivalent used for cache-line-aligned hot structs.

---

## 5. Lock-Free Concurrency Patterns

### 5.1 Pattern Selection

| Pattern | Use When | Stack Support |
|---|---|---|
| **SPSC** (Single Producer Single Consumer) | 1 writer, 1 reader, max throughput | C++: `boost::lockfree::spsc_queue`, Go: channel (buffered), Java: `Disruptor` |
| **MPSC** (Multi Producer Single Consumer) | N writers, 1 reader | C++: `boost::lockfree::queue`, Go: channel, Java: `ConcurrentLinkedQueue` |
| **MPMC** (Multi Producer Multi Consumer) | N writers, N readers | C++: `boost::lockfree::queue`, Java: `Disruptor MPMC`, Go: channel |
| **Ring Buffer** | Fixed-size, predictable latency | C++: manual, Java: `Disruptor`, Go: manual |

### 5.2 Rules
- PE-20: `std::mutex` / lock-based synchronization forbidden on the hot path — use lock-free primitives.
- PE-21: SPSC queues preferred over MPSC/MPMC when topology allows — lower overhead.
- PE-22: `std::atomic` with `memory_order_relaxed` / `memory_order_acquire_release` used explicitly — no default `seq_cst` on hot paths without justification.
- PE-23: All lock-free data structures must be verified with ThreadSanitizer (TSan) in CI.
- PE-24: ABA problem mitigation documented for any CAS-based structure.

---

## 6. Branch Prediction

- PE-25: Unpredictable branches on hot paths avoided — data-oriented design preferred over polymorphism.
- PE-26: `[[likely]]` / `[[unlikely]]` (C++20) or `__builtin_expect` used for hot branch hints.
- PE-27: Virtual dispatch on hot paths requires explicit justification in code comment + benchmark.
- PE-28: Switch statements on hot paths over enums preferred over virtual dispatch.

---

## 7. I/O and System Calls

- PE-29: System calls on hot paths forbidden — batch or pipeline IO operations.
- PE-30: Blocking IO never on hot path — use async IO (io_uring, epoll, kqueue, IOCP per platform).
- PE-31: Network serialization on hot path uses zero-copy techniques (sendfile, splice, scatter-gather).
- PE-32: Memory-mapped files preferred over read/write syscalls for high-throughput file access.

---

## 8. Profiling Requirements

**Profiling before optimizing is mandatory. No optimization without data.**

- PE-33: A performance baseline benchmark MUST exist before any optimization is made.
- PE-34: All hot path changes MUST include a benchmark diff (`before` vs `after` in PR description).
- PE-35: Profiling MUST be performed in production-equivalent conditions — not debug builds.
- PE-36: Flame graphs MUST be generated for any regression investigation.

### 8.1 Profiling Tools by Stack

| Stack | CPU Profiler | Memory Profiler | Benchmark |
|---|---|---|---|
| **C++** | `perf`, Intel VTune, `gprof` | `heaptrack`, `valgrind/massif` | Google Benchmark |
| **Go** | `pprof` (cpu) | `pprof` (mem), `go tool trace` | `go test -bench`, `benchstat` |
| **Java** | async-profiler, JFR | JFR heap profiling, MAT | JMH |
| **PHP** | Blackfire, Xdebug profiler | Blackfire memory | Blackfire |
| **Rust** | `perf`, `flamegraph` | `heaptrack`, `dhat` | `criterion` |

---

## 9. Benchmarking Standards

- PE-37: Benchmarks MUST be deterministic — controlled CPU frequency, no thermal throttling.
- PE-38: Microbenchmarks run with sufficient iterations to eliminate JIT warmup noise (Java: ≥5 warmup + 10 measure iterations via JMH).
- PE-39: Benchmark results include: mean, p50, p95, p99, p999, allocations/op, and GC pauses (where applicable).
- PE-40: Benchmark regressions > 5% on hot paths block merge — enforced in CI.
- PE-41: Benchmarks live alongside the code they measure (`_bench_test.go`, `BenchmarkSuite`, etc.) — not in a separate repo.

---

## 10. Memory Management

- PE-42: Memory arenas (region-based allocation) used for request-scoped allocations on hot paths.
- PE-43: Object pools sized to steady-state throughput — not unbounded.
- PE-44: GC pressure metrics (GC pause time, allocation rate) monitored in production dashboards.
- PE-45: Finalization / destructors on hot path objects forbidden (C++: no expensive destructors in hot path; Java: no `finalize()`).

---

## 11. Serialization on Hot Paths

- PE-46: JSON serialization forbidden on the hot path — use binary protocols (FlatBuffers, Cap'n Proto, protobuf with arena).
- PE-47: Schema-less serialization forbidden on hot paths — compile-time-known schemas only.
- PE-48: Copy-on-deserialize forbidden — use zero-copy deserialization where possible (FlatBuffers, Cap'n Proto).

---

## 12. Observability on Hot Paths

- PE-49: Structured logging NEVER happens on the hot path — use ring-buffer log aggregation or sampling.
- PE-50: Metrics on hot paths use lock-free counters (`std::atomic`, `prometheus-cpp` lock-free) — never mutex-protected.
- PE-51: Distributed tracing spans NOT created per hot-path operation — create at batch/aggregate level only.
- PE-52: Sampling rate for hot-path telemetry externalized in config — never 100% trace on high-frequency paths.

---

## 13. Testing Requirements

- PE-53: Load tests mandatory for all hot path changes — simulate production traffic patterns.
- PE-54: Latency regression tests block merge if p99 degrades > 10% vs baseline.
- PE-55: Chaos/fault injection tests verify graceful degradation under backpressure.

---

## 14. ADR Requirements

Any deviation from this standard on an activated service requires an ADR. Specifically:
- Using heap allocation on hot path
- Using locking on hot path
- Using JSON serialization on hot path
- Skipping a benchmark for a hot path change

---

## Glossary

| Term | Definition |
|---|---|
| **Hot Path** | Code executed per critical-lane request/event — µs budget |
| **Cold Path** | Infrequent code — startup, error, admin |
| **SPSC** | Single Producer Single Consumer — lock-free queue topology |
| **MPSC** | Multi Producer Single Consumer |
| **MPMC** | Multi Producer Multi Consumer |
| **SoA** | Structure of Arrays — cache-friendly batch layout |
| **AoS** | Array of Structures — common but cache-unfriendly |
| **False Sharing** | Two threads accessing different data on the same cache line — causes invalidation |
| **ABA Problem** | CAS race condition where value returns to original — mitigated by tagged pointers |
| **Arena Allocator** | Region-based allocator — bulk-free all at once, zero per-object overhead |
