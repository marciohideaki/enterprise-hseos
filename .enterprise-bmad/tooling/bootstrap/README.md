# BMAD Enterprise Bootstrap Tooling
**Scope:** Enterprise BMAD Overlay Initialization  
**Execution:** Manual  
**Status:** Controlled  

---

## Purpose
This directory contains scripts responsible for **initializing the Enterprise BMAD Overlay structure**.

These scripts:
- Create directories and baseline files
- Prepare the repository for governance
- Do NOT execute governance rules
- Do NOT activate Replay Mode

---

## When to Use
Use these scripts when:

- Introducing BMAD Enterprise Overlay into a repository
- Bootstrapping governance structure for the first time
- Recreating the overlay in a new environment

These scripts are **NOT** part of daily development.

---

## Scripts Overview

### `bmad-enterprise-overlay-bootstrap.ps1`
Creates the complete Enterprise BMAD Overlay directory structure.

**Where to run:** Repository root  
**Effect:** Creates directories and placeholder files  
**Safety:** Idempotent, version-safe, creates backups if needed

---

## Execution Rules
- Scripts MUST be executed consciously
- Scripts SHOULD be reviewed before execution
- Scripts MUST NOT be modified casually
- Any change to these scripts requires version increment

---

## What These Scripts Do NOT Do
- Do not enforce CI/CD
- Do not validate commits
- Do not alter development workflows
- Do not activate Replay Mode

---

**End**
