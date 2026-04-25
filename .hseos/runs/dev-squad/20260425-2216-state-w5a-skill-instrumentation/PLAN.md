# PLAN — Wave 5a

G2 cleared via /plan mode (Sprint 2 sequence revisado).

## State emission contract (T5.1/T5.2)

5 phase boundaries onde skill DEVE emitir:

| Phase | Kind | Quando | Payload |
|---|---|---|---|
| Intake start | `start` | SWARM lê INTAKE.md pela 1ª vez | `{phase:'intake'}` |
| Plan approved (G2) | `gate` | Humano aprova PLAN.md | `{gate:'G2', wave:N}` |
| Execute wave start | `start` | SWARM dispatcha squad da wave | `{wave:N, tasks:[...]}` |
| Execute wave complete | `complete` | Última task da wave returns OK ou aborts | `{wave:N, status:'OK'\|'BLOCKED'}` |
| Consolidate / abort | `complete`/`abort` | Run finaliza | `{exit_reason}` |

Skill chama: `hseos state-emit <kind> --run "$HSEOS_CURRENT_RUN_ID" --task "$HSEOS_CURRENT_TASK" --agent SWARM --payload <json> --silent`. Failure NUNCA bloqueia execução (best-effort).

Env vars setados pela skill no início:
- `HSEOS_CURRENT_RUN_ID` = `<YYYYMMDD-HHMM>-<slug>` (run-dir name)
- `HSEOS_CURRENT_TASK` = task em execução durante Execute phase
- `HSEOS_CURRENT_AGENT` = `SWARM` (Commander) ou agente Squad

## Snapshotter (T5.3)

```js
const fs = require('node:fs');
const path = require('node:path');

function snapshotDb(dbPath, { keepN = 7 } = {}) {
  const dir = path.join(path.dirname(dbPath), 'snapshots');
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replaceAll(':', '-').slice(0, 19);
  const target = path.join(dir, `project-${ts}.db`);
  fs.copyFileSync(dbPath, target);
  // Prune old snapshots, keep N most recent
  const all = fs.readdirSync(dir).filter(f => f.startsWith('project-') && f.endsWith('.db')).sort();
  while (all.length > keepN) {
    const old = all.shift();
    fs.rmSync(path.join(dir, old));
  }
  return { snapshot: target, kept: all.length };
}
```

## CLI (T5.4)

`hseos state-snapshot [--directory D] [--keep N] [--json]` — invoca snapshotter, prints resultado.

## Order of operations

1. Commit scaffolding
2. Criar 4 worktrees (T5-1 a T5-4)
3. Implementar tasks
4. Validate-commit-msg + commits
5. Merge sequencial
6. Cleanup
7. Tests + closeout commit
8. Push + PR (base=master)
