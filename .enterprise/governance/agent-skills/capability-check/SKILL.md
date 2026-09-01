---
name: capability-check
version: "1.0"
description: "Check reusable capability candidates and record the required intake before implementation"
trigger: "before creating or editing an exported component, hook, provider, utility, token, service, or infrastructure helper"
skip: "tests, stories, mocks, generated files, or edits without a new export"
metadata:
  owner: platform-governance
---

# Capability Check

## Tier 1 — discovery

Use the Capability Graph as the authority for identity and ownership. Then run `hseos capability-check <symbol|file>` to enumerate local candidates by name. Report candidate, location, signature, and suggested `consume` or `extend` verdict.

## Tier 2 — intake

Create a v2 intake decision before code. The decision must contain exact graph evidence, semantic discovery evidence or `unavailable`, candidate consumers, rationale, risk controls, and the selected outcome. `promote` requires `graph_update`; `keep-local` explicitly describes the product/provider boundary. Chain `core-drift` to update the Core Registry projection.
