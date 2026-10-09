## Summary

The manifest `adapters.claude_code` block now advertises the two MCP surfaces that the Claude Code adapter emits:

- `settings`: `.claude/settings.json`
- `mcp`: `.mcp.json`

Both surfaces are conditional. The adapter writes them only when the active MCP bundles contain client-enabled stdio servers. The existing on-disk filter in `manifest/builder.js` (`buildAdaptersBlock`) decides what gets advertised, so the manifest still lists only paths that exist.

A user-authored `.claude/settings.json` is also advertised. The owner accepted this behaviour, and a test pins it. The compiler merges only its managed key into that file and leaves the user's content byte-identical when no MCP bundle is active.

## Changes

- `tools/cli/installers/lib/core/agent-core-compiler/adapters/platforms.js`: two surfaces added to `PLATFORM_SURFACES['claude-code']`, with a comment on conditionality.
- `test/test-agent-core-compiler-hooks.js`:
  - with an MCP bundle, both surfaces are advertised;
  - without a bundle, neither is advertised;
  - a user `settings.json` with no bundle stays untouched and is advertised.
- `CHANGELOG.md`: one line under Unreleased.
- `.hseos/runs/dev-squad/20261008-2350-next-steps/`: run record.

## Validation

- `node test/test-agent-core-compiler-hooks.js`: 57 passed, 0 failed.
- `worktree-manager.sh validate`: all quality gates passed for both tasks, with tests run in a delegated cgroup.
- ESLint (`--max-warnings=0`) and Prettier are clean.
- Isolated skeptical review: PASS-WITH-NOTES. Review notes 1 and 4 were addressed in commit `dd2b26cb`. Note 2 (the manifest schema does not list `settings`/`mcp`, the same situation Codex is in) was accepted as cosmetic.
- Nothing else reads `manifest.adapters`. Doctor, integrity and audit do not consume it, and no routine deletes advertised paths.
- `.agents/manifest.yaml` is unchanged in this repo because neither file exists at the root. The package inventory limit stays at 1472.

## Dev-squad run

Run `20261008-2350-next-steps`, wave 1. T1 (guard TypeScript parser spike) lives on `feature/guard-ts-parser-spike` and is not part of this PR. T2 (canonical_rules review) was read-only.
