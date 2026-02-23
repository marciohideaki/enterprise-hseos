---
name: test-coverage
tier: quick
version: "1.0.0"
---

# Test Coverage — Quick Check

> Tier 1: use during PR review to validate test adequacy.
> Load SKILL.md (Tier 2) for coverage thresholds, test pyramid rules, and generation guidance.

---

## Checklist

**Coverage Baseline**
- [ ] Overall coverage not decreased vs pre-PR baseline
- [ ] New public business logic has unit tests
- [ ] New use case handlers (commands/queries) have unit tests
- [ ] New domain rules / invariants have unit tests

**Test Pyramid Layers**
- [ ] Unit tests cover domain and application logic (no infrastructure needed)
- [ ] Integration tests exist for new infrastructure adapters (DB, broker, HTTP client)
- [ ] Contract tests exist for new or changed API/event contracts (where applicable)

**Test Quality**
- [ ] Tests are deterministic — no random data, no time-dependent assertions without control
- [ ] No tests skipped or commented out without a linked ticket
- [ ] Test names describe the scenario: `Given_When_Then` or `should_<behavior>_when_<condition>`

---

## Verdict

**PASS** → test coverage is adequate.
**FAIL** → gaps found — load `SKILL.md` (Tier 2) for thresholds and test generation guidance.
