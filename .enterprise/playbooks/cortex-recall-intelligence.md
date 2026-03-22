# CORTEX Recall Intelligence

## Purpose

This playbook defines how HSEOS encodes, retrieves, traces, and inspects contextual memory through CORTEX.

## Layers

- `immediate`: current task or near-term execution context
- `scoped`: project or domain context
- `archive`: deeper retained context

## Commands

```bash
hseos cortex encode docs/context.md --layer scoped --title "Domain context"
hseos cortex retrieve "policy enforcement"
hseos cortex trace "policy enforcement"
hseos cortex impact "validateAgentFile"
```

## Rules

- every encoded item must declare a layer
- retrieval should prefer stronger lexical matches, but always keep the trace visible
- impact lookup is diagnostic support for implementation and review, not authoritative code understanding
