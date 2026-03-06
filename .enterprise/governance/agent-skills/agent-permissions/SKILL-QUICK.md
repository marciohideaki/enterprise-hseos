---
name: agent-permissions
tier: quick
version: "1.0"
---

# Agent Permissions — Quick Reference

> Tier 1: Use when setting up or auditing `.claude/settings.json` for a project.
> Load SKILL.md (Tier 2) for full stack detection tables and permission catalogue.

---

## When to Use

Load when:
- Starting Claude Code in a project without an existing `.claude/settings.json`
- Running `/setup` Mode B (project install)
- Auditing existing settings for over-permission or gaps
- A team member asks "what permissions should Claude have here?"

**Do NOT use for:** code review, security audits, or any task unrelated to Claude Code permission configuration.

---

## Core Rule (Non-Negotiable)

> **Only allow read-only commands that cannot modify state.**

---

## Detection Checklist

- [ ] Identify ONE package manager (exclusive — never list competing managers)
- [ ] Detect primary stack from manifest files present in repo
- [ ] Detect build and infrastructure tools
- [ ] Check for existing `.claude/settings.json` to avoid conflicts
- [ ] Identify WebFetch domains needed (documentation sites only)

---

## Generation Rules

**ALLOW:**
- `ls`, `pwd`, `find`, `cat`, `head`, `grep`, `wc`, `diff`
- `git status`, `git log`, `git diff`, `git branch`, `git show`
- `gh pr view`, `gh issue list`, `gh repo view` (read only)
- Stack-specific read tools (see Tier 2 for full table)

**NEVER ALLOW:**
- State-modifying commands: `install`, `build`, `rm`, `delete`, `write`, `push`, `deploy`
- Absolute hardcoded paths (`/home/user/...`, `C:\Users\...`)
- Custom scripts with side effects
- Multiple package managers for the same role
- GitHub MCP server — use `gh` CLI instead

---

## Package Manager — Exclusive Rule

| Lock file present | Allow only |
|---|---|
| `pnpm-lock.yaml` | `pnpm` |
| `yarn.lock` | `yarn` |
| `bun.lockb` | `bun` |
| `package-lock.json` | `npm` |
| `poetry.lock` | `poetry` |
| `uv.lock` | `uv` |
| `Pipfile.lock` | `pipenv` |
| `requirements.txt` (no lock) | `pip` |

---

## Output Format

Deliver in this order:
1. **Summary table** — detected stack, tools, package manager
2. **JSON config** — ready to copy into `.claude/settings.json`
3. **Merge instructions** — if settings already exist

```json
{
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git log:*)",
      "Bash(git diff:*)"
    ]
  }
}
```
