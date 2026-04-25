# PLAN — Wave 5b

G2 cleared via /plan mode.

## archiver.js (T5b.2)

```js
function archiveRun(db, run_id, { secondBrainPath } = {}) {
  // Read all rows for run
  const run = db.prepare('SELECT * FROM as_runs WHERE id = ?').get(run_id);
  if (!run) throw new Error(`Run not found: ${run_id}`);
  const tasks = db.prepare('SELECT * FROM as_tasks WHERE run_id = ?').all(run_id);
  const agentRuns = db.prepare('SELECT * FROM as_agent_runs WHERE run_id = ?').all(run_id);
  const arIds = agentRuns.map(a => a.id);
  const events = arIds.length ? db.prepare(`SELECT * FROM as_events WHERE agent_run_id IN (${arIds.map(()=>'?').join(',')})`).all(...arIds) : [];
  const taskIds = tasks.map(t => t.id);
  const handoffs = taskIds.length ? db.prepare(`SELECT * FROM as_handoffs WHERE src_task IN (${taskIds.map(()=>'?').join(',')}) OR dst_task IN (${taskIds.map(()=>'?').join(',')})`).all(...taskIds, ...taskIds) : [];

  const archive = { run_id, archived_at: new Date().toISOString(), run, tasks, agentRuns, events, handoffs };
  
  if (secondBrainPath) {
    const target = path.join(secondBrainPath, '_sessions', 'runs', `${run_id}.md`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderArchiveMd(archive));
    return { archive, archive_path: target };
  }
  return { archive, archive_path: null };
}
```

## state-purge.js (T5b.3)

```bash
hseos state-purge <run-id> [--archive] [--dry-run] [--force]
                          [--archive-path /path/to/secondbrain]
```

Default: `--dry-run` printing counts. With `--force`:
1. If `--archive`: call `archiveRun` first; verify file exists.
2. `BEGIN IMMEDIATE` transaction.
3. DELETE from `as_events`, `as_handoffs`, `as_wave_executions`, `as_worktree_state`, `as_agent_runs`, `as_tasks`, `as_runs` (FK order).
4. COMMIT. Print summary.

## resume/workflow.md (T5b.1)

Adicionar seção "Resume via SQLite (Wave 5b)":
- Quando `/dev-squad resume <run-id>` invocado, SWARM tenta:
  1. `hseos state-render <run-id> --output /tmp/resume-<run-id>` para regenerar PLAN/STATUS/RESUME-PROMPT.
  2. Se SQLite tem o run, lê de `/tmp/resume-<run-id>`.
  3. Se não tem (skip se erro), fallback ao markdown em `.hseos/runs/dev-squad/<run-id>/`.

## test (T5b.4)

Cria run + 5 events + 2 tasks via state-emit, archive+purge, valida que `as_*` ficou vazio para esse run_id.
