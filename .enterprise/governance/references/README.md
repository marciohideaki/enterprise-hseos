# Governance References

> **For human contributors.** Not consumed by agents.

---

## What This Directory Contains

Source documents and external references whose content has been selectively integrated into the governance overlay. Kept here for traceability â€” so it is always clear where a rule came from and what the original framing was.

---

## Index

| File | Source | Integrated into |
|---|---|---|
| `boris-cherny-execution.md` | Boris Cherny (Anthropic) | `~/.codex/AGENTS.md` â€” Execution Discipline + Core Principles |
| `sentry-security-review.md` | Sentry Engineering | `secure-coding` SKILL.md â€” Â§0 Investigation Protocol, Â§11 Confidence-Based Reporting, language patterns (JS, Python) |
| `trailofbits-differential-review.md` | Trail of Bits / Omar Inuwa | `pr-review` SKILL.md â€” Â§0 Risk-Based Triage, Â§8 Blast Radius Analysis, Â§9 Adversarial Analysis |

---

## Integration Rules

- A document in `references/` means its content has been **reviewed and merged** â€” not just copied
- If the source document is updated, the corresponding AGENTS.md or skill must be reviewed for drift
- References are NOT loaded by agents at runtime â€” they are human-readable audit trails

---

**End**

