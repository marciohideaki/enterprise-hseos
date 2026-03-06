---
name: agent-permissions
description: Analyze repository structure to generate a least-privilege .codex/settings.json — read-only commands only, stack-aware, package-manager-exclusive. Adapted from Sentry's claude-settings-audit methodology.
license: MIT
metadata:
  owner: platform-governance
  version: "1.0.0"
  source: https://github.com/getsentry/skills/tree/main/plugins/sentry-skills/skills/claude-settings-audit
---

# Agent Permissions — Full Policy

## When to Use

Load this skill when:
- Setting up `.codex/settings.json` for a new project
- Running `/setup` Mode B (project install)
- Auditing an existing settings file for over-permission or missing permissions
- Onboarding a repository to Codex CLI governance

---

## Core Principle

> **Only allow read-only commands that cannot modify system state.**

Every permission added is a security decision. An over-permissioned agent can inadvertently delete files, install packages, or push changes. An under-permissioned agent is merely slow to operate. Default to restriction.

---

## Phase 1 — Tech Stack Detection

Scan the repository root and common config directories for these indicator files:

### Python
| Indicator | Package Manager | Safe commands to add |
|---|---|---|
| `pyproject.toml` + `poetry.lock` | poetry | `poetry show`, `poetry env info` |
| `pyproject.toml` + `uv.lock` | uv | `uv pip list`, `uv tree` |
| `Pipfile.lock` | pipenv | `pipenv graph` |
| `requirements.txt` (no lock) | pip | `pip list`, `pip show <pkg>` |
| Any Python indicator | — | `python --version`, `python -m pytest --collect-only` |

### Node.js / JavaScript / TypeScript
| Indicator | Package Manager | Safe commands to add |
|---|---|---|
| `pnpm-lock.yaml` | pnpm | `pnpm list`, `pnpm outdated` |
| `yarn.lock` | yarn | `yarn list`, `yarn info` |
| `bun.lockb` | bun | `bun pm ls` |
| `package-lock.json` | npm | `npm list`, `npm outdated` |
| Any Node indicator | — | `node --version`, `npx tsc --noEmit` (TypeScript only) |

### Go
| Indicator | Safe commands |
|---|---|
| `go.mod` | `go version`, `go list ./...`, `go mod graph` |

### Rust
| Indicator | Safe commands |
|---|---|
| `Cargo.toml` | `cargo --version`, `cargo tree`, `cargo check` (read-only) |

### Ruby
| Indicator | Safe commands |
|---|---|
| `Gemfile` | `ruby --version`, `bundle list`, `bundle exec rake --tasks` |

### Java / JVM
| Indicator | Build tool | Safe commands |
|---|---|---|
| `pom.xml` | Maven | `mvn dependency:tree`, `mvn validate` |
| `build.gradle` | Gradle | `gradle dependencies`, `gradle tasks` |

### Infrastructure
| Indicator | Safe commands |
|---|---|
| `Dockerfile` | `docker ps`, `docker images`, `docker logs <id>` |
| `docker-compose.yml` | `docker compose ps`, `docker compose logs` |
| `*.tf` files | `terraform validate`, `terraform plan` (no apply) |
| `*.yml` in `.github/workflows/` | `gh workflow list`, `gh run list` |

### Monorepo Signals
| Indicator | Notes |
|---|---|
| `nx.json` | Add `nx graph --print-affected` (read-only) |
| `turbo.json` | Add `turbo ls` |
| `pnpm-workspace.yaml` | Add `pnpm -r list` |
| `lerna.json` | Add `lerna ls` |

---

## Phase 2 — Service Integration Detection

Check `package.json`, `pyproject.toml`, or `requirements.txt` for:

| Dependency found | WebFetch domains to add |
|---|---|
| `@sentry/...` or `sentry-sdk` | `docs.sentry.io` |
| `linear-sdk` or Linear references | `linear.app` |
| `@aws-sdk/...` | `docs.aws.amazon.com` |
| Azure SDK packages | `learn.microsoft.com` |
| Google Cloud packages | `cloud.google.com` |

---

## Phase 3 — Existing Settings Review

Before generating output:
1. Check if `.codex/settings.json` already exists
2. If yes: read current permissions
3. Flag conflicts — commands already present that violate read-only rules
4. Provide merge instructions rather than overwrite

---

## Phase 4 — Permission Generation

### Baseline (always include)

```json
"Bash(ls:*)",
"Bash(pwd:*)",
"Bash(find:*)",
"Bash(cat:*)",
"Bash(head:*)",
"Bash(grep:*)",
"Bash(wc:*)",
"Bash(diff:*)",
"Bash(git status:*)",
"Bash(git log:*)",
"Bash(git diff:*)",
"Bash(git branch:*)",
"Bash(git show:*)",
"Bash(git blame:*)",
"Bash(gh pr view:*)",
"Bash(gh pr list:*)",
"Bash(gh issue list:*)",
"Bash(gh repo view:*)",
"Bash(gh workflow list:*)",
"Bash(gh run list:*)"
```

### Package manager — exclusive

**RULE**: Include only the package manager detected in Phase 1. Never list multiple managers for the same runtime. If `pnpm-lock.yaml` exists, include only pnpm — not npm or yarn.

### Absolute prohibition list

The following MUST NEVER appear in `allow`:
- Any `install`, `add`, `remove`, `uninstall` command
- Any `build`, `compile`, `bundle`, `emit` command
- Any `push`, `deploy`, `release`, `publish` command
- Any `rm`, `del`, `rmdir` command
- Absolute paths like `Bash(/home/user/scripts/setup.sh:*)`
- Custom scripts: `Bash(./scripts/anything.sh:*)`
- GitHub MCP server — always use `gh` CLI

---

## Output Format

Deliver in this exact order:

### 1. Detection Summary

| Category | Detected |
|---|---|
| Primary language | Go |
| Package manager | go modules |
| Build tools | — |
| Infrastructure | Terraform |
| Service integrations | AWS SDK |

### 2. Recommended `settings.json`

```json
{
  "permissions": {
    "allow": [
      "Bash(ls:*)",
      "Bash(git status:*)",
      ...
    ]
  }
}
```

### 3. Merge Instructions

If `.codex/settings.json` already exists:
- Compare existing `allow` list with recommendations
- Flag any existing entries that violate read-only rules (mark as `# REVIEW`)
- Provide the merged version ready to save

---

## Validation Before Delivering

- [ ] Zero state-modifying commands present
- [ ] Only one package manager per runtime
- [ ] No absolute paths
- [ ] No custom scripts
- [ ] WebFetch domains are documentation sites only (no API endpoints)
- [ ] Existing settings conflicts flagged and resolved
