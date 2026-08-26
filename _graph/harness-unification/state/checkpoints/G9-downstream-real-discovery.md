# G9 Real Downstream Discovery Checkpoint

**Artifact type:** Governed goal checkpoint  
**Scope:** Local, Git-pinned discovery of candidate HSEOS downstream compatibility consumers  
**Status:** Discovery complete; canonical registry, release bundle and cutover remain blocked  
**Governing documents:** Enterprise Constitution; ADR-0016; ADR-0022; ADR-0023; ADR-0024; automated-validation policy  
**Authority:** Read-only local discovery and reviewable evidence only; no remote access, release mutation, deployment, migration or cutover

## Outcome

A read-only scan of Git worktrees under `/opt/hideakisolutions` found four distinct downstream
repositories whose pinned `HEAD` commits contain the installer compatibility surface. The exact
commits are present in local `origin/*` tracking refs and every inspected worktree is clean.

The monitor executable snapshot `35c1371` contains the intentionally `pending`, empty tracked
registry. The separately observed operational release `5df935d` predates that file and contains no
registry blob at the required path. This checkpoint therefore records a **candidate**, not a
canonical complete registry:
`state/checkpoints/artifacts/G9-downstream-consumer-registry-candidate.json`.

| Consumer                           | Pinned commit                              | Local classification | Evidence                                                           |
| ---------------------------------- | ------------------------------------------ | -------------------- | ------------------------------------------------------------------ |
| `marciohideaki/ai-agents-os`       | `ba3e4c14a4d5e23eee8ab076a18572a8555d2459` | installer legacy     | `.hseos` exists; neither `.hseos/_cfg` nor `.hseos/_config` exists |
| `HideakiSolutions/events-platform` | `969856996b6bb0b9b0f78f474e77d571ba5a62ed` | installer legacy     | `.hseos` exists; neither `.hseos/_cfg` nor `.hseos/_config` exists |
| `HideakiSolutions/intent-os`       | `3e9b4e3542be77f49a0e6b646283fc4503b6dc84` | installer legacy     | `.hseos` exists; neither `.hseos/_cfg` nor `.hseos/_config` exists |
| `HideakiSolutions/platform-gitops` | `c542df4f6062298ddf589c52d1d003ac65db22ab` | installer migrated   | `.hseos/_config` exists and `.hseos/_cfg` is absent                |

No local downstream repository outside `enterprise-hseos` contains
`.agents/plugins/registry.yaml`; the observed local plugin-v1 consumer set is empty. This is not a
claim that the organization-wide remote universe is complete.

## Claim classification

- **Observed:** four clean local repositories expose the installer evidence root at the pinned
  commits; three classify as legacy and one as migrated under the production discriminator.
- **Observed:** each pinned commit is contained by at least one local `origin/*` tracking ref.
- **Observed:** the latest G9 capture at `2026-08-26T03:20:36Z` is healthy, has a chain length of
  26 and advances the temporal counter to `1/30` complete zero-use UTC days.
- **Observed:** focused inventory tests pass `7/7`; focused packer tests pass `9/9`.
- **Inferred:** the explicit HTTPS remote for `platform-gitops` corresponds to its configured
  `github-gitops:HideakiSolutions/platform-gitops` host alias. This must be human-verified or
  rebound through an explicit network URL before collection.
- **Unverified:** completeness across non-local/private repositories and actual reachability of
  every pinned commit at the declared remote.

## Fail-closed result

The candidate remains `completeness_status: pending` because local filesystem discovery cannot
prove the full organizational consumer universe. Even if promoted later, the three truthful
legacy installer classifications would make `compatibility-evidence-pack --require-ready` exit
non-zero. A ready bundle therefore requires both authoritative universe confirmation and migrated
release-window evidence for those consumers.

The packer requires the registry commit to equal the observed release SHA `5df935d`, where the
registry blob is absent. Advancing the observed release to a commit containing a complete registry,
replacing the immutable monitor snapshot or hardening operational anchor permissions are operational
release decisions and were not performed.

## Deterministic verification

- `node --test test/test-compatibility-evidence-inventory.js`: `7/7` passed.
- `node --test test/test-compatibility-evidence-pack.js`: `9/9` passed.
- Candidate JSON canonical encoding, exact keys, full lowercase Git SHAs and Git-object existence:
  passed.
- Prettier and `git diff --check`: passed.
- Complete governed quality gate: 0 failures, 1 historical documentation warning. Log:
  `.logs/validation/gate-20260826T033123.log`; SHA-256:
  `764fc18b64c735ef380d947bcc7916587e6a354727487792e985cfac6a0a06ff`.
- Independent refutation initially returned **NOT READY** because event `0029` predated the quality
  log it cited. The event timestamp was advanced beyond the completed gate. Final revalidation
  returned **READY** with no residual blocker, high or medium finding.

## Next authorized boundary

Source-only preparation may continue by validating this candidate and producing migration plans
for the three legacy consumers. Stop before changing any consumer repository, remote configuration,
observation snapshot, systemd unit, operational file mode, downstream release artifact or cutover
state without the corresponding explicit authority.
