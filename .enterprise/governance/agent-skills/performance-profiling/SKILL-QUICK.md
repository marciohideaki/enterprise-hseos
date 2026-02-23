---
skill: performance-profiling
tier: 1
version: "1.0"
---

# Performance Profiling — Quick Checklist

> Load this for PRs touching hot paths, benchmarks, or performance-sensitive code.
> Load SKILL.md only for deep profiling audits or regression investigations.

---

## Hot Path Checklist

- [ ] Hot path annotated with `// HOT PATH` comment.
- [ ] No heap allocation on hot path (`allocs/op = 0` in benchmark or escape analysis clean).
- [ ] No mutex / lock on hot path — lock-free or single-threaded.
- [ ] No system calls or blocking IO on hot path.
- [ ] No JSON serialization on hot path.
- [ ] No logging on hot path (ring-buffer or sampling only).
- [ ] No virtual dispatch on hot path without benchmark justification.

## Benchmark Checklist

- [ ] Benchmark exists for the changed hot path.
- [ ] PR description includes `before` vs `after` benchmark numbers.
- [ ] p99 latency did not regress > 10% vs baseline.
- [ ] Allocations/op did not increase vs baseline.

## Concurrency Checklist (if applicable)

- [ ] Lock-free queue pattern chosen correctly for topology (SPSC / MPSC / MPMC).
- [ ] TSan build passes.
- [ ] ABA problem documented/mitigated for CAS-based structures.

## Memory Layout (if applicable)

- [ ] False sharing prevented — hot fields padded to cache line (64 bytes).
- [ ] SoA layout used instead of AoS for batch-processed hot data.
