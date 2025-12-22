# Replay Tooling (Enterprise)
**Scope:** Legacy-to-Vitrine Repository Replay  
**Mode:** Replay Mode only  
**Status:** Controlled  

---

## Purpose
This directory contains scripts used **exclusively** during Replay Mode.

These scripts assist in:
- Replay orchestration
- Contract validation
- Commit discipline enforcement

They DO NOT:
- Copy code automatically
- Decide replay order
- Alter requirements or architecture

---

## When These Scripts May Be Used
Only when:
- Replay Mode is active
- `enterprise-bmad/modes/replay-mode.active` exists
- A replay plan is present or being prepared

---

## Scripts Overview

### `replay-mode-activate.ps1`
Creates or updates Replay Mode activation and closure templates.

**Where to run:** Repository root  
**Effect:** Writes governance files only

---

### `replay-assistant.ps1`
Guides the replay process interactively.

**Where to run:** Repository B root  
**Effect:** Creates branches, validates commits, assists PR creation

---

### `validate-commits.ps1`
Validates commit message quality for replay branches.

**Where to run:** Repository B  
**Effect:** Read-only validation, fails on rule violations

---

### `validate-replay-plan.ps1`
Validates `replay.plan.json` against its schema.

**Where to run:** Repository root  
**Effect:** Read-only validation, blocks replay if invalid

---

## Safety Notice
These scripts are **governance instruments**, not automation shortcuts.

Running them outside Replay Mode is a process violation.

---

**End**
