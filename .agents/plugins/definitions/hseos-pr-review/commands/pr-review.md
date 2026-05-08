---
id: pr-review
description: Run HSEOS commit-hygiene checks and PR review on the current branch
usage: /pr-review [--branch=<name>]
platform_support:
  - claude-code
---

Validates commit messages against HSEOS conventional-commit format, checks for AI mentions and Co-Authored-By trailers, and runs a structural PR review.

Upstream: `official:pr-review-toolkit@1.2.0` (standalone fallback if upstream unreachable).
