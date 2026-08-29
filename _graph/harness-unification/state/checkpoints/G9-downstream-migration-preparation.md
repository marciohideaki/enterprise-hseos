# G9 Downstream Migration Preparation Checkpoint

**Artifact type:** Governed goal checkpoint

**Scope:** Source-only disposition plan for locally discovered installer-v4 candidates

**Status:** Preparation complete; consumer membership and migration remain human-gated

**Authority:** Read-only Git and anonymous remote inspection plus documentation in the isolated HSEOS task worktree; no downstream mutation, credential access, release change or cutover

## Outcome

The three candidates classified as `legacy` by the strict installer discriminator are not proven
legacy v4 installations. At their pinned commits they contain only project-scoped HSEOS run/state
artifacts, have neither `.hseos/_cfg` nor `.hseos/_config`, and have no `_cfg` or `_config` history
in any locally available Git ref. The classifier correctly fails closed for this layout, but its
`legacy` result cannot be promoted into a claim that a v4 installation exists or that renaming a
configuration directory is possible.

| Candidate         | Pinned `.hseos` tree                       | Files | Top-level content | Local history of `_cfg` / `_config` |
| ----------------- | ------------------------------------------ | ----: | ----------------- | ----------------------------------- |
| `ai-agents-os`    | `bbbac3102857057a88424720281c9812d115525a` |   301 | `runs`            | none observed                       |
| `events-platform` | `fffc1bf70ec4154d982f83985dc4e6e83e56d6fb` |     7 | `runs`            | none observed                       |
| `intent-os`       | `c87b7176f76bd0fbad70c012437b620b6f4dc113` |    43 | `runs`, `state`   | none observed                       |

The migrated comparison candidate `platform-gitops` contains `.hseos/_config` at tree
`5c8d240350c1b18e5831d5cf9b5265e40b710f32`, so the evidence collector classifies it as migrated.
Its manifest reports installation version `1.1.0`; this confirms that the collector's result is a
bounded layout classification, not proof of adoption of a particular current HSEOS release.

## Canonical-policy impact

- `events-platform/AGENTS.md` explicitly says not to recreate a project-local `.hseos` runtime
  unless HSEOS core requires it. Adding a synthetic `_config` marker would contradict that policy
  and would not constitute a truthful installation.
- `ai-agents-os` inherits the global runtime contract and its tracked `.hseos` history begins with
  governance/run evidence, not an installer configuration.
- `intent-os` tracks both run evidence and `state/project.db`; deleting, moving or rewriting those
  artifacts would be a downstream state migration and is outside the current authority.
- The installer recommends a fresh installation or manual cleanup for a real v4 footprint. Neither
  option is a safe source-only action for these state-only candidates.

## Fail-closed disposition plan

For each candidate, the repository owner must make one explicit, reviewable determination:

1. **Not an installer-surface consumer:** confirm that `.hseos` is project state only and exclude
   the repository from the authoritative registry. Preserve the state artifacts; do not add a
   marker merely to satisfy the classifier.
2. **Installer-surface consumer:** authorize an isolated downstream migration. Back up and
   fingerprint existing run/state artifacts, perform a real current installation or approved
   migration, prove generated `_config` integrity, and retain separate immutable R and R+1 release
   artifacts. A directory rename is applicable only if a real `_cfg` directory exists.

Only owner-confirmed membership may feed a `completeness_status: complete` registry. A local scan,
an empty plugin result, or a classifier label cannot establish organization-wide completeness.

## Remote verification

Anonymous HTTPS `git ls-remote` probes were made against the four explicit candidate URLs with
terminal prompts and credential helpers disabled. Every probe required GitHub authentication and
failed without reading a credential. Therefore remote reachability and advertised-ref membership
remain **unverified**; local `origin/*` containment is still only local evidence.

## R / R+1 evidence contract

No R/R+1 artifacts can truthfully be packaged yet. Before collection, all of the following must
exist:

1. owner-confirmed complete consumer membership;
2. reachable release-pinned commits for every member;
3. a new observed HSEOS release containing that complete registry at the exact observed release
   SHA;
4. for every real installer consumer, an R artifact and a distinct R+1 artifact covering the
   documented release window, plus the collector-derived migrated classification and attestation;
5. human review of the resulting bundle.

The candidate registry remains `pending`; no consumer repository, remote, systemd unit,
operational state, observation release or compatibility setting was changed.
