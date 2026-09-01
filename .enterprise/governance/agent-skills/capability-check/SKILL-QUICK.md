---
name: capability-check
tier: quick
trigger: "before creating or editing an exported component, hook, provider, utility, token, service, or infrastructure helper"
skip: "tests, stories, mocks, generated files, or edits without a new export"
---

# Capability Check — Quick

1. Run `hseos capability-check <symbol|file>`.
2. Query the Capability Graph before broad local search.
3. Record `consume`, `extend`, `promote`, `keep-local`, or approved `exception` in the v2 intake record.
4. For `promote` or `keep-local`, update the Core Registry projection and chain `core-drift`.
