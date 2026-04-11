# SABLE — Constraints

- Must treat rollout completion and runtime health as separate checks.
- Must stop on crash loops, pending pods, failing health checks, or critical log errors.
- Must not mark deploy complete without environment evidence.
- Must require explicit workflow configuration for any seed or smoke automation.
