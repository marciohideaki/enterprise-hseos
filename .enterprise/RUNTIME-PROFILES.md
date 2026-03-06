# Runtime Profiles

Runtime-specific assets are separated under `.enterprise/profiles/`:

- `shared/`: runtime-agnostic governance artifacts and references.
- `claude/`: Claude Code-specific bootstrap, templates, and skill/playbook variants.
- `codex/`: Codex-specific bootstrap, templates, and skill/playbook variants.

Compatibility note:
- Existing canonical layout in `.enterprise/` remains unchanged for backward compatibility.
- New work should prefer profile-specific assets when the runtime behavior differs.
