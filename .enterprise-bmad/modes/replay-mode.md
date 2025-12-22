# Replay Mode (Enterprise)
**Scope:** Legacy-to-Vitrine Repository Replay  
**Status:** Mandatory when activated  
**Version:** 1.0  

---

## 1. Purpose
Replay Mode is a **controlled operational mode** used exclusively to curate and replay a legacy repository into a showcase repository.

Replay Mode is **not** the default development workflow.

---

## 2. When Replay Mode Applies
Replay Mode applies ONLY when ALL conditions are true:

- The repository is explicitly designated as a **Vitrine / Showcase**
- The goal is **Legacy-to-Vitrine replay**
- A replay plan exists (or is being produced) under:
  - `replay-analysis/40-plan/replay.plan.json`

If any condition is not met, Replay Mode MUST NOT be enforced.

---

## 3. Activation
Replay Mode is activated by the presence of:

- `enterprise-bmad/modes/replay-mode.active`

This file is a **flag** and MUST include:
- Repository A identifier
- Repository B identifier
- Replay owner (human)
- Activation date

---

## 4. Deactivation
Replay Mode is deactivated by:

- Removing `enterprise-bmad/modes/replay-mode.active`
- And recording closure notes in:
  - `enterprise-bmad/modes/replay-mode.closure.md`

Replay Mode MUST NOT remain enabled after replay concludes.

---

## 5. What Replay Mode Enforces
When active, Replay Mode enforces:

- Repository Curation & Replay Rules (Enterprise)
- Commit message quality validation (Replay branches only)
- Replay plan schema validation (when replay.plan exists)
- PR narrative standards for replay

---

## 6. What Replay Mode Does NOT Enforce
Replay Mode MUST NOT:

- Change functional or non-functional requirements
- Introduce optimizations
- Apply governance to non-replay repositories
- Override normal delivery workflows

---

## 7. Authority
Replay Mode governance overrides generic development conventions only within its scope.

---

**End**
