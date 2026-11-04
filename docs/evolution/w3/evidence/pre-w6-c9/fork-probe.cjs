'use strict';
// Free probe: fork at different checkpoints of a scripted engineering run and observe what the fork's resume does first.
const fs = require('node:fs'),
  path = require('node:path'),
  { spawnSync } = require('node:child_process');
const ROOT = process.argv[2];
const { RelationalSessionEventStore } = require(path.join(ROOT, 'packages/agent-session-store'));
const { createEngineeringExample } = require(path.join(ROOT, 'tools/examples/engineering-task'));
const { ExecutionEventLedger } = require(path.join(ROOT, 'tools/mcp-project-state/lib/execution-event-ledger'));
const { openExecutionLedgerFileFixture } = require(path.join(ROOT, 'tools/mcp-project-state/lib/execution-ledger-schema'));
const CLI = path.join(ROOT, 'tools/cli/hseos-cli.js'),
  PROFILE = 'disposable-engineering-candidate';
const dir = fs.mkdtempSync(path.join(process.env.TMPDIR, 'fork-probe-'));
const ex = createEngineeringExample('addition');
fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify(ex.contract));
fs.writeFileSync(path.join(dir, 'responses.json'), JSON.stringify(ex.responses));
const cli = (args) => {
  const r = spawnSync(process.execPath, [CLI, 'agent', ...args], { encoding: 'utf8', env: { ...process.env, HOME: dir } });
  let j = null;
  try {
    j = JSON.parse(r.stdout.trim().split('\n').at(-1));
  } catch {
    /* best effort */
  }
  return { status: r.status, json: j, err: r.stderr.slice(0, 300) };
};
const events = (s, sid) => {
  const h = openExecutionLedgerFileFixture(s);
  try {
    return new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(h.db) }).readSession(sid);
  } finally {
    h.close();
  }
};
const ref = cli([
  'run',
  '--task-contract',
  path.join(dir, 'task.json'),
  '--scripted-responses',
  path.join(dir, 'responses.json'),
  '--json',
]);
const ev = events(ref.json.state, ref.json.session_id);
console.log('events:', ev.map((e) => `${e.sequence}:${e.event_type}${e.payload?.name ? '(' + e.payload.name + ')' : ''}`).join(' '));
const firstWrite = ev.find((e) => e.event_type === 'tool.execution.started' && e.payload.name === 'engineering.write');
for (let seq = firstWrite.sequence - 1; seq >= 1; seq--) {
  const f = cli(['fork', '--profile', PROFILE, '--state', ref.json.state, '--from-sequence', String(seq), '--json']);
  if (!f.json?.fork) {
    console.log(`checkpoint ${seq} (${ev[seq - 1].event_type}): fork refused: ${f.err.slice(0, 100)}`);
    continue;
  }
  const r = cli([
    'resume',
    '--profile',
    PROFILE,
    '--state',
    f.json.state,
    '--expected-sequence',
    String(f.json.current_sequence),
    '--json',
  ]);
  const fe = events(f.json.state, ref.json.session_id).slice(seq);
  console.log(
    `checkpoint ${seq} (${ev[seq - 1].event_type}): resume -> ${r.json?.task_result}/${r.json?.reason}; first new events: ${fe
      .slice(0, 6)
      .map((e) => e.event_type + (e.payload?.name ? '(' + e.payload.name + ')' : ''))
      .join(', ')}`,
  );
  const ts = events(f.json.state, ref.json.session_id).filter((e) => e.event_type === 'turn.started');
  console.log('   turn inputs:', ts.map((e) => String(e.payload.input.content).slice(0, 170).replaceAll(/\s+/g, ' ')).join(' || '));
  fs.rmSync(f.json.state, { recursive: true, force: true });
}
fs.rmSync(ref.json.state, { recursive: true, force: true });
fs.rmSync(dir, { recursive: true, force: true });
