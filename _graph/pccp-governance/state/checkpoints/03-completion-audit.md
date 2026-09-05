# Checkpoint 03 — Completion audit and refutation

Status: technically validated; pending human gates

The final audit is recorded at `../../../../docs/audits/PCCP-COMPLETION-AUDIT.md`. Revalidation
corrected stale checkpoint counts: Platform Core now has 18 nodes and 25 edges after
EventEnvelope/Unit of Work content reconciliation; Backend conformance has 98 passing cases; the
full Backend solution has 588 passing tests; graph governance has 19 passing tests. PCCP graph,
intake, and consolidated Backend suites reject 23, 13, and 15 negative cases respectively; intake
also passes two format-specific dependency
proof checks, including the real NuGet `packages.lock.json` shape.

Final refutation closed declarative compatibility baselines, declarative verified installs,
substring installation proof, arbitrary real-consumer evidence, dossier self-classification,
unrelated extend evidence, incomplete approved-decision composition, unauthenticated overlay
origins, and the canonical bold ADR status format.

The counts above supersede the earlier 541/10 checkpoint snapshot; they do not imply activation,
publication or adoption.

Official graph composition now has a mandatory `--require-all-fragments` mode and a CI
workflow. Local composition validates three immutable fragments and explicitly defers one.
The registered Cambio SHA is unreachable from its public remote and current main contains no
fragment, so official composition remains deliberately fail-closed pending owner action.

The Backend task branch observed during revalidation is `task/capability-foundation-wave1`.
This records drift from the immutable baseline without rewriting that baseline.
