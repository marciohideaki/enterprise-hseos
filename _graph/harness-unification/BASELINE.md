# Harness Unification Baseline

**Artifact type:** Governed goal baseline
**Scope:** HSEOS runtime, state, capabilities, plugins, MCP adapters, generated surfaces, and compatibility layers
**Baseline commit:** `cfdcbbe692816aebca4623a3c878bb6c088ba664`
**Worktree:** `task/harness-unification-foundation` from `feature/harness-unification`
**Captured:** 2026-08-21 UTC

## Governing documents

- `.enterprise/.specs/constitution/Enterprise-Constitution.md`
- `.enterprise/.specs/decisions/ADR-0001-hexagonal-architecture-mandatory.md`
- `.enterprise/.specs/decisions/ADR-0002-event-sourcing-opt-in.md`
- `.enterprise/.specs/decisions/ADR-0003-cqrs-with-relational-source-of-truth.md`
- `.enterprise/.specs/decisions/ADR-0007-compiler-v2-multi-adapter-contract.md`
- `.enterprise/.specs/decisions/ADR-0009-plugin-marketplace.md`
- `.enterprise/.specs/decisions/ADR-0012-agent-os-sandboxing.md`
- `.enterprise/.specs/decisions/ADR-0016-capability-packaging.md`
- `.enterprise/.specs/decisions/ADR-0019-mcp-post-ga-conformance.md`
- `.enterprise/policies/adr-policy.md`
- `.enterprise/policies/automated-validation.md`

## Authority and isolation

- **Observed:** the primary `master` worktree contains unrelated tracked and untracked changes.
- **Observed:** this goal runs in an isolated task worktree created by the governed worktree manager.
- **Authorized:** the user requested action on all previously identified correction proposals.
- **Not authorized by implication:** merge, push, deployment, production data migration, or accepting an ADR on behalf of Engineering Leadership.

## Observed baseline

| Concern | Evidence | Classification |
|---|---|---|
| State authority | ADR-0003 requires a relational write-side source; current runtime also uses Markdown and legacy SQLite tables | observed |
| Event sourcing | ADR-0002 requires an accepted child ADR before activation | observed |
| MCP | `tools/lib/mcp-protocol.js` pins `2024-11-05`; ADR-0019 requires post-GA work by 2026-08-27 | observed |
| Capabilities | resolver produces a selection plan, while compiler installation is not proven to restrict emitted skills to that plan | observed |
| Plugins | registry marks initial plugins active while their READMEs describe scaffolds | observed |
| Legacy state | shell, PowerShell, MCP legacy tools, and `as_*` state coexist | observed |
| Generated surfaces | `.agents` is compiled output, but some plugin instructions target it as an authoring destination | observed |
| Runtime execution | CLI, MCP, hooks, and SWARM do not yet share one policy/evidence execution port | observed |

## Inferred target

The target is a single governed execution runtime with a relational append-only ledger, rebuildable projections, centrally validated tools, consistent policy/evidence behavior, profile-exact capability materialization, current MCP adapters, and bounded compatibility windows.

This target is **inferred from the user's authorization plus the prior accepted analysis**. Its architectural portions remain non-authoritative until the proposed ADRs are explicitly accepted.

## Unverified items

- Compatibility requirements of external clients still using the legacy project-state tools.
- Whether downstream installations author files directly under `.agents` despite the generated-only contract.
- Production usage of the four scaffolded marketplace plugins.
- Cross-platform behavior of the optional sandbox providers outside the test fixtures.

## Rollback position

Until an ADR is accepted, only isolated documentation, tests that expose existing contradictions, and behavior-preserving cleanup may proceed. The task branch can be discarded without changing `master` or the user's dirty worktree.
