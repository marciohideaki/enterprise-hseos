---
id: pr-lint
description: Lint commit messages in the current branch against HSEOS governance rules
usage: /pr-lint [--from=<sha>]
platform_support:
  - claude-code
---

Checks each commit from `--from` (default: merge-base with master) against:
- Conventional commit format (`type(scope): summary`)
- No AI tool mentions
- No Co-Authored-By trailers
- Subject line ≤ 100 characters
