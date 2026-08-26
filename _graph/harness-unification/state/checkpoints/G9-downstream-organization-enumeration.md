# G9 Downstream Organization Enumeration Checkpoint

**Artifact type:** Governed goal checkpoint

**Scope:** Authenticated, read-only enumeration of GitHub repositories that expose the two G9 downstream compatibility surfaces

**Status:** GitHub organization perimeter enumerated; candidate set corrected; release-bound complete registry and R/R+1 remain absent

**Authority:** Human authorization to proceed with the proposed next steps; no push, downstream mutation, migration, deployment, activation or cutover

## Outcome

An authenticated read-only scan enumerated all 73 active repositories returned by the
`HideakiSolutions` GitHub organization and all 28 repositories owned by the authenticated
`marciohideaki` account. Every default-branch Git tree was inspected for `.hseos` and
`.agents/plugins/registry.yaml`. Empty repositories and the one truncated recursive tree were
resolved with exact Contents API probes instead of being treated as absent by inference.

The scan refuted the four-member local candidate set: `HideakiSolutions/cambio-real` also contains
the installer evidence root and must be retained as a candidate. The corrected pending registry is
recorded separately as
`artifacts/G9-downstream-consumer-registry-candidate-v2.json`; the earlier artifact remains
immutable evidence of the narrower local scan.

| Candidate                          | Default ref commit                         | Installer classification            | Plugin v1 |
| ---------------------------------- | ------------------------------------------ | ----------------------------------- | --------- |
| `marciohideaki/ai-agents-os`       | `2c7fef91efd4914e8c9d6c395fe7b46b94dc438c` | state-only / no `_cfg` or `_config` | absent    |
| `HideakiSolutions/cambio-real`     | `7a1ab9421523affb19b4d5cad001c552c5603619` | state-only / no `_cfg` or `_config` | absent    |
| `HideakiSolutions/events-platform` | `75bbfeb1e775b90a15ece4492213567d576e7de1` | state-only / no `_cfg` or `_config` | absent    |
| `HideakiSolutions/intent-os`       | `3e9b4e3542be77f49a0e6b646283fc4503b6dc84` | state-only / no `_cfg` or `_config` | absent    |
| `HideakiSolutions/platform-gitops` | `bd6c14647b887bfc75d9434198fd7e32037d709d` | migrated layout / `_config` present | absent    |

The repository containing this framework was excluded from its own downstream set. The GitHub
organization perimeter therefore has four installer candidates; the already-known personal
consumer makes five across the two enumerated owner scopes. No default branch in either scope
contains the bounded `plugin-catalog-v1` evidence path.

## Binding result

The local `platform-gitops` origin is `github-gitops:HideakiSolutions/platform-gitops`. Effective
SSH configuration resolves that host alias to user `git` at `github.com`, which verifies the
previously inferred repository identity without exposing credential material. The collector still
correctly rejects the alias because it accepts only an explicit network URL. An ephemeral bare
checkout with origin `ssh://git@github.com/HideakiSolutions/platform-gitops.git` fetched commit
`bd6c1464` and resolved its `.hseos` tree while `normalizeRemote` accepted the explicit URL and
continued to reject the alias. A future collection can use an equivalent isolated read-only
checkout; changing the
downstream worktree remote is neither necessary nor authorized.

## Release-window result

The observed HSEOS release remains `5df935d180cf57a36ad321a40bdb09c7552cbe35`. The remote feature
ref remains `13ba6b5bf7357640396e5652965ddfbbfe68f96f`, the current local feature commit is not published,
and the remote has no release or tag after the observed release that supplies a complete registry
and an R+1 artifact. The corrected candidate cannot be promoted into the observed release because
that release does not contain `.hseos/compatibility/downstream-consumers.json`.

## Claim classification

- **Observed:** the GitHub organization repository list and all default-branch trees were
  authenticated and enumerated; four organization repositories contain `.hseos`.
- **Observed:** the authenticated personal-owner list adds `ai-agents-os`; the framework fork is
  self, not downstream; empty repositories contain neither required path.
- **Observed:** five candidates have no plugin-v1 path; four have no `_cfg` or `_config` in current
  default refs or path history, while `platform-gitops` has `_config` and no `_cfg` history.
- **Observed:** the SSH alias resolves to the same canonical GitHub host and repository identity.
- **Unverified:** whether GitHub organization plus the known personal account is the owner-approved
  complete business perimeter across every Git host and account.
- **Unverified:** installer-surface membership of the four state-only layouts; path presence alone
  remains discovery evidence, not adoption.

## Deterministic verification

- Authenticated `GET /orgs/HideakiSolutions/repos` pagination returned 73 active repositories;
  authenticated `GET /user/repos?affiliation=owner` returned 28 repositories owned by
  `marciohideaki`.
- Recursive Git Tree API scans plus exact Contents API fallbacks resolved every repository: four
  organization downstream candidates, one personal downstream candidate, the framework self-fork
  excluded, and zero plugin-v1 paths.
- Exact default-ref Commit and Contents API reads verified all five commit SHAs and classifications;
  path-scoped Commit API reads found no `_cfg`/`_config` history for the four state-only candidates.
- An ephemeral explicit-SSH bare checkout fetched the current `platform-gitops` commit and exposed
  its `.hseos` tree; `normalizeRemote` accepted that URL and rejected the configured alias.
- Candidate v2 canonical JSON, exact keys, five full lowercase commit SHAs, `pending` status,
  Prettier and `git diff --check`: passed.
- Focused inventory, packer and agentic-foundation tests: `22/22` passed.
- Complete governed quality gate: zero failures, one historical documentation warning; log
  `.logs/validation/gate-20260826T143815.log`, SHA-256
  `dbb954c923b8a25f5b13813e95414d833eae77d7951edf4ad41d59eba3ba1fd9`.
- Staged documentation gate after event append: zero failures, one historical warning; log
  `.logs/validation/gate-20260826T144200.log`, SHA-256
  `8772acea0ce88199a7502aa264c157b9861b69343c793e0b295ed342dbf77a4c`.

## Stop condition

The automatic observation at `2026-08-26T14:20:36.318Z` remains healthy with four fresh servers,
a 37-file evidence chain and `1/30` complete zero-use days. Its SHA-256 is
`db9d46538fbc6b4f1678d34fd5d9c8230495a8c11da6d147926664b493fa8205`; the last legacy use remains
`2026-08-24T21:07:20.167Z` and both cutover flags remain false.

No bundle can be truthfully packaged until an owner approves the consumer perimeter and membership,
a new published HSEOS release contains the complete registry, real migration/R/R+1 artifacts exist,
and the temporal G9 window reaches 30/30. No downstream repository, remote, release, observation
anchor or compatibility state was changed.
