# Agent Lessons — `_global` (cross-agent, project-wide)

> **Canonical location** per ADR-0006 (Standalone Architecture).
> The `.claude/lessons.md` file is a compiled mirror of this artifact.
> Edits MUST be made here; the agent-core compiler (Wave 2) regenerates
> the platform-adapter copies. Until Compiler v2 lands, manually mirror.

> **Read at session start (L1).** Updated after every user correction.
> Project-scoped calibration — patterns that reduced error rate in this
> codebase. Per-agent playbooks live alongside this file as
> `<agent-code>.md` (e.g. `cipher.md`, `ghost.md`); ACE gen-reflect-curate
> pattern lands in a follow-up wave.

---

## Promotion to vault (optional)

A lesson graduates from this file to `<second_brain.path>/_learnings/` when:

- The same pattern caused errors in 2+ different projects, OR
- The lesson is domain-agnostic (applies to any HSEOS project), OR
- The lesson corrects a structural assumption about how agents should behave

Promotion is enrichment-only; it is skipped silently when
`hseos.config.yaml → second_brain.enabled: false`.

---

## Lessons

### L001 — Commit messages: vendor filename triggers AI mention hook
**Correction:** Commit message containing the literal filename of the platform-adapter entrypoint (e.g. the file with the vendor name) was rejected by the commit-msg hook (AI mention false positive — the vendor word was detected by `validate-commit-msg.sh`).
**Rule:** Never use a literal vendor filename in commit messages. Use "project entrypoint", "governance doc", "platform adapter file", or "agent configuration".
**Applies to:** All commits in this repo.

### L002 — GitHub PR reuse: branch after merge → "No commits between"
**Correction:** After a PR merged, `gh pr create` from the same branch returned 422 even with new commits.
**Rule:** After any PR is merged, create a new branch for subsequent PRs. Never reuse a merged branch for a new PR.
**Applies to:** All PR creation flows.

### L003 — Docker Compose file extension must be `.yaml` not `.yml`
**Correction:** Lint rejected `docker-compose.yml` — project enforces `.yaml` extension.
**Rule:** Always use `.yaml` extension for Docker Compose files in this repo.
**Applies to:** All Docker Compose files.

### L004 — Edit tool requires prior Read in same conversation
**Correction:** Parallel Edit calls on files not yet Read in current session all fail.
**Rule:** Read every file before editing it. For mass edits on files with predictable structure, use `sed -i` via Bash instead.
**Applies to:** All file editing operations.

### L005 — Lint: Node.js requires `node:` protocol prefix on built-ins
**Correction:** `require('os')` and `require('child_process')` rejected by `unicorn/prefer-node-protocol`.
**Rule:** Always use `require('node:os')`, `require('node:child_process')`, etc.
**Applies to:** All Node.js files in `tools/cli/`.

### L006 — Lint: numeric literals ≥5 digits require underscore separators
**Correction:** `15000` and `60000` rejected by `unicorn/numeric-separators-style`.
**Rule:** Write `15_000`, `60_000`, `1_000_000` etc. for any number ≥ 5 digits.
**Applies to:** All Node.js files in `tools/cli/`.

### L007 — Lint: `Array#push()` multiple calls → single multi-arg call
**Correction:** Two sequential `array.push(a)` + `array.push(b)` rejected by `unicorn/prefer-single-call`.
**Rule:** Consolidate as `array.push(a, b)`.
**Applies to:** All Node.js files in `tools/cli/`.
