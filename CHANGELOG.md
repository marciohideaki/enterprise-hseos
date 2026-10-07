# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Claude Code adapter emits `.claude/settings.json` (`allowedMcpServers` populated with the client-enabled servers of the active MCP bundles, never an empty list; ADR-0008) and `.mcp.json` (`mcpServers`), merging only the managed keys into any existing user file and emitting nothing when no bundle is active. `.claude/rules/` and `.claude/workflows/` remain unemitted because the pipeline has no rules or workflows source; the adapter header records this decision.

- Platform bindings (ADR-0046, wave W2b): adoption modes `platform`, `hybrid` and `local` recorded in `.hseos/config/platform-bindings.yaml`, layered configuration (runtime, user, project, flags) with anti-downgrade protection through `mode_ref`, the `hseos platform-bindings` command (`show`, `check`, `sync`, `guard`), platform-mode prompts and flags in `hseos init`, `install` and `install-plan`, and a mode-aware capability intake guard that denies agent edits to the bindings file.
- ECP capability registry snapshot (`contracts-v0.4.0`, SHA-256 pinned in `ecp-registry.snapshot.lock.json`); `hseos capability-check` now resolves by name, alias, contract, package and `match` hints before the filename heuristic and reports the effective mode.
- Capability-reuse and capability-graph policies, capabilities docs and getting-started guides document ECP contract authority and the adoption modes; the `/opt/hideakisolutions/**` scope is removed from the capability-reuse policy.

- Candidate campaign factories for native account, API and local SDK routes, with scoped Antigravity composition, shared reservations, process drainage and receipt-bound session resume. Real-provider campaign conformance remains unverified; see [W3 candidate limits](docs/evolution/w3/ADAPTERS-CAMPAIGN.md).

- Resolve producer governance independently of consumer files, inject a minimal discovery capsule only when session/project/source state changes, and keep unverified application/enforcement explicit.

### Changed

- Capability intake guard: several lexer hiding classes are closed. A quote or backtick inside a regex literal followed by a same-line comment (`/'/; export class X {} // '`) no longer hides the export; the guard now also inspects a regex-opaque lexing, so it only ever sees more than before. The same holds for a regex literal that follows `)`, `}` or a keyword the regex-versus-division guess calls an operand (`if (x) /'/.test(y); export class X {} // '`), via an extra inspected text that tries every code `/` as a regex and leaves the quotes on its line unopened, and for code after a lone CR, U+2028 or U+2029 line end (JavaScript line terminators that a `//` comment used to swallow), via a second set of lexings over the text with those terminators turned into LF. A regex after `)`, `}` or a keyword inside a template `${}` expression is also tried as a regex in the extra inspected text, and a leading hashbang line (`#!`, a line comment in JavaScript) is blanked in a further set of lexings, so a quote or backtick on it cannot swallow the export below. A regex literal right after a division operator (`x = a / /[/*]/.source`), a regex directly followed by a `//` comment (`if (a) /[/*]/// c`) and a string line continuation written as backslash, CR, LF (`"a\\\r\nb"; export class X {} // "`) are closed too, through a wide variant of the extra pass and a set of lexings over the text with that continuation normalized. One limitation remains known and is unchanged from master: a division followed by a regex literal that is combined with a `//` comment or a quote (`x = a / /[/*]/// '` then an export on the next line, or `x = y / /\//.source / /'/; export class X {} // '`) still hides the code below it. The union-of-views approach has reached its limit there; the next strategy is a real tokenizer. The inspected texts are still a union that includes the previous lexings, so the guard never allows what the previous release denied.

- Capability registry and capability-graph composition workflow now reference `platform-core` and `backend-core` under the `HideakiSolutions` GitHub organization (moved from `Hideaki-Solutions-Core` on 2026-10-06); pinned SHAs are unchanged and verified at the new location.
- Platform Capability Governance Standard (shard `core`) gains section 7.1, ECP contract authority and platform modes (`platform`, `hybrid`, `local`) per ADR-0046; the change is owner-reviewed under the shard `core` CODEOWNERS gate.
- The ECP registry snapshot is refreshed from `contracts-v0.3.1` to `contracts-v0.4.0` (lock `ref` and SHA-256 updated): `Authn` resolves to `security.authn` by alias, and the new `design.login-pattern` and `design.mobile-tokens` capabilities are visible to `hseos capability-check`.
- The capability intake guard inspects `MultiEdit` edits, denies any agent edit of `.hseos/config/platform-bindings.yaml` in every mode, and, with a bindings file, accepts `CORE_INTAKE_ACK` only as a whole-token intake identifier (the legacy path without bindings keeps its substring match). `hseos platform-bindings` exit codes: `check` 0/1/2, `guard` 0/2, `show` 1 on a registry integrity failure.

### Fixed

- Platform bindings anti-downgrade (ADR-0046 section 8, owner decision D6): a weaker mode than the recorded one is now accepted only when `mode_ref` is a decision record committed at `HEAD` with unmodified working-tree content, carrying a `platform-bindings-downgrade` block (status Accepted or Approved, `from` and `to` equal to the actual change, an approver) whose approver is an owner of `.hseos/config/platform-bindings.yaml` in the CODEOWNERS committed at `HEAD`. Previously any existing Markdown file under the decision directories sufficed, committed or not. Every missing, malformed or ambiguous input denies with a message naming the cause, including a repository with no resolvable CODEOWNERS owner (this repository's CODEOWNERS now names `@marciohideaki` as owner of `.hseos/config/platform-bindings.yaml`). Upgrades, same-mode operations, `show`, `check`, `sync` and `guard` and their exit codes are unchanged; `install`/`init` choosing a weaker mode need the record committed first.
- The capability intake guard decides over ALL exports detected in a file (from both lexings) and denies when any of them would be denied, instead of deciding on the first export; the deny message names the matching symbols and advisories list every matched symbol. `const r = /'/; export class Other {}` followed by `export class ICacheStore {}` is denied in hybrid mode when `ICacheStore` is stable for the stack. A test pins the previous guard and asserts, over a fixed corpus (lexer quirks, the known-limitation shapes, and override scenarios in both orders for `platform` and `hybrid`), that nothing it denies becomes allowed; it does not prove the property for arbitrary input. In `platform` mode an override covers only the exports that match the overridden capability, so an uncovered export still denies. Detecting re-exports (`export { } from`) is linear in the file size.
- ADR-0046 section 8 and the capability-reuse policy state that the guard does not cover writes through the Bash tool and that the anti-downgrade, although it now requires a committed, approved record from a CODEOWNERS owner, is not a security boundary against a malicious local user (local git history can be rewritten, and whoever can commit can author the record and the CODEOWNERS entry together). A Bash-tool deny was rejected by the owner and is not implemented.
- The shared-infrastructure policy registers MongoDB, Temporal, Mailpit, LocalStack, Gotenberg, GrowthBook and Meilisearch in the k3s mapping, merges the duplicate Keycloak rows into the neutral-hostname one, and records that GrowthBook, Gotenberg and NATS are provisioned but scaled to 0 replicas (cluster snapshot, 2026-10-06T01:39Z).
- Capability resolution treats space, hyphen and underscore as the same separator, so `mobile tokens` and `mobile_tokens` resolve like `mobile-tokens`; `.` and `/` are not normalized, scores and tie-breaks are unchanged, and the `heuristic` fallback bridges a separator only for queries with at least two tokens of two alphanumerics each and four in total.
- The commit-message validator, and Gate 5 through it, rejects attribution that evaded the earlier rules: an allowed identifier followed by an attribution verb (`claude-code authored this`), `autogenerated by` and its hyphen and space forms, homoglyph, fullwidth and zero-width variants of forbidden terms (NFKD plus a bounded Cyrillic and Greek confusable map), and a `co-authored-by:` trailer anywhere in the message. Accepted trade-offs, documented in the script: an accented form of a forbidden term is rejected, and generic verbs such as `did` and `made` count as attribution after an identifier.
- `test-state-ui.js` and `test-kanban-central.js` take their server port from the OS through the shared `test/helpers/free-port.js` instead of a random port in a fixed range, retry on a fresh port when the child exits before answering `/health`, fail fast on a spawn error, escalate SIGTERM to SIGKILL on stop, and remove their temporary directories.
- The standalone smoke job timeout goes from 10 to 20 minutes because successful runs took 550–626 s and runs were being cancelled at the 600 s limit.
- The `session-track.sh` installed-consumer hook test waits for the captured content, up to the handler's 5 s cap plus margin, instead of only for the capture file, which the fixture creates before writing it.
- `agent-core compile` ends the emitted `.claude-plugin/marketplace.json` and `.codex-plugin/plugin.json` with a newline, and both files are excluded from prettier like the other compiler output, so repeated compiles leave no diff.

### Known limitations

- The intake guard lexer (bindings path) is still a small lexer, not a parser. It now inspects the union of the previous lexing (`lexLegacy`) and a regex-aware lexing (`lexAware`), so a regex literal containing `/*`, a backtick inside a string, regex or comment within a template `${}`, and a `/` after a closing parenthesis no longer hide code. What remains: a quote or backtick inside a regex literal, followed by a comment on the same line, still hides code (`const r = /'/; export class ICacheStore {} // '`, the same with `/* ' */`, with a backtick, and with `/[/'/]`); the previous release and this one both allow these, and a test pins them so a future fix shows up. A wrong regex-versus-division guess can otherwise make text inside a string or comment count as code, which only asks for an intake that was not needed. Constructs the lexer cannot close are kept as raw text.
- The snapshot-versus-ECP-ref drift job is not implemented yet.

## [4.0.0-rc.0] — Unpublished candidate

### Added

- Disposable Node/Python task execution through the governed kernel, isolated command executor, protected verification and versioned task evidence.
- Canonical task-graph workflows, explicit definition migration, independent task outcomes and bounded aggregate reservations.
- Selective fresh-consumer profiles, lazy CLI/provider loading, protected task context and incremental replay with full recovery replay.
- Optional existing provider binding and credential broker integration for engineering tasks and workflows.

### Breaking Changes

- Mutable YAML workflow advancement is retired. Legacy runs remain read-only; migrate eligible definitions and start new runs. See [v4 migration and rollback](docs/v4-migration.md).

### Candidate limits

- Workflow recovery fences live owners and preserves recorded effects and original deadlines. Interrupted uncertain effects remain blocked for reconciliation; the real-provider campaign remains separate.
- Publication, operational activation and the v3 deprecation window require separate release decisions.

## [3.4.2] — 2026-09-07

### Breaking Changes

- None. Existing runtime and governance contracts remain compatible. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))

### Changed

- Restore portable agent filenames with explicit collision rejection and stale-output regression coverage. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))
- Allocate supervised execution binaries in private temporary directories without workstation-specific installation paths; retain restrictive permissions and cleanup. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))
- Keep dependency installation reproducible without tracking generated dependency metadata. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))
- Preserve the recovered sequential-delivery rule and document the historical workspace reconciliation inventory. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))

### Security

- Refresh vulnerable transitive dependencies in the lockfile. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))

### Tests

- Keep hardlink rejection fixtures on the same filesystem so the security assertion also runs on split temporary mounts. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))
- Exercise PostgreSQL integration in the required runtime matrix and normalize repository formatting. ([PR #171](https://github.com/marciohideaki/enterprise-hseos/pull/171))

## [3.4.1] — 2026-09-02

### Breaking Changes

- None. This release distributes the previously approved capability-intake
  enforcement state without changing the intake contract. ([PR #150](https://github.com/marciohideaki/enterprise-hseos/pull/150))

### Changed

- The compiled `capability-intake-guard` is active and blocking for qualifying
  `Write|Edit` operations; Codex and CI retain the explicit CLI fallback where
  no native PreToolUse event exists. ([PR #150](https://github.com/marciohideaki/enterprise-hseos/pull/150))

## [3.4.0] — 2026-09-02

### Breaking Changes

- None. Existing agent-core compilation remains compatible; `--check` is an
  additive, non-mutating verification mode. ([PR #148](https://github.com/marciohideaki/enterprise-hseos/pull/148))

### Added

- `capability-reuse` policy and ADR-0034: complementary core-first enforcement
  that retains the Capability Graph as the sole discovery and ownership
  authority. ([PR #147](https://github.com/marciohideaki/enterprise-hseos/pull/147))
- `hseos agent-core compile --check`, which verifies generated artifacts and
  source/output drift without writing files. ([PR #148](https://github.com/marciohideaki/enterprise-hseos/pull/148))

## [3.3.1] — 2026-09-01

### Breaking Changes

- None. The managed-governance session preflight remains advisory, opt-in and
  backward compatible. ([PR #142](https://github.com/marciohideaki/enterprise-hseos/pull/142))

### Fixed

- The session-start hook now verifies that an in-repository source CLI can
  start before selecting it, allowing a verified global HSEOS installation to
  handle preflight when a clean source checkout has no installed dependencies.
  ([PR #142](https://github.com/marciohideaki/enterprise-hseos/pull/142))

## [3.3.0] — 2026-09-01

### Breaking Changes

- None. Existing CLI commands, HTTP routes, MCP tools and portable Markdown
  governance remain compatible and authoritative. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Added

- `hseos governance session preflight` now compares repository identity and the
  normalized local Constitution digest with the active managed-shadow catalog,
  returning a strict non-blocking result and private project-local evidence.
  ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))
- The governance MCP exposes the additive read-only
  `get_governance_session_preflight` tool, while supported adapters receive a
  non-blocking `SessionStart` hook and other adapters receive an explicit CLI
  fallback. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Changed

- Effective-context provenance now reports the source commit of the active
  catalog batch instead of the sidecar checkout commit, preserving accurate
  drift evidence. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Security

- Constitution reads reject links, unstable files, oversized content and
  invalid UTF-8; evidence publication rejects linked runtime ancestors and uses
  private atomic replacement. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

### Documentation

- English and Portuguese managed-governance guides now document session
  reconciliation states, evidence, hook behavior, MCP usage and the manual
  fallback lifecycle. ([PR #141](https://github.com/marciohideaki/enterprise-hseos/pull/141))

## [3.2.2] — 2026-09-01

### Breaking Changes

- None. Existing project-owned governance sources are preserved and managed
  governance remains optional, loopback-only and shadow-only. ([PR #140](https://github.com/marciohideaki/enterprise-hseos/pull/140))

### Fixed

- Fresh installations now materialize the portable `.hseos/workflows` source
  registry required by the managed-governance importer, allowing the documented
  install-to-setup flow to complete without package-repository assumptions.
  ([PR #140](https://github.com/marciohideaki/enterprise-hseos/pull/140))

### Documentation

- The installation guide now makes repository identity an explicit project-owned
  prerequisite and forbids inheriting the package repository's identity.
  ([PR #140](https://github.com/marciohideaki/enterprise-hseos/pull/140))

## [3.2.1] — 2026-09-01

### Breaking Changes

- None. The patch preserves all managed-shadow contracts and keeps repository
  governance authoritative. ([PR #139](https://github.com/marciohideaki/enterprise-hseos/pull/139))

### Fixed

- Managed-governance setup now derives default idempotency keys from the exact
  actor-bound seed/import command, allowing a different authorized operator to
  repeat setup without colliding with a prior valid receipt while preserving
  strict conflicting-reuse rejection. ([PR #139](https://github.com/marciohideaki/enterprise-hseos/pull/139))

## [3.2.0] — 2026-09-01

### Breaking Changes

- None. Repository governance remains authoritative, the managed integration
  remains opt-in, and `managed-enforced` remains unavailable. ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

### Added

- Deployment-agnostic managed-shadow setup now performs PostgreSQL migrations,
  deterministic governance seed, role binding and secret-free project binding
  generation. ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))
- The optional loopback control plane can now serve the PostgreSQL-backed health,
  catalog, audit and console surfaces from the same strict configuration contract.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))
- English and Portuguese runbooks now cover package installation, PostgreSQL
  provisioning, conditional `sudo` use, idempotent setup and live validation.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

### Changed

- PostgreSQL support is packaged as an optional runtime dependency and remains
  inactive unless the managed-governance client is explicitly selected.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

### Security

- Runtime credentials are resolved only from named environment variables;
  generated project files are private and contain no resolved secret values.
  ([PR #138](https://github.com/marciohideaki/enterprise-hseos/pull/138))

## [3.1.1] — 2026-09-01

### Breaking Changes

- None.

### Fixed

- SQLite startup now configures bounded lock waiting before connection pragmas
  or schema reads, preventing concurrent project-state initialization from
  failing intermittently with `SQLITE_BUSY`.
- Release installation examples now select the published patch artifact.

## [3.1.0] — 2026-09-01

### Breaking Changes

- None. Portable repository governance remains authoritative and no built-in
  profile activates managed governance. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Added

- Optional managed-governance contracts, deterministic import, PostgreSQL
  migrations, seed/sync, policy resolution, shadow client and verified local
  snapshots. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))
- Loopback-only control-plane shell with versioned HTTP and CLI surfaces,
  schema-driven console and read-only MCP queries. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))
- Conformance, security and performance suites covering tenant isolation,
  replay protection, input bounds, parity and unavailable enforcement.
  ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Changed

- Installation documentation now uses checksum-verified GitHub release assets
  instead of an unavailable npm package. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Fixed

- `install-plan` now resolves the catalog shipped with the CLI when invoked
  from an empty consumer repository. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))
- Selecting the managed-governance client no longer asks the module installer
  to locate nonexistent module sources. ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

### Security

- `managed-enforced` remains a reserved value that returns
  `enforcement_unavailable` without network, cache or mutation effects.
  ([PR #136](https://github.com/marciohideaki/enterprise-hseos/pull/136))

## [3.0.3] — 2026-08-31

### Breaking Changes

- None.

### Fixed

- Adapter launcher cleanup now preserves every compiler-owned skill declared in
  the portable manifest, preventing selected-adapter installs from reporting a
  missing governed skill. ([PR #135](https://github.com/marciohideaki/enterprise-hseos/pull/135))
- Cleanup fails safely when an existing manifest cannot establish skill
  ownership. ([PR #135](https://github.com/marciohideaki/enterprise-hseos/pull/135))

## [3.0.2] — 2026-08-31

### Breaking Changes

- None.

### Fixed

- Fresh headless installs now create the project configuration before writing
  state and optional feature sections. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))
- `install-plan --json` now emits undecorated machine-readable JSON for plans,
  catalogs, skills, profiles, and adapters. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))
- Consumer compilation now materializes the portable adapter catalog, and
  `doctor` validates exactly the adapters selected in the manifest. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))
- Uninstall help and summaries now state that managed runtime data is removed
  while portable project governance is preserved. ([PR #134](https://github.com/marciohideaki/enterprise-hseos/pull/134))

## [3.0.1] — 2026-08-31

### Fixed

- Release checksums now contain asset-relative filenames and verify directly after a standard GitHub release download.
- Release notes are selected from the pushed version tag instead of a hard-coded version path.
- The state UI answers the browser favicon request without authentication or a console-visible 404.

## [3.0.0] — 2026-08-31

### Breaking Changes

- ⚠ Session state and the central kanban registry now default to project-scoped
  paths. Existing machine-scoped data is not read implicitly; use explicit
  paths during migration and follow
  [`docs/MIGRATION-GUIDE-v2-to-v3.md`](docs/MIGRATION-GUIDE-v2-to-v3.md). ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- ⚠ State UI side-cars bind only to loopback. Remote access now requires a TLS
  reverse proxy; bearer-authenticated cleartext non-loopback HTTP is rejected. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- ⚠ The canonical workflow registry is schema v2 and the canonical capability
  catalog includes the surface lifecycle contract. Bounded v1 workflow and
  compiled-only capability inputs remain readable and are upgraded by the
  compiler. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- ⚠ The active SessionStart hook identifier now describes the project store. The
  former identifier remains in the registry as a deprecated, non-emitted alias. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))

### Security

- Side-car health checks no longer transmit bearer credentials. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- Side-car stop operations verify an owner-bound process record, entrypoint,
  instance identifier, and health marker instead of terminating every listener
  on a port. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))

### Fixed

- Restored case-insensitive workflow discovery by profile, owner, and partial
  workflow identifier. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))
- Restored true compiled-only capability compatibility when `surfaces.yaml` is
  absent and made compiler synchronization materialize the conservative
  lifecycle contract. ([PR #128](https://github.com/marciohideaki/enterprise-hseos/pull/128))

### Added

- N1 pilot loop executed to stop condition: 8/8 budget, two genuine rejected verdicts, deliberate rollback test, zero anchors touched, and deterministic verifier 4/4 PASS. ([PR #121](https://github.com/marciohideaki/enterprise-hseos/pull/121))
- Governed loop manuals, `goal-graph` v1.1, a standalone verifier, autonomy guardrails, and the production goal loop skill. ([PR #122](https://github.com/marciohideaki/enterprise-hseos/pull/122))
- Versioned repository identity contract with UUID and canonical-remote validation. ([PR #130](https://github.com/marciohideaki/enterprise-hseos/pull/130))
- Owner-approved downstream consumer registry source for the G9 observation release. ([PR #131](https://github.com/marciohideaki/enterprise-hseos/pull/131))

### Changed

- Recompiled the Tier 2 agent-core bundle, mapped delivery capabilities, and hardened documentation fact verification. ([PR #122](https://github.com/marciohideaki/enterprise-hseos/pull/122))

### Fixed

- README skill and agent counts corrected. ([PR #122](https://github.com/marciohideaki/enterprise-hseos/pull/122))
