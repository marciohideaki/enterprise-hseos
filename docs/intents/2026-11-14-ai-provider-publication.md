# Immutable provider distribution

## Intent and authorized scope

Prepare and publish HSEOS 4.0.0-ai-provider.5 through GitHub prerelease assets,
then prove an isolated installed consumer. The owner authorized immutable
publication and subsequent product adoption in the active session. This task
owns only HSEOS distribution; SDK publication and deployed application adoption
are coordinated separately. Global runtime activation remains outside this task.

## Inputs and compatibility correction

The base is integrated HSEOS source 8b8c31fb. The published ECP 0.6.1 bundle
identifies source 6b7c9c59e85073a3030b7150aa41c21cbca111ea and archive SHA-256
683d1b9f703607244b32aa8a2931dbd6ed26cd45c04d981d158385dc0cc86e7c. Its complete
26-capability registry and stack vocabulary must remain byte-identical in the
canonical snapshot, locks and required compiler mirrors. The reader needs bounded
structural compatibility for the published operations/guarantees pair; ECP remains
the authority for family-profile semantics and adapter behavioral conformance.

The verified 0.6.1 input is historical. Final metadata will use ECP 0.6.2 to
retain the newer upstream Node package floor; its published artifact proof is
still an input to freeze. The reader/guarantee shape is unchanged.

The compatibility manifest remains explicitly unfrozen until Node
0.3.0-experimental.3 and ProviderAccess 0.1.0-rc.3 have their actual registry URIs
and read-back SHA-256 digests. The .NET SDK closure also binds the existing
Guardrails and TokenMetering 0.3.0 artifacts; it does not republish them.

## Completion and verification

- Preserve the ordinary preparation PR's complete required CI. The dedicated
  manual publisher verifies all five authoritative PR contexts against actual
  workflow/job identities, an integrated source commit and the identical reviewed
  Git tree. Failed, pending, cancelled or push-only evidence cannot substitute.
- Pack exactly once after metadata freeze. The compatibility-manifest digest
  binds the package and SBOM digests; canonical SHA256SUMS covers all three assets.
  No candidate `.4` archive is overwritten or repackaged.
- A default validation run has no tag/release side effects. Explicit manual
  staging limits contents:write to the master-only draft job after source/build
  verification. Draft assets are downloaded, checked and installed in a disposable
  Node 22 container without a checkout, global HSEOS, private credentials or model
  calls. The minimal profile and seven provider lookup surfaces are exercised.
- The separately authorized external finalizer uses an injected GH_TOKEN and no
  vault-specific runtime path. It verifies private dependency bytes, strips
  authorization on registry redirect host changes, checks the repository's native
  immutable setting immediately before publication, and requires immutable=true.
  Enabling that repository setting occurs only after peer review of preparation.
- Freeze package metadata and regenerate the canonical F14 rehearsal once, only
  if the confirmation hash changes. Use OFFLINE fixture mode for 42 runs; preserve
  prior receipts and introduce no paid inference or real-consumer claims.
- Record the final source, workflow, tag, asset URLs/digests, downloaded installed
  consumer receipt and unchanged-global-runtime evidence. Product deployment and
  adoption edges require their own actual rollout evidence from the coordinator.

## Risk and rollback

This prerelease is High risk relative to the last stable public major version.
It is distributed without stable/latest promotion or global activation. The
release notes identify the existing v4 migration guide and isolated rollback
procedure. Production rollout controls remain with the dependent product owner.

## Current preparation state

Source is not a publication receipt. SDK artifact hashes and final graph evidence
remain dependency inputs; source preparation cannot invent them. Required source
and artifact checks, independent review and the concrete immutable-publication
proof must be recorded before declaring the distribution delivered.


## Verified Gitea dependency freeze

Stage 1 published all four original SDK archives at Gitea under the private
HideakiSolutions owner. The separately reviewed publication and clean installation
receipts bind SDK source 1a127d4a8a29dde58e37c3a7ba6ddc6c70b781c2, Node
0.3.0-experimental.3, ProviderAccess0.1.0-rc.3 and original Guardrails/TokenMetering
0.3.0 source5ae206. ECP0.6.2ca8/7f8e is natively immutable and clean-installed.
The frozen compatibility manifest uses those four exact Gitea URIs and digests.
The finalizer accepts only the separate scoped reader supplied externally; no
registry credential enters CI or the isolated consumer. Actual HTTPS readback
through this publisher transport verified ECP and all four SDK digests.

Preexisting source/WIP was archived before handoff. The task fast-forwarded to
current master56478fa (repository hygiene only), preserving that upstream work.
The backend graph followup and authoritative source CI remain pins/gates before
final integration. SDK archives will not be rebuilt or repacked. HSEOS publication
and global activation remain distinct; this task does not modify global bindings.
