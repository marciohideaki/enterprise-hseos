# G9 Git-Pinned Downstream Inventory Checkpoint

**Artifact type:** Governed goal checkpoint  
**Scope:** Networkless, Git-pinned collection and revalidation of installer and plugin compatibility evidence  
**Status:** Collection and verification capability complete; real downstream registry and live bundle remain absent  
**Governing documents:** Enterprise Constitution; ADR-0022; ADR-0023; automated-validation policy  
**Authority:** Local evidence collection and packaging only; no remote mutation, compatibility removal or cutover

## Gap closed

The downstream packer previously accepted operator-authored inventories. Even a
strict schema could therefore normalize invented Git SHAs or an omitted
consumer universe into a bundle that appeared ready for human review.

`hseos compatibility-evidence-inventory` now reads the registry and both
compatibility surfaces directly from immutable local Git objects. The packer
schema v2 accepts only the collector manifest, reruns collection in private
staging, and packages only freshly derived bytes. The operational audit repeats
that Git collection and compares the resulting inventories, attestations,
counts and timestamps before it can expose the human gate.

## Evidence semantics

- The consumer universe comes from the canonical
  `.hseos/compatibility/downstream-consumers.json` blob. The tracked default is
  `pending`; collection requires `complete` at the exact observation release
  commit.
- Registry and consumer repositories are bound one-to-one by normalized remote,
  full commit and tree SHAs. Git replace refs and lazy network fetches are
  disabled; repository worktree, Git directory, remote and commit tree are
  checked for drift around evidence reads.
- Installer classification reads the pinned `.hseos` tree. Plugin
  classification reads the pinned `.agents/plugins/registry.yaml` blob through
  the canonical strict registry validator.
- The collector emits private canonical schema-v2 inventories and attestations,
  publishes its index last and cannot create release evidence or authorize
  cutover.
- The packer no longer accepts external inventory or attestation claims. It
  recollects them and copies the collector manifest and registry into the final
  bundle.
- The audit recollects again, rederives legacy/migrated counts and observation
  timestamps, and reapplies R/R+1 identifiers, SHA lineage, publication order
  and window membership. Editing and rehashing only the owner-writable envelope
  cannot advance readiness.
- Outputs under operational state, the immutable observation release, a
  registry repository or a consumer repository fail closed.
- Local Git evidence is explicit. Remote commit reachability is deliberately
  reported as unverified and remains a human-verification item.

## Independent refutation

The independent reviewer returned **NOT READY** three times while finding and
reproducing material false greens: an empty fabricated registry, Git replace
refs, invented schema-v2 provenance, output below the immutable release,
envelope-only legacy-count tampering and a rehashed but semantically invalid R
artifact.

Every reproduction became a regression. The final verdict is **READY**, with
no residual blocker, high or medium finding. Cutover remains false and remote
reachability remains explicitly unverified.

## Deterministic verification

- Compatibility suite: 40 passed, 0 failed.
- Adversarial reproductions: manual schema v2, replace refs, release/remote
  drift, count tampering and R/R+1 semantic tampering all fail closed.
- ESLint, focused Prettier and `git diff --check`: passed.
- Complete governed quality gate: 0 failures, 1 historical documentation
  warning. Log: `.logs/validation/gate-20260825T010002.log`; SHA-256:
  `119933ebdfcef58548769e74b30da472088709b07310944a9dc7ab652b296187`.

## Live boundary and required next action

No repository was fetched, no remote was mutated, and no real downstream
inventory or bundle was produced. The canonical registry remains `pending` and
empty, intentionally preventing a repository-local false green.

G9 still requires a release-pinned `complete` registry containing the real
consumer universe, remote reachability verification, a real human-reviewed
R/R+1 bundle, 30 complete zero-use UTC days, stopped writers and a stable
migration snapshot, zero internal legacy runtime references, and explicit
cutover authorization.

## Rollback

Before integration, discard the task commit. After integration but before any
bundle is produced, revert the collector, packer/audit hardening, tests and
documentation. No operational rollback is necessary because this node changed
no live state.
