# Managed Governance Control Plane — Task Contracts

**Status:** Approved for `managed-shadow` implementation on 2026-09-01
**Execution rule:** sequential, isolated worktree per task, one verified task per commit
**Activation gate:** satisfied by explicit human acceptance of ADR-0032 on 2026-09-01;
`managed-enforced` remains prohibited

The task order is intentionally sequential. A task may start only after all dependencies are merged
into `feature/managed-governance-control-plane` and its input files exist at the declared versions.

```yaml
tasks:
  - id: T01
    name: Implement managed governance contracts
    description: >-
      Create the infrastructure-neutral package with strict Zod schemas, canonical JSON,
      digest calculation, closed vocabularies and public parsing helpers for every v1 contract.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/spec.md
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - packages/agent-runtime-contracts/common.js
        - packages/agent-runtime-contracts/package.json
      data:
        - FR-001 through FR-007
        - NFR-004, NFR-006 and NFR-008
      dependencies: []
    output_contract:
      files:
        - packages/managed-governance-contracts/package.json
        - packages/managed-governance-contracts/index.js
        - packages/managed-governance-contracts/schemas.js
        - packages/managed-governance-contracts/canonical-json.js
        - packages/managed-governance-contracts/README.md
        - package.json
        - test/managed-governance/contracts.test.js
        - test/managed-governance/fixtures/contracts-valid.json
        - test/managed-governance/fixtures/contracts-invalid.json
      artifacts:
        - strict and frozen v1 parse results
        - deterministic SHA-256 digests
        - valid, invalid, unknown-field and boundary fixtures
    constraints:
      - Node.js >=20 and CommonJS
      - No database, filesystem, HTTP or MCP dependency
      - Unknown fields and unsupported versions fail closed
      - No secret value field in public contracts
    acceptance_criteria:
      - Every schema named in design Contract Design is exported
      - Canonical serialization is key-order deterministic and rejects unsupported JSON values
      - Digest values use sha256 followed by 64 lowercase hexadecimal characters
      - Size, count, identifier, timestamp and enum boundaries have failing tests
      - Repeated parse returns deeply frozen semantically identical data
    execution_mode: isolated
    verify_step:
      type: automated
      command: npm run test:managed-governance-contracts
      expected: 0 failed and all contract fixtures exercised
      fallback: node -e "require('./packages/managed-governance-contracts')"
      on_failure: retry_once_then_escalate

  - id: T02
    name: Implement secure source discovery and import planning
    description: >-
      Implement the Git governance source adapter, secure file discovery, deterministic
      classification, source profiles and a pure import planner that performs no persistence.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - packages/managed-governance-contracts/index.js
        - scripts/governance/validate-repository-contract.js
      data:
        - FR-008 through FR-015
        - Import and Seed Design source allowlist
      dependencies: [T01]
    output_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - tools/managed-governance-control-plane/lib/domain/import-plan.js
        - tools/managed-governance-control-plane/lib/infrastructure/git/governance-source.js
        - tools/managed-governance-control-plane/lib/infrastructure/git/source-profiles.js
        - tools/managed-governance-control-plane/lib/infrastructure/git/classifiers.js
        - package.json
        - test/managed-governance/import-plan.test.js
      artifacts:
        - deterministic read-only ImportPlan
        - review items for uncertain classification
        - parity accounting for every discovered source
    constraints:
      - Do not read generated .agents, worktrees, logs or paths outside the repository
      - Do not execute imported content
      - Reject symlink escape, special files and oversized files
      - Planning performs zero writes
    acceptance_criteria:
      - The current Constitution is discovered and classified as constitution
      - Current ADRs, policies, standards, capabilities, hooks, workflows and skills are accounted for
      - Same tree and commit produce byte-identical plans
      - Symlink escape and path traversal fixtures fail before content read
      - Ambiguous prose is unclassified and never emits an executable rule
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/managed-governance/import-plan.test.js
      expected: 0 failed with deterministic and security fixtures passing
      fallback: node -e "require('./tools/managed-governance-control-plane/lib/domain/import-plan')"
      on_failure: retry_once_then_escalate

  - id: T03
    name: Implement PostgreSQL schema and repository adapter
    description: >-
      Add immutable ordered migrations, database roles/RLS, transactional repository adapter,
      audit/outbox writes and an in-memory repository fake with the same port contract.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - packages/managed-governance-contracts/index.js
        - packages/agent-session-store/session-event-store.js
      data:
        - FR-028 through FR-030
        - Data Model required invariants
      dependencies: [T01]
    output_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - package.json
        - package-lock.json
        - tools/managed-governance-control-plane/package.json
        - tools/managed-governance-control-plane/lib/domain/repository-port.js
        - tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository.js
        - tools/managed-governance-control-plane/lib/infrastructure/postgres/pool.js
        - tools/managed-governance-control-plane/lib/infrastructure/postgres/migrator.js
        - tools/managed-governance-control-plane/lib/infrastructure/postgres/governance-repository.js
        - tools/managed-governance-control-plane/migrations/0001_initial_control_plane.sql
        - test/managed-governance/repository-contract.test.js
        - test/managed-governance/postgres.integration.test.js
      artifacts:
        - repository port conformance shared by memory and PostgreSQL adapters
        - forward-only migration with tenant RLS and database roles
    constraints:
      - Parameterized SQL only
      - No shared table with existing execution or project state
      - Application role cannot update immutable published versions or audit events
      - PostgreSQL integration test skips only when its explicit test URL is absent
    acceptance_criteria:
      - Fresh migration and repeated migration are idempotent
      - Every tenant table has organization_id and enabled RLS
      - Mutation, audit event and outbox record commit or roll back together
      - Duplicate idempotency key returns the original result without duplicate rows
      - Memory and PostgreSQL adapters pass the same repository contract suite
    execution_mode: isolated
    verify_step:
      type: compound
      command: node --test test/managed-governance/repository-contract.test.js test/managed-governance/postgres.integration.test.js
      expected: repository contract passes; PostgreSQL suite passes when HSEOS_GOVERNANCE_TEST_DATABASE_URL is set
      fallback: node -e "require('./tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository')"
      on_failure: retry_once_then_escalate

  - id: T04
    name: Implement idempotent catalog seed and synchronization
    description: >-
      Connect ImportPlan to the repository port with plan, apply and rollback-batch use cases,
      active-batch promotion and machine-readable parity reporting.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - tools/managed-governance-control-plane/lib/domain/import-plan.js
        - tools/managed-governance-control-plane/lib/domain/repository-port.js
      data:
        - FR-009 through FR-015
        - NFR-008, NFR-011 and NFR-012
      dependencies: [T02, T03]
    output_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - package.json
        - tools/managed-governance-control-plane/lib/application/import-catalog.js
        - tools/managed-governance-control-plane/lib/application/rollback-import.js
        - tools/managed-governance-control-plane/lib/application/catalog-parity.js
        - tools/managed-governance-control-plane/lib/domain/repository-port.js
        - tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository.js
        - tools/managed-governance-control-plane/lib/infrastructure/postgres/governance-repository.js
        - tools/managed-governance-control-plane/migrations/0002_catalog_source_snapshots.sql
        - test/managed-governance/import-apply.test.js
        - test/managed-governance/seed-current-governance.test.js
        - test/managed-governance/postgres.integration.test.js
      artifacts:
        - one seed path shared with ongoing synchronization
        - deterministic parity and rollback reports
    constraints:
      - No hard deletion of artifact history or audit
      - Readers never observe a partially promoted import batch
      - A failed batch preserves the prior active batch
    acceptance_criteria:
      - Empty repository seeds from the current canonical governance tree
      - Reapplying the same source commit creates zero new versions
      - Changed content creates exactly one immutable version
      - Rename and removal are explicit report items, not destructive deletes
      - Every discovered file is classified, partial or unclassified in the parity report
      - Rollback restores the previous active batch while retaining audit history
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/managed-governance/import-apply.test.js test/managed-governance/seed-current-governance.test.js
      expected: 0 failed and second seed reports no-op
      fallback: node --test test/managed-governance/import-apply.test.js
      on_failure: retry_once_then_escalate

  - id: T05
    name: Implement policy resolution and shadow comparison
    description: >-
      Implement deterministic scope matching, precedence, monotonic restriction, conflict handling,
      explanation trees and a shadow comparator that never changes the local outcome.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - packages/managed-governance-contracts/index.js
        - packages/agent-policy-lattice/index.js
        - packages/governed-execution/execution-port.js
      data:
        - FR-006, FR-007 and FR-022 through FR-027
        - Policy Resolution precedence table
      dependencies: [T01, T03]
    output_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - package.json
        - tools/managed-governance-control-plane/lib/domain/policy-resolver.js
        - tools/managed-governance-control-plane/lib/application/evaluate-policy.js
        - tools/managed-governance-control-plane/lib/application/compare-shadow-decision.js
        - test/managed-governance/policy-resolution.test.js
        - test/managed-governance/shadow-parity.test.js
      artifacts:
        - GovernanceDecision v1 with explanation evidence
        - non-authoritative parity mismatch record
    constraints:
      - No eval, embedded script or arbitrary expression language
      - Lower precedence cannot widen authority without an approved exception
      - Local decision remains authoritative in managed-shadow
    acceptance_criteria:
      - Matching is deterministic independent of input rule order
      - Same-precedence contradiction fails closed with stable reason code
      - Higher-precedence deny cannot be widened by a lower rule
      - Acceptance never satisfies an operational approval obligation
      - Shadow mismatch records both digests and returns the unchanged local result
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/managed-governance/policy-resolution.test.js test/managed-governance/shadow-parity.test.js
      expected: 0 failed across allow, deny, conflict and mismatch cases
      fallback: node --test test/managed-governance/policy-resolution.test.js
      on_failure: retry_once_then_escalate

  - id: T06
    name: Implement versioned control-plane HTTP API
    description: >-
      Add the loopback-by-default HTTP adapter, stable envelopes/errors, actor context,
      pagination, health and application-port wiring for catalog, imports, drafts and policy preview.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - tools/managed-governance-control-plane/lib/domain/repository-port.js
        - tools/managed-governance-control-plane/lib/application/import-catalog.js
        - tools/managed-governance-control-plane/lib/application/evaluate-policy.js
      data:
        - FR-016 through FR-021 and FR-024
        - HTTP API v1 table
      dependencies: [T04, T05]
    output_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - package.json
        - tools/managed-governance-control-plane/server.js
        - tools/managed-governance-control-plane/lib/interfaces/http/router.js
        - tools/managed-governance-control-plane/lib/interfaces/http/envelope.js
        - tools/managed-governance-control-plane/lib/interfaces/http/auth.js
        - tools/managed-governance-control-plane/lib/application/manage-draft.js
        - tools/managed-governance-control-plane/lib/application/request-publication.js
        - test/managed-governance/http.test.js
      artifacts:
        - versioned loopback HTTP service
        - authenticated mutation boundary and stable error codes
    constraints:
      - Node built-in HTTP or an explicitly approved bounded dependency
      - Bind 127.0.0.1 unless a secure external profile is explicit
      - No anonymous mutations and no database object exposed in handlers
      - Request body, timeout and pagination limits are mandatory
    acceptance_criteria:
      - Every designed endpoint returns the canonical envelope
      - Unknown route, invalid body, conflict and unavailable database map to stable codes
      - Mutation without actor context is rejected
      - Health distinguishes liveness, readiness, migration and projection state
      - Graceful shutdown drains requests and closes repository resources
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/managed-governance/http.test.js
      expected: 0 failed including auth, limits, error and shutdown cases
      fallback: node -e "require('./tools/managed-governance-control-plane/server')"
      on_failure: retry_once_then_escalate

  - id: T07
    name: Implement managed governance CLI commands
    description: >-
      Wire catalog plan/apply/status, artifact queries, policy evaluation and sidecar start into the
      existing hseos CLI using the same application ports and canonical envelopes.
    estimated_scope: Medium
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - tools/cli/hseos-cli.js
        - tools/managed-governance-control-plane/server.js
        - tools/managed-governance-control-plane/lib/application/import-catalog.js
      data:
        - CLI command design
        - FR-014 and FR-024
      dependencies: [T04, T05, T06]
    output_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - package.json
        - tools/cli/commands/governance.js
        - tools/cli/lib/managed-governance/commands.js
        - tools/cli/lib/managed-governance/output.js
        - tools/cli/hseos-cli.js
        - test/managed-governance/cli.test.js
      artifacts:
        - non-interactive JSON commands
        - human-readable projections of the same envelope
    constraints:
      - Plan mode performs no writes
      - Apply requires explicit database configuration and actor identity
      - No implicit fallback from managed configuration to another repository
    acceptance_criteria:
      - Every documented command has success and invalid-input tests
      - JSON output is stable and contains no terminal formatting
      - Plan output is deterministic and apply is idempotent
      - Server start defaults to loopback
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/managed-governance/cli.test.js
      expected: 0 failed for JSON and human modes
      fallback: node tools/cli/hseos-cli.js governance --help
      on_failure: retry_once_then_escalate

  - id: T08
    name: Implement schema-driven governance console
    description: >-
      Build the sidecar UI for overview, artifacts, rule/standard/contract/stack drafts, review,
      diff, simulation, publication artifact and audit, consuming only the HTTP API.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - packages/managed-governance-contracts/schemas.js
        - tools/managed-governance-control-plane/lib/interfaces/http/router.js
      data:
        - FR-016 through FR-021
        - Console Design screens and accessibility target
      dependencies: [T06]
    output_contract:
      files:
        - tools/managed-governance-control-plane/public/index.html
        - tools/managed-governance-control-plane/public/app.js
        - tools/managed-governance-control-plane/public/styles.css
        - tools/managed-governance-control-plane/public/ui-schemas.json
        - tools/managed-governance-control-plane/lib/interfaces/http/static-assets.js
        - test/managed-governance/console.test.js
      artifacts:
        - schema-driven accessible console served by sidecar
        - no direct database or Git mutation path
    constraints:
      - WCAG 2.1 AA target
      - Strict CSP and no runtime third-party CDN
      - Keyboard-complete forms, focus management and error summary
      - Publication produces a downloadable review artifact only
    acceptance_criteria:
      - Every supported authoring type renders from versioned UI schema
      - Client and server validation errors are visible and associated with fields
      - Rule preview includes scope, selected sources and explanation
      - No UI bundle contains database credentials or direct Git push behavior
      - DOM smoke covers labels, landmarks, focus and reduced-motion behavior
    execution_mode: isolated
    verify_step:
      type: compound
      command: node --test test/managed-governance/console.test.js
      expected: 0 failed for routes, CSP, form schemas and accessibility smoke
      fallback: node --test test/managed-governance/console.test.js
      on_failure: retry_once_then_escalate

  - id: T09
    name: Extend governance MCP with read-only managed queries
    description: >-
      Route current and new governance tools through GovernanceQueryPort, preserving compatibility
      and keeping administrative commands unavailable to MCP.
    estimated_scope: Medium
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - tools/mcp-hseos-governance/server.js
        - tools/mcp-hseos-governance/lib/spec-reader.js
        - tools/managed-governance-control-plane/lib/application/evaluate-policy.js
        - test/test-mcp-hseos-governance.js
      data:
        - FR-024 and FR-025
        - MCP evolution tool list
      dependencies: [T05, T06]
    output_contract:
      files:
        - tools/mcp-hseos-governance/server.js
        - tools/mcp-hseos-governance/lib/governance-query-adapter.js
        - test/managed-governance/mcp.test.js
        - test/test-mcp-hseos-governance.js
      artifacts:
        - backward-compatible legacy tools
        - stateless read-only managed tools
    constraints:
      - No command port or PostgreSQL client inside MCP
      - Existing tool names and portable semantics remain compatible
      - Project-local configuration only
    acceptance_criteria:
      - Existing MCP test suite remains green
      - New tools return the same decisions as HTTP and CLI fixtures
      - Repeated requests retain no authorization or session state in the server
      - No administrative mutation tool is registered
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/test-mcp-hseos-governance.js test/managed-governance/mcp.test.js
      expected: 0 failed and no mutation tool exposed
      fallback: npm run test:mcp-governance
      on_failure: retry_once_then_escalate

  - id: T10
    name: Implement managed client and shadow snapshot flow
    description: >-
      Create the optional client, binding loader, last-known-good snapshot store and shadow query
      flow while making managed-enforced activation fail closed.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - packages/managed-governance-contracts/index.js
        - tools/managed-governance-control-plane/lib/application/compare-shadow-decision.js
        - test/test-repository-identity-contract.js
      data:
        - FR-022, FR-023, FR-026 and FR-027
        - NFR-009 and NFR-010
      dependencies: [T01, T05, T06]
    output_contract:
      files:
        - packages/managed-governance-client/package.json
        - packages/managed-governance-client/index.js
        - packages/managed-governance-client/client.js
        - packages/managed-governance-client/binding-loader.js
        - packages/managed-governance-client/snapshot-store.js
        - packages/managed-governance-client/README.md
        - test/managed-governance/client.test.js
        - test/managed-governance/snapshot.test.js
      artifacts:
        - opt-in managed-shadow client
        - atomic last-known-good snapshot cache
        - explicit enforced-not-activated result
    constraints:
      - Binding contains no secret values
      - Snapshot promotion is atomic and digest-verified
      - Offline shadow is marked degraded and bounded to configured age
      - No home-directory or machine-global default path
    acceptance_criteria:
      - Binding identity mismatch fails before network access
      - Valid cached snapshot supports degraded shadow queries
      - Expired or corrupt snapshot is never treated as valid
      - managed-enforced returns enforcement_unavailable until accepted activation exists
      - Timeouts, retries and circuit states emit typed results
    execution_mode: isolated
    verify_step:
      type: automated
      command: node --test test/managed-governance/client.test.js test/managed-governance/snapshot.test.js
      expected: 0 failed across online, offline, mismatch and corrupt-cache cases
      fallback: node -e "require('./packages/managed-governance-client')"
      on_failure: retry_once_then_escalate

  - id: T11
    name: Register managed surfaces and package contracts
    description: >-
      Add explicit capability lifecycle entries, package surfaces, installer visibility and
      documentation for opt-in managed module, candidate preflight and sidecars.
    estimated_scope: Medium
    input_contract:
      files:
        - .enterprise/.specs/decisions/ADR-0030-surface-lifecycle-contract.md
        - .enterprise/governance/capabilities/surfaces.yaml
        - .enterprise/governance/capabilities/components.yaml
        - tools/cli/lib/capability-catalog.js
        - test/test-capability-catalog.js
        - test/test-package-surface.js
      data:
        - FR-031 and FR-032
        - Lifecycle and packaging design
      dependencies: [T07, T08, T09, T10]
    output_contract:
      files:
        - .enterprise/governance/capabilities/surfaces.yaml
        - .enterprise/governance/capabilities/components.yaml
        - .agents/capabilities/surfaces.yaml
        - .agents/capabilities/components.yaml
        - package.json
        - test/test-capability-catalog.js
        - test/test-package-surface.js
        - docs/MANAGED-GOVERNANCE.md
      artifacts:
        - compiled lifecycle catalog with exact coverage
        - bounded package/install surface
    constraints:
      - Edit enterprise sources before compiled .agents outputs
      - Portable baseline remains required core
      - Managed client is opt-in module and sidecars have no baseline activation
      - No undocumented package file enters distribution
    acceptance_criteria:
      - Catalog validation classifies every new static component exactly once
      - Install plan omits managed surfaces unless explicitly selected
      - Package-surface test includes intended contracts and excludes runtime state/secrets
      - Portable install and uninstall tests remain green
    execution_mode: isolated
    verify_step:
      type: automated
      command: npm run test:capabilities && npm run test:package-surface && npm run test:install
      expected: all commands exit 0 with managed surfaces opt-in
      fallback: npm run test:capabilities
      on_failure: retry_once_then_escalate

  - id: T12
    name: Execute security, conformance and completion hardening
    description: >-
      Add cross-adapter parity, import security, tenant isolation, portable regression,
      observability and performance evidence; perform adversarial review and remediate findings.
    estimated_scope: Large
    input_contract:
      files:
        - .enterprise/.specs/features/managed-governance-control-plane/spec.md
        - .enterprise/.specs/features/managed-governance-control-plane/design.md
        - .enterprise/.specs/features/managed-governance-control-plane/tasks.md
        - test/managed-governance/contracts.test.js
        - test/managed-governance/postgres.integration.test.js
        - test/managed-governance/http.test.js
        - test/managed-governance/mcp.test.js
      data:
        - Every FR and NFR
        - ADR-0032 activation exclusions
      dependencies: [T01, T02, T03, T04, T05, T06, T07, T08, T09, T10, T11]
    output_contract:
      files:
        - test/managed-governance/conformance.test.js
        - test/managed-governance/security.test.js
        - test/managed-governance/performance.test.js
        - .logs/summaries/managed-governance-validation.md
        - .enterprise/.specs/features/managed-governance-control-plane/verification-matrix.md
      artifacts:
        - requirement-to-evidence completion matrix
        - adversarial findings and remediation evidence
        - full quality-gate result
    constraints:
      - No managed-enforced activation
      - No waived failing gate or high/critical security finding
      - Resource-intensive stages run sequentially
      - Validation summary contains no secrets or personal data
    acceptance_criteria:
      - Every FR and NFR has direct passing evidence or is explicitly not activated by scope
      - HTTP, CLI and MCP produce equivalent decision semantics
      - Tenant, symlink, traversal, injection, replay and oversized-input attacks fail closed
      - Portable npm test suite and full enforced quality gates pass
      - Adversarial review has no unresolved critical or high finding
    execution_mode: isolated
    verify_step:
      type: compound
      command: VALIDATION_ENFORCED=true ./scripts/governance/quality-gates.sh
      expected: all mandatory gates pass and verification matrix is complete
      fallback: node --test test/managed-governance/conformance.test.js test/managed-governance/security.test.js
      on_failure: retry_once_then_escalate
```

## Traceability

| Requirement group | Primary tasks           |
| ----------------- | ----------------------- |
| FR-001–FR-007     | T01, T05                |
| FR-008–FR-015     | T02, T04                |
| FR-016–FR-021     | T06, T08                |
| FR-022–FR-027     | T05, T09, T10           |
| FR-028–FR-032     | T03, T11, T12           |
| NFR-001–NFR-005   | T02, T03, T06, T08, T12 |
| NFR-006–NFR-008   | T01, T02, T04, T12      |
| NFR-009–NFR-012   | T03, T04, T10, T12      |
| NFR-013–NFR-018   | T03, T06, T08, T12      |

## Stop Conditions

- ADR-0032 is not Accepted: stop before T01.
- A task discovers a new authority boundary: update spec/design and draft another ADR.
- PostgreSQL integration cannot prove RLS or transaction invariants: do not expose mutation.
- Shadow differs without a deterministic explanation: do not progress toward enforcement.
- Any adapter cannot prove blocking prelaunch: it remains shadow-only.
