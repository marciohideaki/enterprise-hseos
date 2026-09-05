# Checkpoint 02 — Implementation and validation

Historical snapshot. Later deterministic counts and the Platform root reconciliation are recorded
in `03-completion-audit.md`; this checkpoint must not be used as the current aggregate result.

Status: technically validated; pending human gates

## Implemented candidates

- ADR-0036 is Proposed and defines PCCP taxonomy, dependency direction, distinctions,
  compatibility, versioning, migration, rollback, and activation gates.
- Governance standard and graph policy are 2.0.0-draft overlays; the existing accepted
  rules remain active.
- Graph schema 2.0.0 is a non-activated candidate with validated classifiers; schema 1.0.0
  remains pinned in the registry.
- Intake v3 is a non-activated candidate; intake v2 remains the active decision contract.
- Platform Core records the proposed Unit of Work specification, contracts, ports, ownership,
  and evidence without publication or adoption claims.
- Backend Core contains source-only 0.0.1 projections/adapters and fail-closed conformance
  tests. The graph registration is a proposed noncanonical patch awaiting reconciliation with
  the canonical backend fragment on its separate JVM branch.

## Verification evidence

- Enterprise graph governance tests: 19/19 passed.
- Enterprise capability reference tests: 9/9 passed.
- Candidate graph negative fixtures: 23/23 rejected by the governance test suite.
- Platform Core validation: 24 schemas, 3 examples, 9 contract negatives and 13 intake
  negatives; fragment 15 nodes, 22 edges, zero findings; 3 graph self-test negatives rejected.
- Backend solution: 541/541 tests passed with the canonical schema root; Unit of Work tests
  passed 7/7 and conformance passed 98/98.
- Missing canonical schema in official mode produced the expected FileNotFoundException and
  a failing test run; development mode reports an explicit diagnostic skip.
- Local NuGet packing produced the three requested packages and symbols at unchanged version
  0.0.1, with no publication.
- `git diff --check` passed in all three worktrees.
- Dependency inspection confirmed abstractions has no project dependency; the EF Core
  transaction adapter depends on abstractions; the messaging EF adapter depends on inbox and
  outbox contracts.

## Known limitations and gates

- The Wave 1 Backend overlay is valid locally but is not a second canonical fragment; owner
  reconciliation into the authoritative Backend fragment remains gated.
- Official backend CI still needs an immutable checkout/pin of Platform Core after the
  canonical contract lands; the gate is deliberately fail-closed until then.
- Enterprise lint and schema checks pass. `git diff --check` passes in all task worktrees.
- No ADR/schema/intake was accepted or activated, no package was published, no installation
  or adoption was asserted, and no push/PR/merge/deploy occurred.
