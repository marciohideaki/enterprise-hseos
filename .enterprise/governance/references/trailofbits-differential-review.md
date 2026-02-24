# Trail of Bits Differential Review — Reference

**Source:** Trail of Bits (Omar Inuwa)
**Repository:** https://github.com/trailofbits/skills/tree/main/plugins/differential-review
**Status:** Reference — enrichment of `pr-review` Tier 2 planned
**License:** MIT

---

## Core Methodology

Differential review focuses on the DIFF — not the full codebase. It answers: "What changed, and what are the security and correctness implications of exactly those changes?"

### Risk Prioritization

High-impact areas that warrant deeper analysis:
- Authentication and authorization changes
- Cryptographic operations
- Value transfers or financial logic
- Privilege boundary crossings
- Input validation at trust boundaries

---

## 6-Phase Workflow

### Phase 1 — Intake & Triage

- Identify the base and target branches/commits
- Assess overall scope: lines changed, files touched, components affected
- Prioritize which areas of the diff to analyze first (risk-based)

### Phase 2 — Changed Code Analysis

For each modified file:
- Understand the purpose of the change
- Identify what was added, removed, and modified
- Use `git blame` to understand historical context
- Assess whether the change introduces new behavior or modifies existing logic

### Phase 3 — Test Coverage Analysis

- Map tests to changed code: which changed lines have test coverage?
- Identify coverage gaps: what changed code has NO tests?
- Assess test quality: do existing tests exercise the changed behavior?

### Phase 4 — Blast Radius Analysis

Quantify the impact of the change:
- How many callers does the modified function/method have?
- Which services or components depend on the changed interface?
- What is the deployment scope? (one service vs. shared library vs. platform)
- Are there untested downstream consumers?

### Phase 5 — Deep Context Analysis

For high-risk areas identified in triage:
- Read surrounding code (not just the diff) to understand invariants
- Check related tests for assumed behavior
- Review the commit history of modified files for patterns of past bugs

### Phase 6 — Adversarial Vulnerability Analysis → Report

Apply attacker thinking to the diff:
- What assumptions does this change make about its inputs?
- Is there a way to violate those assumptions?
- Does this change create a race condition, TOCTOU, or ordering dependency?
- Does this expand the attack surface?

Produce a structured report with:
- Executive summary
- Critical findings (with reproduction path)
- Attack scenarios
- Coverage gaps
- Blast radius assessment
- Actionable recommendations

---

## Modular Documentation

The Trail of Bits skill organizes methodology across 5 documents (~750 lines):

| File | Content |
|---|---|
| `SKILL.md` | Entry point with triage tables |
| `methodology.md` | Phase-by-phase workflow (this document summarizes) |
| `adversarial.md` | Attacker modeling and exploit scenarios |
| `reporting.md` | Output format and structure |
| `patterns.md` | Common vulnerability detection patterns |

---

## Integration Note

Our `pr-review` Tier 2 currently lacks blast radius quantification and adversarial analysis. Enriching it with Phases 4 and 6 from this methodology would significantly strengthen formal PR review for high-risk changes (auth, crypto, shared interfaces).

**End**
