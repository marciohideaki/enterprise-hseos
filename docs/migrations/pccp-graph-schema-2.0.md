# PCCP graph schema 2.0 migration guide

Status: proposed; human activation required.

Schema 2.0 preserves canonical IDs and adds mandatory PCCP classifiers. It also separates
package distribution/publication from consumer installation/adoption and requires ownership
layers for Repository and Project nodes. Do not change lifecycle or distribution merely
because validation passes.

## Consumer and tool inventory

| Surface | Current state | Required migration |
| --- | --- | --- |
| Root registry/CLI | schema 1.0 pinned | Point to the 2.0 schema only after all immutable fragments validate through the real CLI entrypoint. |
| Enterprise HSEOS fragment | schema 1.0 | Add top-level roles/kinds/directions, package state separation, specification links, and ownership layers. |
| Platform Core fragment | schema 1.0 | Move classifier candidates from `attributes` to top-level fields; retain every canonical ID. |
| Backend Core fragment | schema 1.0 on a separate JVM workstream | Reconcile the JVM fragment and the 2.0-ready Wave 1 overlay into one repository-owned fragment. |
| Cambio Real fragment | registered SHA unavailable | Owner must restore or govern the registry entry; do not substitute current main. |
| Exact lookup and composition | validator/CLI | Run all fragments with `--require-all-fragments`; deferred fragments are forbidden in official gates. |
| Semantic discovery, FalkorDB, Qdrant, manifests | projections only | Rebuild after Git activation; never use them to author canonical relationships. |

## Per-node transformation

1. Inventory every node ID and edge ID. Never recycle either identifier.
2. Move `Contract.attributes.kind/direction`, `Module.attributes.role`,
   `Package.attributes.role`, and `Adapter.attributes.kind` into the validated top-level
   classifier fields.
3. Add a `Module(role=specification)` and a canonical Contract definition for every
   available capability. `IMPLEMENTED_BY` may point only to a policy/reference module,
   implementation/adapter package, or Adapter—not a specification or projection.
4. Remove installation/adoption fields from Package. A Package may be `source-only`,
   `ci-validated`, or `published`; verified installation and adoption belong only to a
   Consumer connected to an immutable ArtifactVersion.
5. Add exactly one owner and traceable Git evidence. Add Repository/Project
   `ownership_layer` so inversion checks cannot be bypassed by omitted metadata.
6. Connect every projection to its canonical Contract, every Adapter to a port Contract, and
   each compatibility claim to a reusable TestSuite.
7. For replacements, retain the predecessor, add `SUPERSEDES`, compatibility evidence,
   migration and rollback paths, and the correct SemVer impact.
   A schema 1.0 Module that actually represented a stack projection migrates to the existing
   `Package(role=projection)`: retain the Module ID only as a deprecated/retired migration
   tombstone, record `representation_migrated_to`, and add exactly one Package-to-Module
   `SUPERSEDES` edge. This is the only permitted cross-type supersedence; it does not change the
   package version or imply publication, installation, or adoption.
8. Classify a genuinely new Contract with `initial_contract` parent provenance: authenticated
   origin, the authoritative revision's immediate parent SHA, the same fragment path, its
   present/absent state and digest when present. The validator proves the exact ID was absent
   immediately before introduction without requiring a commit to contain its own SHA.
   Every changed Contract instead records `compatibility_baseline` with the exact contract
   ID, authenticated origin, strict-predecessor SHA, authoritative fragment path, unchanged canonical
   path and predecessor digest. The validator computes the compatibility diff; an
   author-supplied `change_kind` cannot override the result.

## Cutover sequence

1. Accept or amend ADR-0036.
2. Migrate each fragment on its owning branch and run its positive and negative fixtures.
3. Commit each fragment and record the immutable full Git SHA.
4. Compose a candidate 2.0 registry through the normal CLI entrypoint with every repository
   root mapped and `--require-all-fragments` enabled.
5. Run exact-query, cycle, ownership, publication/adoption, compatibility, and path-at-pinned-
   revision checks.
6. Obtain CODEOWNER/protected-branch approval for the coordinated registry switch.
7. Rebuild projections and compare them to Git; never hand-edit projection state.

The entrypoint test `schema 2.0 is usable through the real registry entrypoint` and the PCCP
positive graph fixture exercise the candidate registry path. Critical negative fixtures cover
missing specification/contract/implementation/conformance, false publication/adoption,
omitted ownership layer, cycles, untraceable nodes, invalid ports, and breaking changes
without migration evidence.

Schema 1.0 fragments remain valid under the active 1.0 registry. They are not silently
interpreted as 2.0; mixed authoritative composition is forbidden.

## Rollback

Before activation, remove the candidate registry/schema overlays and retain schema 1.0.
After activation, restore the complete previous registry and immutable fragment pin set
through an ADR-backed reviewed change. Retain 2.0 IDs, evidence, and `SUPERSEDES` history for
audit; never rewrite a fragment pin or silently reinterpret a 2.0 fragment as 1.0.
