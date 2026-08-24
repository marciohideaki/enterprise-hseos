# Baseline — Global Platform Capability Graph

**Goal:** Make Platform-First and Contract-First governance executable across repositories
and agents through a versioned federated capability graph.

**Authority:** Owner approval in the active session on 2026-08-24; Enterprise Constitution;
ADR-0022.

## Observed

- The Enterprise Constitution v2.1 applied globally but did not require a capability graph.
- The platform workspace had a capability manifest, contracts, packages, and projections,
  but not typed project/module/consumer/evidence relationships.
- The accepted platform learning already established contract → projection → conformance →
  registry → discovery.
- Semantic search retrieved that precedent with score 0.611.
- The cybernetic audit finding F-005 showed that constitutional immutability was nominal:
  no CODEOWNERS enforcement, version-diff gate, or mandatory code-owner review.
- ADR policy requires an approved ADR before governance implementation.

## Inferred

- A federated graph avoids both a monolithic write bottleneck and independent local catalogs.
- Git must remain authoritative; FalkorDB and Qdrant are reproducible projections.
- Deterministic validation must fail closed; semantic discovery must remain advisory.

## Unverified at baseline

- Complete adoption evidence for every platform capability and consumer repository.
- Live branch-protection state in GitHub.
- Availability and freshness of FalkorDB/Qdrant projections for every repository.

## Scope allow-list

- `enterprise-hseos`: Constitution, ADR, core standard, policy, graph contracts, graph source,
  validators, tests, CI/quality gates, compiled agent instructions, and run evidence.
- Platform workspace and core repositories: migration adapters/fragments and deterministic
  validation only after the enterprise foundation passes.

## Prohibited without a new gate

- Push, remote PR creation, protected-branch merge, release, package publication, deployment,
  live infrastructure mutation, secret access, data/schema migration, or semantic
  auto-promotion.

## Acceptance criteria

1. ADR-0022 is accepted with explicit human evidence.
2. Constitution v2.2 contains stable Platform-First graph invariants.
3. Constitutional diffs require monotonic version bump, accepted ADR linkage, CODEOWNERS,
   and code-owner review in desired branch protection.
4. Graph schema, registry, fragment, exact query, and fail-closed validator exist.
5. Negative tests reject traversal, dangling edges, ambiguous ownership, cycles, expired
   exceptions, and semantic auto-promotion.
6. Vendor-neutral instructions compile the same directive for all adapters.
7. The existing platform manifest is migrated without becoming a competing authority.

## Verification

- `npm run test:capability-graph`
- `npm run lint`
- `npm test`
- `VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh`
- Deliberate negative fixtures in `test/test-capability-graph-governance.js`

## Rollback

Before merge, delete the local feature/task branches and worktrees. After merge but before
federated adoption, revert the initiative commits. After consumers adopt stable graph IDs,
rollback requires a superseding ADR and migration plan.

## Stop conditions

Stop on deterministic gate failure with unclear cause, standards conflict, missing authority,
or any action in the prohibited list.
