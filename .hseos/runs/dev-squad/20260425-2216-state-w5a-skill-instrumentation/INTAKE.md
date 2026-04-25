# INTAKE — Wave 5a: Skill instrumentation + snapshotter

**Run:** 20260425-2216-state-w5a-skill-instrumentation
**Workflow:** dev-squad | **Commander:** SWARM (Opus 4.7)
**Base:** master | **Risk: ALTA** (edita skill GLOBAL afetando todas sessões)

## Goal (refinado)

**Não inverter** canonicidade mecanicamente. Adicionar emit calls em phase boundaries (dual-write conservador). ADR W6 declarará SQLite canônico de POLICY; mecânica continua dual-write para zero regressão.

## Tasks

| Task | File | Tier |
|---|---|---|
| T5.1 | `~/.claude/skills/dev-squad/SKILL.md` (edit) — bloco "State emission contract" | sonnet-high |
| T5.2 | `.hseos/workflows/dev-squad/workflow.md` (edit) — overlay HSEOS espelha contrato | sonnet-medium |
| T5.3 | `tools/mcp-project-state/lib/snapshotter.js` (novo) | sonnet-low |
| T5.4 | `tools/cli/commands/state-snapshot.js` (novo) | sonnet-low |

## DoD

- Skill `~/.claude/skills/dev-squad/SKILL.md` lista 5 phase boundaries onde state-emit deve ser chamado.
- Skill mantém TODOS os writes de markdown (zero regressão).
- `hseos state-snapshot` cria backup `.db` em `.hseos/state/snapshots/project-{ISO}.db`.
- `npm test` passa.
