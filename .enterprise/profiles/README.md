# Profiles (Claude, Codex, Shared)

This folder separates runtime-specific governance artifacts.

- `shared/`: artifacts that are platform-agnostic and reused by all runtimes.
- `claude/`: artifacts optimized for Claude Code.
- `codex/`: artifacts optimized for Codex.

Rules:
1. Keep canonical governance specs in `.enterprise/.specs/` and shared policies in `.enterprise/governance/`.
2. Put only runtime-specific bootstrap/templates/playbooks/skill variants inside each profile.
3. Never overwrite a runtime profile with another runtime's conventions.