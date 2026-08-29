# G9 Downstream Owner Disposition Checkpoint

**Artifact type:** Governed goal checkpoint

**Scope:** Owner-approved downstream perimeter and installer-surface membership disposition

**Status:** Consumer membership complete; release-bound registry and R/R+1 publication remain blocked

**Authority:** The owner explicitly confirmed the enumerated `HideakiSolutions` organization plus
the known `marciohideaki` account as the complete perimeter, classified the four state-only layouts
as non-consumers, authorized local merge of enumeration commit `e03c7c0`, and retained the
prohibition on push/release; no downstream mutation, migration, deployment, activation or cutover
was authorized

## Owner decision

The complete owner-approved downstream membership for the bounded G9 surfaces is:

| Repository                         | Owner disposition                 | Evidence impact                               |
| ---------------------------------- | --------------------------------- | --------------------------------------------- |
| `marciohideaki/ai-agents-os`       | not an installer-surface consumer | exclude; `.hseos` is state/run only           |
| `HideakiSolutions/cambio-real`     | not an installer-surface consumer | exclude; `.hseos` is state/run only           |
| `HideakiSolutions/events-platform` | not an installer-surface consumer | exclude; `.hseos` is state/run only           |
| `HideakiSolutions/intent-os`       | not an installer-surface consumer | exclude; `.hseos` is state/run only           |
| `HideakiSolutions/platform-gitops` | installer-surface consumer        | retain; `_config` exists and `_cfg` is absent |

No repository in the approved perimeter is a `plugin-catalog-v1` consumer. The material owner-approved
registry is recorded as
`artifacts/G9-downstream-consumer-registry-owner-approved.json`: it is `complete`, contains only the
current default-ref `platform-gitops` commit and uses the explicit SSH network URL already proven by
an isolated checkout. Earlier pending candidate artifacts remain unchanged as historical discovery
evidence.

## Local integration result

The separately authorized enumeration commit `e03c7c0` was merged through the governed worktree
manager into `feature/harness-g9-observation-monitor` at `f7be7c2`. Reachability was verified before
the `g9-org-universe` worktree and task branch were removed. No remote ref was updated.

## Packaging reassessment

Membership completeness closes only the universe-selection blocker. The owner-approved registry is
not yet a collector input because the collector requires the registry blob at
`.hseos/compatibility/downstream-consumers.json` in the exact observation release commit
`5df935d180cf57a36ad321a40bdb09c7552cbe35`. That commit has no blob at the required path.

The registry therefore cannot be inserted into the immutable observed release, and a replacement
release cannot be pushed or published under the current authority. The remote feature ref remains
older than the local evidence, and no published R+1 artifact exists. Consequently:

- no inventory collection was claimed against the owner-approved registry;
- no R/R+1 release artifact, migration attestation or bundle was synthesized;
- the explicit-URL checkout proof resolves the binding strategy but does not bypass the release pin;
- `platform-gitops` needs no legacy-layout migration evidence at its selected commit because it is
  already classified as migrated-layout;
- G9 remains `1/30` and every cutover flag remains false.

## Claim classification

- **Observed:** the owner explicitly approved the perimeter and four non-consumer dispositions.
- **Observed:** the owner-approved registry has exactly one installer consumer and zero plugin-v1
  consumers, uses canonical JSON and preserves full Git provenance.
- **Observed:** `5df935d` lacks the required registry blob; the local feature and owner-approved
  registry are unpublished; no remote R+1 release exists.
- **Inferred:** a future authorized release can carry these exact membership bytes after normal
  release review; this checkpoint is not publication authority.
- **Unverified:** future R and R+1 publication timestamps, artifacts and closed release window.

## Stop condition

Stop before merging this disposition task, publishing a registry/release, pushing any ref, changing
the observation release, mutating `platform-gitops`, or collecting a final bundle without the next
specific human gate. Continue only the already-authorized hourly observation.
