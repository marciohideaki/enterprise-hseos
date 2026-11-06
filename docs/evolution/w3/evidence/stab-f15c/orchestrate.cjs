'use strict';
// C9 (F15): engineering runtime + binding + compaction + crash (SIGKILL) + resume with reconciliation + fork, against a reference run without compaction.
// usage: node orchestrate.cjs <repo-root> <mock|real> <out-dir>
const fs = require('node:fs'),
  path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');
const [ROOT, MODE, OUT] = process.argv.slice(2);
const req = (p) => require(path.join(ROOT, p));
const { RelationalSessionEventStore, canonicalJson } = req('packages/agent-session-store');
const { createEngineeringExample } = req('tools/examples/engineering-task');
const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
const { openExecutionLedgerFileFixture } = req('tools/mcp-project-state/lib/execution-ledger-schema');
const CLI = path.join(ROOT, 'tools/cli/hseos-cli.js'),
  PROFILE = 'disposable-engineering-candidate';
const sha = (v) => createHash('sha256').update(v).digest('hex');
const MAXREQ = Number(process.env.C9_MAX_REQUESTS || 12);
const MODEL = process.env.F15_MODEL || 'gpt-4o-mini';
const MAX_OUT = Number(process.env.F15_MAX_OUT || 4096);
process.on('uncaughtException', (error) => {
  if (error?.code === 'C9_STOP') {
    process.exitCode = 2;
    return;
  }
  console.error(error);
  process.exitCode = 1;
});
fs.mkdirSync(OUT, { recursive: true, mode: 0o700 });
const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || '/build/tmp', 'c9-work-'));
const save = (n, v) => fs.writeFileSync(path.join(OUT, n), JSON.stringify(v, null, 2) + '\n', { mode: 0o600 });
const key =
  MODE === 'real'
    ? execFileSync('pass', ['show', 'openai/api-key'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
        .split('\n')[0]
        .trim()
    : 'mock-key-not-a-secret';
const BASE = MODE === 'real' ? 'https://api.openai.com/v1' : 'https://mock.invalid/v1';
const CONTEXT_TOKENS = Number(process.env.C9_CONTEXT_TOKENS || 20_000);
const PAD = Number(process.env.C9_PAD || 600);
const DEADLINE = Date.now() + 45 * 60_000;
const steps = [];
const note = (s, v) => {
  steps.push({ s, ...v });
  save('steps.json', steps);
};

const binding = `schema_version: "1.0"
binding_id: provider-binding:openai-compatible-example
profile_id: agent-openai-compatible-candidate
adapter: openai-compatible-sse
provider:
  provider_id: model:openai-compatible
  provider_version: 1.0.0
  base_url: ${BASE}
  model: ${MODEL}
  capabilities:
    - text_generation
    - streaming
    - tool_calls
    - usage
    - cancellation
  limits:
    context_tokens: ${CONTEXT_TOKENS}
    max_output_tokens: ${MAX_OUT}
    max_parallel_requests: 1
  secret_refs:
    - name: api-key
      source_ref: env://HSEOS_MODEL_PROVIDER_API_KEY
transport:
  max_attempts: 1
  retry_delay_ms: 250
activation:
  operational: false
  authorized: false
`;
const example = structuredClone(createEngineeringExample('addition'));
example.contract.limits = { ...example.contract.limits, max_tokens: 150_000, max_duration_ms: 600_000, max_tool_calls: 8 };
// F15_INITIAL_FILE: the task starts from a realistic, buggy add.js (a numeric helper module whose `add` subtracts). The read result is
// then large by itself, with no padding, so the tool-result compaction fires after the read at the DEFAULT threshold.
const INITIAL_FILE = process.env.F15_INITIAL_FILE || path.join(__dirname, 'numeric-helpers.js');
{
  const initial = fs.readFileSync(INITIAL_FILE, 'utf8');
  example.contract.initial_files = [{ path: 'add.js', content: initial, sha256: sha(initial) }];
  example.contract.scope = { read: ['add.js'], write: ['add.js'] };
}
fs.writeFileSync(path.join(scratch, 'task.json'), JSON.stringify(example.contract));
fs.writeFileSync(path.join(scratch, 'binding.yaml'), binding);
const COMPACTION = {
  schema_version: 1,
  provider_id: 'compaction:deterministic',
  threshold_basis_points: Number(process.env.C9_THRESHOLD_BP || 2800),
  context_tokens: CONTEXT_TOKENS,
};
fs.writeFileSync(path.join(scratch, 'compaction.json'), JSON.stringify(COMPACTION));
save('inputs.json', {
  mode: MODE,
  root: ROOT,
  contract_sha256: sha(fs.readFileSync(path.join(scratch, 'task.json'))),
  binding_sha256: sha(binding),
  compaction: COMPACTION,
  compaction_sha256: sha(JSON.stringify(COMPACTION)),
  base_url: BASE,
  model: MODEL,
  max_output_tokens: MAX_OUT,
  pad_repeat: PAD,
  initial_file_sha256: sha(fs.readFileSync(process.env.F15_INITIAL_FILE || path.join(__dirname, 'numeric-helpers.js'), 'utf8')),
  context_tokens: CONTEXT_TOKENS,
  max_requests: MAXREQ,
  node: process.version,
});

function cli(args, { crashOn } = {}) {
  const env = {
    PATH: process.env.PATH,
    HOME: path.join(scratch, 'home'),
    TMPDIR: process.env.TMPDIR || '/build/tmp',
    HSEOS_MODEL_PROVIDER_API_KEY: key,
    C9_MODE: MODE,
    C9_DIR: OUT,
    C9_MAX_REQUESTS: String(MAXREQ),
    C9_DEADLINE_MS: String(DEADLINE),
    ...(crashOn ? { C9_CRASH_ON_FETCH: String(crashOn) } : {}),
  };
  fs.mkdirSync(env.HOME, { recursive: true });
  const r = spawnSync(process.execPath, ['--require', path.join(__dirname, '..', 'shared', 'fetch-guard.cjs'), CLI, 'agent', ...args], {
    encoding: 'utf8',
    env,
    timeout: Number(process.env.F15_CLI_TIMEOUT_MS || 600_000),
  });
  const out = (r.stdout || '').trim();
  let json = null;
  try {
    json = out ? JSON.parse(out.split('\n').at(-1)) : null;
  } catch {
    /* best effort */
  }
  return { status: r.status, signal: r.signal, json, stderr: (r.stderr || '').replaceAll(key, '[redacted]').slice(0, 600) };
}
const events = (state, sid) => {
  const h = openExecutionLedgerFileFixture(state);
  try {
    return new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(h.db) }).readSession(sid);
  } finally {
    h.close();
  }
};
const replayed = (state, sid) => {
  const h = openExecutionLedgerFileFixture(state);
  try {
    return new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(h.db) }).replay(sid);
  } finally {
    h.close();
  }
};
const writes = (s) => Object.values(s.tool_invocations).filter((t) => t.name === 'engineering.write');
const criteriaRefs = (l) =>
  [...new Set(l.filter((e) => e.event_type === 'context.assembled').flatMap((e) => e.payload.source_refs))].filter((r) =>
    r.endsWith('/protected-criteria'),
  );
function stateDigest(d) {
  const h = createHash('sha256');
  const walk = (c) => {
    for (const e of fs.readdirSync(c, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(c, e.name);
      if (e.isDirectory()) walk(f);
      else h.update(path.relative(d, f) + '\0').update(fs.readFileSync(f));
    }
  };
  walk(d);
  return h.digest('hex');
}
const count = () =>
  fs.existsSync(path.join(OUT, 'request-count.txt')) ? Number(fs.readFileSync(path.join(OUT, 'request-count.txt'), 'utf8')) : 0;
const stop = (why, extra) => {
  note('STOP', { why, requests: count(), ...extra });
  save('verdict.json', { completed: false, why, requests: count(), kept_states: states });
  console.log(JSON.stringify({ stopped: why, requests: count() }));
  keepStates();
  fs.rmSync(scratch, { recursive: true, force: true });
  throw Object.assign(new Error('C9_STOP'), { code: 'C9_STOP' });
};
const states = [];
const keepStates = () => {
  for (const [i, s] of states.entries()) {
    if (!fs.existsSync(s)) continue;
    fs.mkdirSync(path.join(OUT, 'states'), { recursive: true });
    execFileSync('cp', ['-a', s, path.join(OUT, 'states', String(i))]);
  }
};
const cleanup = () => {
  // Preserve every state dir (ledger) next to the evidence: C9 lost them and the fork failure could only be inferred.
  keepStates();
  for (const s of states) fs.rmSync(s, { recursive: true, force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
};
const T = (a) => path.join(scratch, a);
const runArgs = (extra = []) => ['run', '--task-contract', T('task.json'), '--binding', T('binding.yaml'), ...extra, '--json'];

// 1. reference (no compaction)
const ref = cli(runArgs());
note('reference', {
  status: ref.status,
  task_result: ref.json?.task_result,
  requests: count(),
  stderr: ref.stderr,
  json: JSON.stringify(ref.json).slice(0, 1500),
});
if (ref.json?.state) states.push(ref.json.state);
if (ref.json && ref.json.task_result !== 'approved') {
  const e = cli(['evidence', '--profile', PROFILE, '--state', ref.json.state]);
  const js = JSON.stringify(e.json);
  const i = js.indexOf('error_message');
  note('reference-evidence', { err: i === -1 ? js.slice(-500) : js.slice(i, i + 400), stderr: e.stderr });
}
if (!ref.json || ref.json.task_result !== 'approved') stop('reference-not-approved', { result: ref.json?.task_result, stderr: ref.stderr });
const refEvents = events(ref.json.state, ref.json.session_id);
const refCompactions = refEvents.filter((e) => e.event_type === 'compaction.completed').length;
// 2. create compacted run, then crash on the 2nd provider request of the resume process (after the compaction is durable)
const created = cli(runArgs(['--compaction', T('compaction.json'), '--create-only']));
if (!created.json) stop('create-failed', { stderr: created.stderr });
states.push(created.json.state);
const crash = cli(
  ['resume', '--profile', PROFILE, '--state', created.json.state, '--expected-sequence', String(created.json.current_sequence), '--json'],
  { crashOn: 3 },
);
const rec = fs.existsSync(path.join(OUT, 'crash-record.json'))
  ? JSON.parse(fs.readFileSync(path.join(OUT, 'crash-record.json'), 'utf8'))
  : null;
let pidAlive = true;
try {
  process.kill(rec?.pid, 0);
} catch (error) {
  pidAlive = error.code !== 'ESRCH';
}
note('crash', { signal: crash.signal, record: rec, pid_alive_after: pidAlive, requests: count() });
if (crash.signal !== 'SIGKILL' || !rec || pidAlive)
  stop('crash-not-proven', { signal: crash.signal, status: crash.status, stderr: crash.stderr });
const crashed = events(created.json.state, created.json.session_id);
const compaction = crashed.find((e) => e.event_type === 'compaction.completed');
note('after-crash', {
  events: crashed.length,
  last_sequence: crashed.at(-1).sequence,
  compaction_sequence: compaction?.sequence,
  compaction_event_id: compaction?.event_id,
  source_event_ids: compaction?.payload.source_event_ids?.length,
  writes: writes(replayed(created.json.state, created.json.session_id)).length,
});
if (!compaction) stop('no-compaction-before-crash', { reference_compactions: refCompactions });
// 3. resume with reconciliation
const st = cli(['status', '--profile', PROFILE, '--state', created.json.state, '--json']);
const blocked = cli(
  ['resume', '--profile', PROFILE, '--state', created.json.state, '--expected-sequence', String(st.json.current_sequence), '--json'],
  {},
);
note('resume-1', { status: blocked.status, task_result: blocked.json?.task_result, reason: blocked.json?.reason, requests: count() });
let resumed = blocked;
if (blocked.json?.task_result === 'blocked' && blocked.json.reason === 'effect-reconciliation-required') {
  const decision = T('decision.json');
  fs.writeFileSync(
    decision,
    JSON.stringify({
      report_sha256: blocked.json.reconciliation.sha256,
      decision: 'continue-from-observed-state',
      answer: 'The interrupted attempt is abandoned; continue from the durable, compacted history.',
    }),
  );
  save('reconciliation-report.json', { report_sha256: blocked.json.reconciliation.sha256 });
  resumed = cli([
    'resume',
    '--profile',
    PROFILE,
    '--state',
    created.json.state,
    '--expected-sequence',
    String(blocked.json.current_sequence),
    '--reconciliation-decision',
    decision,
    '--json',
  ]);
  note('resume-2', { status: resumed.status, task_result: resumed.json?.task_result, requests: count(), stderr: resumed.stderr });
}
if (resumed.json?.task_result !== 'approved')
  stop('resume-not-approved', { result: resumed.json?.task_result, reason: resumed.json?.reason });
const afterResume = events(created.json.state, created.json.session_id);
const cmp = {
  prefix_immutable: afterResume.slice(0, crashed.length).every((e, i) => e.event_id === crashed[i].event_id),
  single_compaction: afterResume.filter((e) => e.event_type === 'compaction.completed').length === 1,
  criteria_equal: JSON.stringify(criteriaRefs(afterResume)) === JSON.stringify(criteriaRefs(refEvents)),
  criteria_count: criteriaRefs(afterResume).length,
  writes_compacted: writes(replayed(created.json.state, created.json.session_id)).length,
  writes_reference: writes(replayed(ref.json.state, ref.json.session_id)).length,
  reference_compactions: refCompactions,
};
// Informational only, never a substitute for artifacts_equal: per-file content with trailing whitespace trimmed.
const trimmedFiles = (artifacts) =>
  JSON.stringify((artifacts?.files ?? []).map((f) => ({ path: f.path, content: String(f.content).trimEnd() })));
const ev = (s) => cli(['evidence', '--profile', PROFILE, '--state', s]).json;
const ev1 = ev(created.json.state),
  ev0 = ev(ref.json.state);
cmp.command_checks_equal =
  JSON.stringify(ev1?.verification?.evidence?.command_checks) === JSON.stringify(ev0?.verification?.evidence?.command_checks);
cmp.artifacts_equal = JSON.stringify(ev1?.artifacts) === JSON.stringify(ev0?.artifacts);
cmp.artifacts_content_equal_trimmed = trimmedFiles(ev1?.artifacts) === trimmedFiles(ev0?.artifacts);
cmp.artifacts_compared = {
  compacted_sha256: sha(JSON.stringify(ev1?.artifacts)),
  reference_sha256: sha(JSON.stringify(ev0?.artifacts)),
  compacted_preview: JSON.stringify(ev1?.artifacts).slice(0, 400),
  reference_preview: JSON.stringify(ev0?.artifacts).slice(0, 400),
};
cmp.verification = [ev1?.verification?.result, ev0?.verification?.result];
note('compare', cmp);
// 4. fork from a pre-write checkpoint (the product refuses a checkpoint after a workspace effect); with a low threshold the compaction fires after the first tool result, before any write, so the checkpoint is after the compaction
const parentBefore = events(created.json.state, created.json.session_id),
  parentDigest = stateDigest(created.json.state);
const firstWrite = parentBefore.find((e) => e.event_type === 'tool.execution.started' && e.payload.name === 'engineering.write');
let forked = null,
  checkpoint = null;
const refusals = [];
for (let seq = firstWrite.sequence - 1; seq >= 1 && !forked?.json?.fork; seq--) {
  const f = cli(['fork', '--profile', PROFILE, '--state', created.json.state, '--from-sequence', String(seq), '--json']);
  if (f.json?.fork) {
    forked = f;
    checkpoint = seq;
  } else refusals.push({ seq, stderr: f.stderr.slice(0, 120) });
}
if (!forked?.json?.fork) stop('fork-failed', { refusals });
states.push(forked.json.state);
const prefix = parentBefore.slice(0, checkpoint);
const forkChecks = {
  checkpoint_sequence: checkpoint,
  checkpoint_event_type: parentBefore[checkpoint - 1].event_type,
  checkpoint_before_first_write: checkpoint < firstWrite.sequence,
  compaction_sequence_in_parent: compaction.sequence,
  compaction_before_checkpoint: compaction.sequence < checkpoint,
  compactions_in_fork_prefix: prefix.filter((e) => e.event_type === 'compaction.completed').length,
  refusals_before_success: refusals,
  ancestry_recomputed: forked.json.fork.ancestry_sha256 === sha(canonicalJson(prefix)),
  ancestry_event_count: forked.json.fork.ancestry_event_count === prefix.length,
  parent_session: forked.json.fork.parent_session_id === created.json.session_id,
  parent_sequence: forked.json.fork.parent_sequence === checkpoint,
  fork_prefix_equals_parent_prefix: JSON.stringify(events(forked.json.state, created.json.session_id)) === JSON.stringify(prefix),
  parent_unchanged_after_fork: stateDigest(created.json.state) === parentDigest,
};
note('fork', { ...forkChecks, fork: forked.json.fork, requests: count() });
const forkDone = cli([
  'resume',
  '--profile',
  PROFILE,
  '--state',
  forked.json.state,
  '--expected-sequence',
  String(forked.json.current_sequence),
  '--json',
]);
note('fork-resume', {
  status: forkDone.status,
  task_result: forkDone.json?.task_result,
  reason: forkDone.json?.reason,
  requests: count(),
  stderr: forkDone.stderr,
});
const fe = forkDone.json?.task_result === 'approved' ? events(forked.json.state, created.json.session_id) : null;
const forkCmp = fe
  ? {
      prefix_immutable: JSON.stringify(fe.slice(0, prefix.length)) === JSON.stringify(prefix),
      criteria_equal: JSON.stringify(criteriaRefs(fe)) === JSON.stringify(criteriaRefs(refEvents)),
      writes: writes(replayed(forked.json.state, created.json.session_id)).length,
      artifacts_equal: JSON.stringify(ev(forked.json.state)?.artifacts) === JSON.stringify(ev0?.artifacts),
      artifacts_content_equal_trimmed: trimmedFiles(ev(forked.json.state)?.artifacts) === trimmedFiles(ev0?.artifacts),
      artifacts_fork_sha256: sha(JSON.stringify(ev(forked.json.state)?.artifacts)),
      artifacts_fork_preview: JSON.stringify(ev(forked.json.state)?.artifacts).slice(0, 400),
      compactions_in_fork: fe.filter((e) => e.event_type === 'compaction.completed').length,
    }
  : null;
const parentAfter = {
  parent_events_unchanged: JSON.stringify(events(created.json.state, created.json.session_id)) === JSON.stringify(parentBefore),
  parent_state_unchanged: stateDigest(created.json.state) === parentDigest,
};
note('independence', { ...parentAfter, fork: forkCmp });
save('verdict.json', {
  completed: true,
  requests: count(),
  reference_task: ref.json.task_result,
  compacted_task: resumed.json.task_result,
  fork_task: forkDone.json?.task_result,
  cmp,
  forkChecks,
  forkCmp,
  parentAfter,
});
console.log(JSON.stringify({ completed: true, requests: count(), cmp, forkChecks, forkCmp, parentAfter }));
cleanup();
