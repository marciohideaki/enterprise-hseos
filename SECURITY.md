# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest (main) | ✅ |
| older branches | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in HSEOS, please **do not** open a public GitHub issue.

Instead, email **hideakiservicos@gmail.com** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (optional)

We will respond within 72 hours and keep you updated throughout the fix process.

## Disclosure Policy

We follow responsible disclosure. Public disclosure happens only after a fix is released and users have had reasonable time to update.

## Scope

In scope:
- HSEOS CLI (`tools/cli/`)
- Git hooks (`scripts/governance/`, `.husky/`)
- Agent authority files (`.enterprise/agents/`)
- Skills registry (`.enterprise/governance/agent-skills/`)

Out of scope:
- Third-party AI provider APIs (Claude, OpenAI, Gemini)
- Issues in projects where HSEOS is installed (not this repo)
- Social engineering

## Security Design Principles

HSEOS is designed with security as a structural property, not an afterthought:

- **No secrets in repo** — all credentials managed via `pass` or environment variables
- **HITL gates** — destructive operations (delete, force-push, drop-table) require explicit human approval
- **Least privilege** — each agent has access only to the tools it needs (see `.enterprise/governance/agent-skills/policy-layer/`)
- **Audit trail** — all agent actions are logged with timestamp, agent ID, and tool called
- **Commit hygiene** — hooks prevent AI attribution and co-authorship trailers from leaking into git history
