# Migration Guide — HSEOS v1.x → v2.0

> **Status: outline (Wave 8 foundation).** Concrete migration scripts and per-file diff tables land in W8 implementation follow-ups, after the W2/W3/W4/W5/W6/W7 implementation slices have shipped and the actual v1→v2 mechanics are exercised in real installs.

This guide describes how to migrate an existing HSEOS v1.x project to v2.0 (Standalone Gold Premium). v2.0 is a **breaking release** — host-machine global skills, hooks, and MCP configs are no longer load-bearing.

## Highlights of v2.0

| Area | v1.x | v2.0 |
|---|---|---|
| Source-of-truth | `.agents/` + global `~/.claude/skills/` overlay | `.agents/` exclusively (per ADR-0006 P1) |
| MCP configuration | global `~/.claude/.mcp.json` | project-local `.mcp.json` + `.agents/mcp/` registry (per ADR-0008) |
| Hook handlers | `~/.claude/hooks/` (host-machine) + `scripts/governance/` | `.agents/hooks/handlers/` (per ADR-0006 P5) |
| Adapters | claude-code + codex (hardcoded) | declarative spec at `.agents/adapters/<id>.yaml`; six initial vendors (per ADR-0007) |
| Plugins | none | `.agents/plugins/` marketplace dual-emitting to vendor formats (per ADR-0009) |
| Lessons | `.claude/lessons.md` | `.agents/instructions/lessons/<scope>.md` (canonical); platform-adapter mirror generated |
| Manifest | v1.0 (object adapters, no integrity) | v2.0 (array adapters, sha256 hashes, mcp_bundles_active, plugins) |
| Self-verification | none | `hseos agent-core doctor / verify / audit` |

## Migration steps

The migration runs in five phases. Each phase is reversible (`pre-w<N>` rollback tags published with each wave).

### Phase 1 — Foundation update (zero impact)

1. `git pull origin master` (after v2.0 release)
2. `npm install` (picks up `better-sqlite3` and other v2 dependencies)
3. Verify: `npm test` — all v1 functionality still works because v2 fields are additive.

### Phase 2 — Move project assets to v2 locations

1. `cp ~/.claude/skills/<custom>/SKILL.md .agents/skills/<custom>/` for any project-specific skills you authored under your home directory.
2. `cp ~/.claude/hooks/<custom>.sh .agents/hooks/handlers/` for project-specific handlers.
3. Update `.agents/hooks/registry.yaml` to point to the new paths and set `status: active`.

### Phase 3 — MCP project-localization

1. `hseos mcp install --bundle core` — installs the core bundle (hseos-governance, hseos-state-tracking, filesystem) and writes `.mcp.json` to the repo root.
2. (optional) `hseos mcp install --bundle extended` — adds axon-bridge, hseos-swarm, sequential-thinking, fetch, memory.
3. (optional, requires secrets) `hseos mcp install --bundle enterprise` — github, postgres, kubernetes, sentry.
4. Remove the global MCP entry from `~/.claude/.mcp.json` once project install is verified.

### Phase 4 — Adapter compilation

1. `hseos agent-core compile --target all` — emits compiled artifacts for every adapter declared in `.agents/manifest.yaml`.
2. `hseos agent-core verify` — confirms hash chain integrity for every emitted asset.
3. `hseos agent-core audit` — confirms zero source-vs-compiled drift.

### Phase 5 — Self-verification gate

1. `hseos agent-core doctor` — runs the eight-check health report.
2. Run the standalone smoke procedure documented in `docs/STANDALONE-VERIFICATION.md` inside a clean `node:20` Docker container (no host-machine skills/hooks/vault).
3. When all five steps pass: tag your local repo with `migrated-to-v2.0.0`.

## Breaking changes

- The `~/.claude/skills/<custom>/SKILL.md` discovery layer no longer exists for HSEOS-controlled skills. Custom user skills outside HSEOS continue to work in your platform-adapter session, but no HSEOS workflow loads them.
- The default for `hseos.config.yaml → second_brain.enabled` is **false** for new installations. Existing installs that opt-in continue to work, but the value MUST be set explicitly; relying on the v1 default flips behaviour silently.
- Commit-msg validation is stricter (no `Co-Authored-By` trailers, no AI mentions). Pre-existing branches with violating commits cannot rebase onto v2.0 master cleanly — squash before rebasing.

## Rollback

If anything goes wrong, every wave landed with a `pre-w<N>` tag in this repository. To reset to a known-good state:

```bash
# Reset to before the entire v2.0 migration:
git reset --hard pre-w0

# Or reset to before a specific wave (e.g. before MCP bundle landed):
git reset --hard pre-w3
```

Each wave's foundation slice was purely additive; the implementation slices may carry breaking compiler behaviour, but that lands in v2.1 if needed (no v2.0 implementation slice has shipped at the time this guide was first written).
