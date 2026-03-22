# CORTEX Recall Intelligence

## Purpose

Encode, retrieve, trace, and impact context so mission execution and operators can work with explainable contextual memory.

## When To Use

Use this capability when:

- encoding reusable project or domain context
- retrieving relevant context for a mission or query
- inspecting why a context result was returned
- estimating local code impact for a mission query

## Use Cases

- encode domain context into the `scoped` layer
- retrieve context for a mission claim through `context_query`
- inspect retrieval trace when operators need explainability
- check impact terms before implementation or retry

## Commands

```bash
hseos cortex encode docs/context.md --layer scoped --title "Domain context"
hseos cortex retrieve "policy enforcement"
hseos cortex trace "policy enforcement"
hseos cortex impact "validateAgentFile"
```

## Example Usage

```bash
hseos cortex encode docs/runtime-governance.md --layer scoped --title "Runtime Governance"
hseos cortex trace "runtime retry approval"
```

## Limits

- retrieval is currently local-first and lexical
- impact output is diagnostic support, not authoritative semantic analysis
- CORTEX does not yet use a vector backend

## Troubleshooting

- if retrieval returns nothing, verify the target layer and whether context was encoded at all
- if impact is noisy, confirm generated directories are excluded from the scan
- if mission context is missing, inspect the workspace `context.json` artifact after claim
