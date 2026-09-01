# Managed Governance Shadow Readiness — Task Contracts

**Status:** Planned
**Execution:** sequential; one isolated task, validation and commit at a time
**Authority:** `managed-shadow` only; no task may activate `managed-enforced`

```yaml
tasks:
  - id: T01
    name: Amend managed-governance decisions and lifecycle
    description: Record authenticated shared-network shadow access and its unchanged authority boundary.
    estimated_scope: Medium
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/spec.md',
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          '.enterprise/.specs/decisions/ADR-0032-managed-governance-control-plane.md',
          '.enterprise/governance/capabilities/surfaces.yaml',
        ]
      data: ['FR-019 through FR-024', 'ADR-0030 lifecycle rules']
      dependencies: []
    output_contract:
      files:
        [
          '.enterprise/.specs/decisions/ADR-0032-managed-governance-control-plane.md',
          '.enterprise/governance/capabilities/surfaces.yaml',
          '.agents/capabilities/surfaces.yaml',
          'test/capability-profile.test.js',
        ]
      artifacts: ['accepted lifecycle amendment', 'network profile remains opt-in']
    constraints: ['No enforcement activation', 'Loopback remains default', 'No environment CIDR in canonical catalog']
    acceptance_criteria:
      [
        'ADR states non-loopback changes reachability only',
        'surface lifecycle is explicit and reversible',
        'compiled surfaces match the canonical enterprise source',
        'managed-enforced remains unavailable',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'npm run test:capability-profile',
        expected: '0 failed',
        fallback: 'node test/capability-profile.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T02
    name: Add strict shadow-readiness contracts
    description: Add versioned release, signer, patch bundle, receipt, readiness, network and recovery schemas.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'packages/managed-governance-contracts/schemas.js',
          'packages/managed-governance-contracts/index.js',
        ]
      data: ['Contract Design schemas']
      dependencies: [T01]
    output_contract:
      files:
        [
          'packages/managed-governance-contracts/schemas.js',
          'packages/managed-governance-contracts/index.js',
          'packages/managed-governance-contracts/README.md',
          'test/managed-governance/contracts.test.js',
          'test/managed-governance/fixtures/contracts-valid.json',
          'test/managed-governance/fixtures/contracts-invalid.json',
        ]
      artifacts: ['deep-frozen v1 contracts', 'valid and adversarial fixtures']
    constraints: ['Strict unknown-field rejection', 'No secret-value fields', 'Canonical JSON digest boundary']
    acceptance_criteria:
      [
        'Every design contract is exported',
        'CIDR, chronology, size and version bounds fail closed',
        'readiness can never authorize enforcement',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'npm run test:managed-governance-contracts',
        expected: '0 failed',
        fallback: 'node --test test/managed-governance/contracts.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T03
    name: Persist releases receipts and readiness evidence
    description: Add forward-only migrations and repository ports for immutable release and observation evidence.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'tools/managed-governance-control-plane/lib/domain/repository-port.js',
          'tools/managed-governance-control-plane/lib/infrastructure/postgres/governance-repository.js',
        ]
      data: ['Data Model tables', 'T02 contracts']
      dependencies: [T02]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/migrations/0005_shadow_readiness.sql',
          'tools/managed-governance-control-plane/lib/domain/repository-port.js',
          'tools/managed-governance-control-plane/lib/infrastructure/memory/governance-repository.js',
          'tools/managed-governance-control-plane/lib/infrastructure/postgres/governance-repository.js',
          'test/managed-governance/repository-contract.test.js',
          'test/managed-governance/postgres.integration.test.js',
        ]
      artifacts: ['RLS migration', 'memory/PostgreSQL conformance']
    constraints: ['organization_id and forced RLS', 'Immutable evidence', 'Audit/outbox atomicity']
    acceptance_criteria:
      ['Migration is idempotent', 'runtime role cannot cross tenants or rewrite evidence', 'both adapters pass one repository suite']
    execution_mode: isolated
    verify_step:
      {
        type: compound,
        command: 'node --test test/managed-governance/repository-contract.test.js test/managed-governance/postgres.integration.test.js',
        expected: 'contracts pass; PostgreSQL passes when configured',
        fallback: 'node --test test/managed-governance/repository-contract.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T04
    name: Implement release planning and external signing
    description: Build deterministic release manifests and a private-key-free signer port.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'tools/managed-governance-control-plane/lib/application/import-catalog.js',
          'packages/managed-governance-contracts/index.js',
        ]
      data: ['FR-001 through FR-003', 'T03 repository port']
      dependencies: [T03]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/application/plan-release.js',
          'tools/managed-governance-control-plane/lib/application/publish-release.js',
          'tools/managed-governance-control-plane/lib/domain/external-signer-port.js',
          'test/managed-governance/release-publication.test.js',
        ]
      artifacts: ['deterministic manifest', 'external signature evidence']
    constraints: ['No private key access', 'Verified immutable Git commit/tag only', 'No algorithm downgrade']
    acceptance_criteria: ['Same source yields byte-identical manifest', 'signer receives digest only', 'invalid signature persists nothing']
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/release-publication.test.js',
        expected: '0 failed',
        fallback: 'node -e "require(''./tools/managed-governance-control-plane/lib/application/plan-release'')"',
        on_failure: retry_once_then_escalate,
      }

  - id: T05
    name: Complete release query and snapshot verification
    description: Replace unavailable composition stubs with repository-backed release, diff and snapshot ports.
    estimated_scope: Medium
    input_contract:
      files:
        [
          'tools/managed-governance-control-plane/composition.js',
          'tools/managed-governance-control-plane/lib/interfaces/http/router.js',
          'tools/mcp-hseos-governance/server.js',
        ]
      data: ['FR-004 through FR-006', 'T04 release contracts']
      dependencies: [T04]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/composition.js',
          'tools/managed-governance-control-plane/lib/application/query-release.js',
          'tools/managed-governance-control-plane/lib/application/verify-snapshot.js',
          'test/managed-governance/http.test.js',
          'test/managed-governance/mcp.test.js',
          'test/managed-governance/snapshot.test.js',
        ]
      artifacts: ['shared release query semantics', 'verified snapshot result']
    constraints: ['MCP read-only and stateless', 'Revoked/mismatched releases fail closed']
    acceptance_criteria:
      [
        'Production composition has no unavailable stubs',
        'HTTP CLI and MCP return equivalent contracts',
        'replay and substitution fixtures fail',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/http.test.js test/managed-governance/mcp.test.js test/managed-governance/snapshot.test.js',
        expected: '0 failed',
        fallback: 'node --test test/managed-governance/snapshot.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T06
    name: Generate deterministic patch publication bundles
    description: Export a reviewable manifest, file set, patch, provenance and rollback instructions without Git effects.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'tools/managed-governance-control-plane/lib/application/request-publication.js',
        ]
      data: ['FR-007 and FR-008', 'PatchPublicationBundleManifest/v1']
      dependencies: [T03]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/application/generate-patch-bundle.js',
          'tools/managed-governance-control-plane/lib/infrastructure/git/patch-bundle-writer.js',
          'test/managed-governance/patch-bundle.test.js',
        ]
      artifacts: ['content-addressed patch bundle', 'application and rollback instructions']
    constraints: ['New private output only', 'No commit push PR merge or tag', 'Reject links traversal and overwrite']
    acceptance_criteria:
      ['Same request is byte-identical', 'all file operations are accounted for', 'unsafe destinations fail before writes']
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/patch-bundle.test.js',
        expected: '0 failed',
        fallback: 'node -e "require(''./tools/managed-governance-control-plane/lib/application/generate-patch-bundle'')"',
        on_failure: retry_once_then_escalate,
      }

  - id: T07
    name: Implement receipt collection and readiness projection
    description: Record bounded adapter receipts and calculate the approved 30-day readiness window.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'tools/managed-governance-control-plane/lib/application/catalog-parity.js',
          'test/managed-governance/session-preflight.test.js',
        ]
      data: ['FR-009 through FR-011 and FR-024', 'NFR-006 and NFR-011']
      dependencies: [T03]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/application/record-shadow-receipt.js',
          'tools/managed-governance-control-plane/lib/application/evaluate-readiness.js',
          'test/managed-governance/readiness.test.js',
        ]
      artifacts: ['per-adapter coverage', 'non-authorizing readiness report']
    constraints: ['30 completed days', '95 percent eligible sessions', 'Sparse evidence never green']
    acceptance_criteria:
      ['missing days/repositories/adapters are explicit', 'unavailability is not equivalence', 'p95 above 500 ms fails readiness']
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/readiness.test.js',
        expected: '0 failed',
        fallback: 'node -e "require(''./tools/managed-governance-control-plane/lib/application/evaluate-readiness'')"',
        on_failure: retry_once_then_escalate,
      }

  - id: T08
    name: Implement recovery rehearsal evidence
    description: Validate deployment RPO/RTO/retention and inspect a disposable restored target without operating production.
    estimated_scope: Medium
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'tools/managed-governance-control-plane/lib/configuration.js',
        ]
      data: ['FR-015', 'RecoveryProfile/v1']
      dependencies: [T03, T04]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/application/rehearse-recovery.js',
          'tools/cli/commands/governance.js',
          'test/managed-governance/recovery-rehearsal.test.js',
        ]
      artifacts: ['measured recovery evidence', 'production-target rejection']
    constraints: ['Operator supplies disposable target', 'No backup creation or production restore']
    acceptance_criteria:
      [
        'operational target aliases fail before connection',
        'release/audit/tenant evidence is verified',
        'report compares measured values to declared profile',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/recovery-rehearsal.test.js',
        expected: '0 failed',
        fallback: 'node -e "require(''./tools/managed-governance-control-plane/lib/application/rehearse-recovery'')"',
        on_failure: retry_once_then_escalate,
      }

  - id: T09
    name: Implement deny-by-default network admission
    description: Add strict network configuration, canonical IP/CIDR matching and pre-listen validation.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'tools/managed-governance-control-plane/server.js',
          'tools/managed-governance-control-plane/lib/configuration.js',
        ]
      data: ['FR-019 through FR-021', 'ManagedNetworkProfile/v1']
      dependencies: [T02]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/network/admission.js',
          'tools/managed-governance-control-plane/lib/network/ip.js',
          'tools/managed-governance-control-plane/lib/configuration.js',
          'tools/managed-governance-control-plane/server.js',
          'test/managed-governance/network-admission.test.js',
        ]
      artifacts: ['loopback default', 'validated shared-network listener']
    constraints: ['Empty/wildcard allowlist forbidden', '0.0.0.0 requires complete controls', 'No package CIDR default']
    acceptance_criteria:
      [
        'IPv4 IPv6 and mapped addresses are canonical',
        'disallowed peers never reach handlers',
        'server opens no socket on invalid configuration',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/network-admission.test.js',
        expected: '0 failed',
        fallback: 'node -e "require(''./tools/managed-governance-control-plane/lib/network/admission'')"',
        on_failure: retry_once_then_escalate,
      }

  - id: T10
    name: Harden shared-network authentication and browser access
    description: Add query/admin scopes, trusted-proxy handling, bounded rate limits, audit and CSRF/origin controls.
    estimated_scope: Large
    input_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/interfaces/http/router.js',
          'tools/managed-governance-control-plane/public/app.js',
          'tools/managed-governance-control-plane/server.js',
        ]
      data: ['FR-020 through FR-023', 'T09 admission contract']
      dependencies: [T03, T09]
    output_contract:
      files:
        [
          'tools/managed-governance-control-plane/lib/network/authentication.js',
          'tools/managed-governance-control-plane/lib/network/rate-limit.js',
          'tools/managed-governance-control-plane/lib/network/trusted-proxy.js',
          'tools/managed-governance-control-plane/lib/interfaces/http/router.js',
          'tools/managed-governance-control-plane/public/app.js',
          'test/managed-governance/network-security.test.js',
          'test/managed-governance/console.test.js',
        ]
      artifacts: ['separate query/admin scopes', 'bounded access audit']
    constraints: ['No wildcard CORS', 'Untrusted forwarding headers ignored', 'Bounded source cardinality']
    acceptance_criteria:
      [
        'scope confusion and proxy spoofing fail',
        'admin mutations require CSRF and admin scope',
        'rate-limit denial is audited without secrets',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/network-security.test.js test/managed-governance/console.test.js',
        expected: '0 failed',
        fallback: 'node --test test/managed-governance/network-security.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T11
    name: Expose readiness through governed adapters
    description: Add CLI, HTTP, MCP and console query surfaces plus portable pre-task bootstrap evidence.
    estimated_scope: Large
    input_contract:
      files:
        [
          'tools/cli/commands/governance.js',
          'tools/mcp-hseos-governance/server.js',
          'tools/managed-governance-control-plane/public/app.js',
          '.enterprise/governance/hooks/registry.yaml',
        ]
      data: ['FR-012 through FR-014 and FR-024', 'T07 readiness port']
      dependencies: [T05, T07, T10]
    output_contract:
      files:
        [
          'tools/cli/commands/governance.js',
          'tools/mcp-hseos-governance/server.js',
          'tools/managed-governance-control-plane/lib/interfaces/http/router.js',
          'tools/managed-governance-control-plane/public/app.js',
          '.enterprise/governance/hooks/registry.yaml',
          '.enterprise/governance/hooks/handlers/managed-governance-preflight.sh',
          'test/managed-governance/adapter-readiness.test.js',
        ]
      artifacts: ['equivalent adapter contracts', 'native-or-bootstrap receipt evidence']
    constraints: ['MCP read-only', 'Shadow remains advisory', 'No adapter-specific policy semantics']
    acceptance_criteria:
      [
        'all adapters return the same report',
        'enabled adapters without receipt remain not ready',
        'bootstrap precedes first task action where no native event exists',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: automated,
        command: 'node --test test/managed-governance/adapter-readiness.test.js test/managed-governance/mcp.test.js',
        expected: '0 failed',
        fallback: 'node --test test/managed-governance/adapter-readiness.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T12
    name: Execute adversarial threat and conformance validation
    description: Validate every trust boundary and close Critical/High findings before LAN activation.
    estimated_scope: Large
    input_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/design.md',
          'test/managed-governance/security.test.js',
          'test/managed-governance/conformance.test.js',
        ]
      data: ['Security Considerations adversarial cases', 'T04 through T11 outputs']
      dependencies: [T04, T05, T06, T07, T08, T10, T11]
    output_contract:
      files:
        [
          '.enterprise/.specs/features/managed-governance-shadow-readiness/threat-model.md',
          'test/managed-governance/security.test.js',
          'test/managed-governance/conformance.test.js',
          'test/managed-governance/performance.test.js',
        ]
      artifacts: ['8-step threat model', 'closed finding register', 'cross-adapter conformance']
    constraints: ['No Critical/High open', 'No live operational database mutation', 'No network activation']
    acceptance_criteria:
      [
        'all listed threats have controls/tests',
        'p95 preflight budget passes',
        'portable outage and enforcement-unavailable invariants pass',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: compound,
        command: 'node --test test/managed-governance/security.test.js test/managed-governance/conformance.test.js test/managed-governance/performance.test.js',
        expected: '0 failed and no Critical/High open',
        fallback: 'node --test test/managed-governance/security.test.js',
        on_failure: retry_once_then_escalate,
      }

  - id: T13
    name: Validate packed installation and configure the LAN deployment
    description: Prove package neutrality, install end to end, then apply the approved deployment-only CIDR configuration.
    estimated_scope: Large
    input_contract:
      files: ['docs/MANAGED-GOVERNANCE.md', 'test/managed-governance/installation.test.js', 'test/test-package-surface.js']
      data: ['All prior task evidence', 'deployment CIDR 192.168.5.0/24']
      dependencies: [T06, T08, T11, T12]
    output_contract:
      files:
        [
          'docs/MANAGED-GOVERNANCE.md',
          'docs/pt-br/governanca-gerenciada.md',
          'test/managed-governance/installation.test.js',
          'test/test-package-surface.js',
          '.enterprise/.specs/features/managed-governance-shadow-readiness/verification.md',
        ]
      artifacts: ['packed-install evidence', 'deployment activation checklist', '30-day observation start record']
    constraints:
      ['CIDR only in deployment state/evidence', 'No credentials in repository', 'No managed-enforced', 'Sequential package and live tests']
    acceptance_criteria:
      [
        'package contains no .hseos/state or environment defaults',
        'loopback remains fresh-install default',
        'LAN clients inside CIDR pass and outside clients fail',
        'observation starts only after all gates pass',
      ]
    execution_mode: isolated
    verify_step:
      {
        type: compound,
        command: 'npm run test:package-surface && node --test test/managed-governance/installation.test.js',
        expected: '0 failed plus signed live checklist',
        fallback: 'npm run test:package-surface',
        on_failure: retry_once_then_escalate,
      }
```

## Execution Gate

Implementation starts at T01 and proceeds sequentially. T13 may configure the target deployment only
after T12 records no open Critical or High finding. Passing the 30-day observation window remains a
future evidence gate and never activates `managed-enforced`.
