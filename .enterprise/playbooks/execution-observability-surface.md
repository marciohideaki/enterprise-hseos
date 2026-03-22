# Execution Observability Surface

## Purpose

This playbook defines how HSEOS operators inspect runtime posture, evidence, and blockers using the native observability surface.

## Commands

```bash
hseos ops summary
hseos ops posture
hseos ops runs
hseos ops evidence
hseos ops blockers
hseos ops approvals
```

## Data Sources

- `.hseos/data/runtime/work-items`
- `.hseos/data/runtime/evidence`
- `.logs/validation`

## Operational Intent

- `summary` provides a compact posture overview
- `posture` aggregates runtime, governance, retry, and CORTEX posture in one read model
- `runs` lists known mission runtime states
- `evidence` summarizes recorded runtime evidence and recent validation runs
- `blockers` focuses on invalidated missions and validation failures
- `approvals` exposes operational approval history and current decisions

## Current Boundary

This surface remains local-first and file-backed. It is read-dominant, but now includes
approval recording to support governed operational continuation for blocked runtime paths.
