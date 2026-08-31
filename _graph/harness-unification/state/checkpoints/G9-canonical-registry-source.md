# G9 Canonical Registry Source Checkpoint

**Artifact type:** Governed goal checkpoint

**Scope:** Source-only promotion of owner-approved downstream registry bytes

**Status:** Complete tracked source prepared; merge, release publication and collection remain gated

## Source promotion

The exact canonical JSON from
`artifacts/G9-downstream-consumer-registry-owner-approved.json` is now prepared at
`.hseos/compatibility/downstream-consumers.json`. It records one installer consumer,
`HideakiSolutions/platform-gitops` at
`bd6c14647b887bfc75d9434198fd7e32037d709d`, and zero `plugin-catalog-v1` consumers.

This promotion is justified by the owner's explicit approval of the complete organization plus
known personal-account perimeter and the four state-only non-consumer dispositions. The historical
candidate registries remain unchanged as discovery evidence.

## Release boundary

The tracked source is not release-bound evidence. Observed release
`5df935d180cf57a36ad321a40bdb09c7552cbe35` remains immutable and lacks the registry blob. The
observation manifest still binds that release, and no successor release or R+1 artifact is
published. Consequently no inventory, attestation, R/R+1 bundle or readiness claim is created by
this task.

## Verification contract

- tracked and owner-approved registry bytes must be identical;
- JSON must remain canonical and satisfy the strict schema consumed by the Git-pinned collector;
- the explicit remote must advertise the exact `platform-gitops` commit;
- focused inventory, packer and framework-foundation tests must pass;
- every collection, publication and cutover flag remains false.

## Stop condition

Stop after committing this isolated task. A separate human gate is required before merging it into
the feature. Push, release publication, observation-manifest mutation, real R/R+1 collection,
deployment, migration, activation and cutover remain prohibited.
