/**
 * `hseos kanban` — ASCII kanban renderer for the agent-state store.
 *
 * Reads SQLite directly (no side-car required). One-shot by default; --watch loops.
 */

const path = require('node:path');
const fs = require('node:fs');
const pc = require('picocolors');

let Database;
try {
  // eslint-disable-next-line n/no-missing-require
  Database = require('better-sqlite3');
} catch {
  Database = null;
}

const { takeSnapshot } = require('../../state-ui-server/lib/snapshot');

function openState(directory) {
  if (!Database) return null;
  const dbPath = path.join(directory, '.hseos', 'state', 'project.db');
  if (!fs.existsSync(dbPath)) return null;
  return new Database(dbPath, { readonly: true });
}

function ageSeconds(iso) {
  if (!iso) return null;
  const then = new Date(iso.replace(' ', 'T') + 'Z').getTime();
  if (!Number.isFinite(then)) return null;
  return Math.round((Date.now() - then) / 1000);
}

function fmtAge(s) {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

function colorAge(age) {
  if (age == null) return pc.dim('—');
  const f = fmtAge(age);
  if (age < 60) return pc.green(`♥ ${f}`);
  if (age < 300) return pc.yellow(`♥ ${f}`);
  return pc.red(`♥ ${f}`);
}

function classifyAgentRun(ar, orphanSet) {
  if (orphanSet.has(ar.id)) return 'orphaned';
  if (ar.status === 'running') return 'running';
  if (ar.status === 'completed') return 'completed';
  if (ar.status === 'aborted' || ar.status === 'killed') return 'aborted';
  return null;
}

function classifyTask(t) {
  if (t.status === 'PENDING_G2' || t.status === 'PENDING_EXECUTION') return 'pending';
  if (t.status === 'BLOCKED' || t.status === 'FAILED') return 'aborted';
  return null;
}

const COLUMN_WIDTH = 24;
const COLUMN_TITLES = [
  ['pending', 'Pending', pc.magenta],
  ['running', 'Running', pc.cyan],
  ['completed', 'Completed', pc.green],
  ['aborted', 'Aborted', pc.red],
  ['orphaned', 'Orphaned', pc.yellow],
];

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001B\[[\d;]*m/g;

function pad(s, w) {
  const visible = String(s).replaceAll(ANSI_RE, '');
  if (visible.length >= w) return s;
  return s + ' '.repeat(w - visible.length);
}

function truncate(s, w) {
  return s.length <= w ? s : s.slice(0, w - 1) + '…';
}

function renderBoard(snapshot) {
  const orphanSet = new Set(snapshot.orphans || []);
  const buckets = { pending: [], running: [], completed: [], aborted: [], orphaned: [] };

  for (const t of snapshot.tasks || []) {
    const k = classifyTask(t);
    if (k) buckets[k].push({ kind: 'task', item: t });
  }
  for (const ar of snapshot.agentRuns || []) {
    const k = classifyAgentRun(ar, orphanSet);
    if (k) buckets[k].push({ kind: 'agent', item: ar });
  }

  const formatCard = (entry) => {
    const lines = [];
    if (entry.kind === 'task') {
      const t = entry.item;
      lines.push(
        pc.bold(truncate(`${t.id} ${t.model_tier || '-'}`, COLUMN_WIDTH - 2)),
        pc.dim(truncate(`wave=${t.wave} ${t.run_id}`, COLUMN_WIDTH - 2))
      );
    } else {
      const a = entry.item;
      const age = ageSeconds(a.last_heartbeat_at);
      lines.push(
        pc.bold(truncate(`#${a.id} ${a.agent_name}`, COLUMN_WIDTH - 2)),
        pc.dim(truncate(`${a.task_id || '-'} ${a.run_id}`, COLUMN_WIDTH - 2)) + ' ' + colorAge(age)
      );
    }
    return lines;
  };

  const cardsPerCol = COLUMN_TITLES.map(([k]) => {
    const cards = buckets[k].map(formatCard);
    return cards.flat();
  });

  const maxLines = Math.max(0, ...cardsPerCol.map((c) => c.length));
  const out = [];

  const head = COLUMN_TITLES.map((entry) => {
    const k = entry[0];
    const title = entry[1];
    const color = entry[2];
    const count = snapshot.counts?.[k] ?? buckets[k].length;
    const headLine = `╭─ ${title} (${count}) `;
    return color(pad(headLine, COLUMN_WIDTH) + '╮');
  }).join(' ');
  out.push(head);

  for (let i = 0; i < maxLines; i++) {
    const row = cardsPerCol
      .map((cards, idx) => {
        const color = COLUMN_TITLES[idx][2];
        const line = cards[i] || '';
        return color('│ ') + pad(line, COLUMN_WIDTH - 2) + color('│');
      })
      .join(' ');
    out.push(row);
  }

  const foot = COLUMN_TITLES.map((entry) => {
    const color = entry[2];
    return color('╰' + '─'.repeat(COLUMN_WIDTH - 1) + '╯');
  }).join(' ');
  out.push(foot);

  return out.join('\n');
}

function renderHeader(directory, snapshot) {
  const ts = new Date(snapshot.ts).toLocaleString();
  return pc.bold(pc.cyan('HSEOS Kanban')) + pc.dim(` — ${directory} · ${ts}`);
}

function renderFooter(snapshot) {
  const c = snapshot.counts || {};
  const total = (c.pending || 0) + (c.running || 0) + (c.completed || 0) + (c.aborted || 0) + (c.orphaned || 0);
  return pc.dim(
    `Runs: ${snapshot.runs?.length || 0}  ·  Cards: ${total}  ·  Eventos: ${snapshot.events?.length || 0}  ·  Stale > ${snapshot.stale_minutes}m`
  );
}

function renderOnce(directory, snapshot) {
  console.log(renderHeader(directory, snapshot));
  console.log('');
  console.log(renderBoard(snapshot));
  console.log('');
  console.log(renderFooter(snapshot));
}

function clearScreen() {
  process.stdout.write('\u001B[2J\u001B[H');
}

module.exports = {
  command: 'kanban',
  description: 'Render an ASCII kanban board of agent state. --watch loops.',
  options: [
    ['--directory <path>', 'Project directory (default: current)'],
    ['--watch', 'Re-render every interval until SIGINT'],
    ['--interval <ms>', 'Refresh interval for --watch in ms', '1000'],
    ['--stale-minutes <n>', 'Orphan threshold in minutes', '10'],
    ['--run <id>', 'Filter by run id'],
  ],
  action: (options) => {
    const directory = path.resolve(options.directory || process.cwd());
    const db = openState(directory);
    if (!db) {
      console.error(pc.red('[kanban] no state db at') + ' ' + directory);
      console.error(pc.dim('  (better-sqlite3 missing or DB not yet created)'));
      process.exit(1);
    }
    const snapOpts = {
      staleMinutes: Number.parseInt(options.staleMinutes, 10) || 10,
      run: options.run || null,
    };

    const renderTick = () => {
      const snap = takeSnapshot(db, snapOpts);
      if (options.watch) clearScreen();
      renderOnce(directory, snap);
    };

    renderTick();

    if (!options.watch) {
      db.close();
      return;
    }

    const interval = Number.parseInt(options.interval, 10) || 1000;
    const timer = setInterval(renderTick, interval);
    const cleanup = () => {
      clearInterval(timer);
      try {
        db.close();
      } catch {
        /* ignore */
      }
      process.exit(0);
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  },
};
