# Governance discovery and omission prevention

Scope: agents consuming HSEOS, including globally installed runtimes.
Authority: Constitution §2.3/§2.5, specification-consumption and automated-validation policies.

When entering a new repository or a project whose HSEOS adoption is not verified,
ask once whether the user wants HSEOS for that project. Offer `hseos init` to
review profiles and the install plan before installation. Do not infer adoption
from global CLI/MCP availability or from the absence of project files, and do not
run `hseos install` solely because the repository is new. In environments whose
global contract requires lightweight local adapters, follow that contract instead
of duplicating the runtime into the consumer repository. If the user has already
chosen to adopt or decline HSEOS for that project, honor that decision without
asking again.

Before the first task, after context loss or project changes, and before concluding
that a convention, practice, package or capability is missing:

1. Resolve the configured governance producer independently of the consumer's cwd.
   Read its Constitution, core index, applicable standards, policies and ADRs.
   Project files augment that baseline; their absence does not remove it.
2. Check the relevant core/package sources and versioned capability graph before
   proposing a local standard, implementation or promotion. A filename search with
   no matches proves only that the searched scope had no matches.
3. Distinguish **defined**, **available**, **loaded**, **applied** and **enforced**.
   CLI/MCP availability does not demonstrate consumption or blocking enforcement.
   Classify uninspected layers as **not verified**, never **absent**.
4. For negative findings, record the scope searched, producer/version, source paths
   and concrete missing evidence. Keep conclusions bounded to that scope.
5. Treat other producers (including AEW) separately: inspect their contracts and
   consumer activation. Do not infer activation from installation or a sibling repo.
6. Preserve these references and unresolved layers in task handoffs. After a
   resume/compaction, reload this context before relying on earlier conclusions.

Use `hseos governance-context --directory <consumer> --json` to resolve the baseline.
It reads and hashes sources; it does not attest that the agent understood them,
that every standard applies, or that a consumer enforces them. Read the applicable
documents before deciding. Missing/unreadable required sources fail this check;
report discovery as incomplete and continue only work independent of that finding.

Native prompt hooks check source integrity on every prompt without keyword filters.
With lifecycle hooks installed, emit only the capsule below for a new session,
consumer switch, source/adapter change or expired/invalid receipt. Unchanged prompts
emit zero bytes. SessionStart (including resume/clear), PreCompact and SessionEnd
invalidate the external receipt. SessionStart emits the capsule immediately so
autonomous post-compact continuation does not wait for another user prompt. Cache
state records emission, not comprehension.
Without session identity or writable state, emit the capsule instead of suppressing
it. Without verified lifecycle wiring, do not enable --cache. Manual discovery and
adapters without native hooks must still perform the explicit check before deciding.
Do not claim automatic protection on an unsupported adapter.
Do not duplicate central standards into consumer repositories to repair discovery.


## Minimal injected capsule

This is a navigation aid, not a replacement for the authoritative documents. Full
rules are loaded on demand; source hashes remain outside the prompt. The producer
checks all Markdown standards/policies plus consumer/ancestor adapters for changes.
Receipts expire after 24 hours, are isolated by adapter/session and bind the current
consumer and corpus fingerprint. No prompts or transcripts are stored.

<!-- injection-capsule:start -->
Global governance applies even without local AGENTS.md. Before decisions or absence claims, read G/.enterprise/policies/governance-discovery.md; resolve applicable rules via G/.enterprise/.specs/core/_INDEX.md and constitution/Enterprise-Constitution.md under .specs.
On a new repository, ask once whether the user wants HSEOS; offer `hseos init` to review the plan before installation. Global availability alone does not mean project adoption.
Reuse core packages/contracts before creating local equivalents. Inspect AEW activation separately. Unchecked application/enforcement is NOT VERIFIED, never absent. Negative findings need searched scope and source evidence.
Load only applicable documents; preserve their references in handoffs. This capsule proves neither comprehension nor enforcement. If context was lost without lifecycle invalidation, run governance-context explicitly before proceeding.
<!-- injection-capsule:end -->
