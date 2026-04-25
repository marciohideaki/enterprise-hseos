/**
 * Multi-project snapshot aggregator.
 *
 * Opens N project DBs read-only, calls takeSnapshot() on each, and merges into
 * a single aggregate snapshot with `project_id` injected on every item.
 *
 * Failures of individual DBs do NOT break the aggregate — they are surfaced via
 * `projects_meta[i].db_status` so the UI can show partial coverage.
 */

const fs = require('node:fs');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

const { takeSnapshot } = require('./snapshot');
const { projectDbPath } = require('./registry');

const STATUSES = ['pending', 'running', 'completed', 'aborted', 'orphaned'];

function emptyCounts() {
  return STATUSES.reduce((acc, k) => {
    acc[k] = 0;
    return acc;
  }, {});
}

function snapshotForProject(project, opts) {
  const dbPath = projectDbPath(project.path);
  if (!fs.existsSync(dbPath)) {
    return { project, snap: null, status: 'missing' };
  }
  if (!Database) {
    return { project, snap: null, status: 'no-driver' };
  }
  let db;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (error) {
    return { project, snap: null, status: 'error', error: error.message };
  }
  try {
    const snap = takeSnapshot(db, opts);
    return { project, snap, status: 'ok' };
  } catch (error) {
    return { project, snap: null, status: 'error', error: error.message };
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

function tag(items, project_id) {
  return items.map((it) => ({ project_id, ...it }));
}

/**
 * Aggregate snapshot across all registered projects.
 *
 * @param {{ projects: Array<{id,path,label,color}> }} registry
 * @param {{ staleMinutes?: number, run?: string|null, project?: string|null, eventLimit?: number }} [opts]
 * @returns {object}
 */
function takeMultiSnapshot(registry, opts = {}) {
  const projects = registry?.projects || [];
  const filterProject = opts.project || null;

  const projects_meta = [];
  const runs = [];
  const tasks = [];
  const agentRuns = [];
  const events = [];
  const orphans = [];
  const counts = emptyCounts();
  const counts_by_project = {};
  const branches = new Set();

  for (const project of projects) {
    if (filterProject && project.id !== filterProject) {
      projects_meta.push({
        id: project.id,
        label: project.label || project.id,
        color: project.color,
        path: project.path,
        db_status: 'filtered',
      });
      continue;
    }
    const result = snapshotForProject(project, { ...opts, project: null });
    projects_meta.push({
      id: project.id,
      label: project.label || project.id,
      color: project.color,
      path: project.path,
      db_status: result.status,
      ...(result.error ? { error: result.error } : {}),
    });
    if (result.status !== 'ok' || !result.snap) {
      counts_by_project[project.id] = emptyCounts();
      continue;
    }
    const s = result.snap;
    runs.push(...tag(s.runs || [], project.id));
    tasks.push(...tag(s.tasks || [], project.id));
    agentRuns.push(...tag(s.agentRuns || [], project.id));
    events.push(...tag(s.events || [], project.id));
    for (const oid of s.orphans || []) orphans.push({ project_id: project.id, agent_run_id: oid });
    counts_by_project[project.id] = s.counts ? { ...emptyCounts(), ...s.counts } : emptyCounts();
    for (const k of STATUSES) counts[k] += s.counts?.[k] || 0;
    for (const r of s.runs || []) if (r.base_branch) branches.add(r.base_branch);
    for (const t of s.tasks || []) if (t.branch) branches.add(t.branch);
  }

  events.sort((a, b) => (b.ts || '').localeCompare(a.ts || ''));

  return {
    ts: new Date().toISOString(),
    mode: 'central',
    projects_meta,
    runs,
    tasks,
    agentRuns,
    events: events.slice(0, opts.eventLimit || 100),
    orphans,
    counts,
    counts_by_project,
    projects: projects_meta.map((p) => p.id),
    branches: [...branches].sort(),
    stale_minutes: Number.parseInt(opts.staleMinutes ?? 10, 10) || 10,
  };
}

module.exports = { takeMultiSnapshot };
