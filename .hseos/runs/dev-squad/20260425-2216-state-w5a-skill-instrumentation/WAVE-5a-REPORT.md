# WAVE-5a-REPORT — Skill instrumentation + snapshotter

**Run:** 20260425-2216-state-w5a-skill-instrumentation
**Wave:** 5a (Sprint 2) | **Branch:** feature/state-tracking-w5a-skill-instrumentation (base=master)
**Status:** READY-FOR-G4 | **Date:** 2026-04-25

## Result Summary

4 tasks executadas. T5.1 editou skill GLOBAL (`~/.claude/skills/dev-squad/SKILL.md`) — não-versionada, documentada aqui. T5.2-T5.4 entregaram em commits dedicados na feature branch.

**Risco mitigado:** mecânica é dual-write conservador (zero regressão). Inversão de canonicidade vira POLICY (Wave 6 ADR), não alteração mecânica do skill.

## Task Results

| Task | Local/Commit | Result |
|---|---|---|
| T5.1 — Skill emission contract | `~/.claude/skills/dev-squad/SKILL.md` (edit fora do repo) | ✅ adicionado bloco "State emission contract" com 5 phase boundaries |
| T5.2 — Workflow.md observability section | `33c6ba9` | ✅ overlay HSEOS espelha contrato com policy de canonicidade |
| T5.3 — snapshotter.js | `d74e1c6` | ✅ `snapshotDb(dbPath, {keepN})` com pruning |
| T5.4 — state-snapshot CLI | `7ebed52` | ✅ `hseos state-snapshot [--keep N] [--json]` |

## Skill Contract (T5.1)

5 phase boundaries onde skill emite via `hseos state-emit`:

| Phase | kind | Payload |
|---|---|---|
| Intake start | `start` | `{phase:'intake'}` |
| Plan approved (G2) | `gate` | `{gate:'G2'}` |
| Execute wave start | `start` | `{wave:N, task_count}` |
| Execute wave complete | `complete` | `{wave:N, status}` |
| Run consolidate / abort | `complete`/`abort` | `{exit_reason}` |

**Best-effort:** failure NUNCA bloqueia execução. Skill mantém TODOS os writes de markdown (zero regressão). Env vars `HSEOS_CURRENT_RUN_ID` / `HSEOS_CURRENT_TASK` / `HSEOS_CURRENT_AGENT` controlam emissão.

## Canonicity policy (clarificada)

ADR W6 declarará SQLite **canônico para cross-run queries** (orphan detection, kanban, FTS5). Markdown **canônico para single-run** (resume, human review). Não há "única fonte de verdade" — há dois escopos com fontes diferentes. Mecânica: dual-write.

## Verification

```bash
# Snapshotter smoke
hseos state-snapshot --directory /tmp/test-snapshot --keep 3 --json
# → {"snapshot":"...project-2026-04-25T22-16-42.db","kept":[...],"pruned":[]}

# Skill contract verification (post-merge, em /dev-squad real)
HSEOS_CURRENT_RUN_ID=R-test hseos state-emit start --silent
sqlite3 .hseos/state/project.db "SELECT kind FROM as_events ORDER BY ts DESC LIMIT 5"
```

## Definition of Done

- [x] T5.1: Skill global ganha bloco "State emission contract" com 5 boundaries.
- [x] T5.2: workflow.md HSEOS espelha o contrato.
- [x] T5.3: snapshotter pode ser invocado pelo MCP server ou CLI.
- [x] T5.4: `hseos state-snapshot` cria backup + prune.
- [x] Markdown writes preservados (zero regressão).
- [x] `npm test` passa.
- [ ] **Pending G4:** human abre PR.
- [ ] **Pending G5:** human merge para master.

## Halt — Pending G4

```bash
git push -u origin feature/state-tracking-w5a-skill-instrumentation
gh pr create --base master \
  --title "feat(state): wave 5a skill instrumentation + snapshotter" \
  --body "$(cat .hseos/runs/dev-squad/20260425-2216-state-w5a-skill-instrumentation/WAVE-5a-REPORT.md)"
```
