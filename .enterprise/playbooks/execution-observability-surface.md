# Execution Observability Surface

## Purpose

This playbook defines how HSEOS operators inspect runtime posture, evidence, and blockers using the native observability surface.

## Commands

```bash
hseos ops summary
hseos ops runs
hseos ops evidence
hseos ops blockers
```

## Data Sources

- `.hseos/data/runtime/work-items`
- `.hseos/data/runtime/evidence`
- `.logs/validation`

## Operational Intent

- `summary` provides a compact posture overview
- `runs` lists known mission runtime states
- `evidence` summarizes recorded runtime evidence and recent validation runs
- `blockers` focuses on invalidated missions and validation failures

## Wave 1 Boundary

This surface is read-only in Wave 1. It is meant to support governance review and operational visibility, not broad mutation control.
