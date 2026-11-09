'use strict';
// Offline re-scoring of a finished F14 v3 execution with the corrected meter (measure.cjs). No network, no spend: it reads
// the execution's runs/<label>/result.json and the ledger copy whose sha256 equals result.state_sha256, rebuilds the final
// source from the tool events and runs the protected tests again.
// usage: node rescore.cjs --root <repo> --runs <out>/runs --ledgers <dir with hseos-ledger-fixture-*> --out <dir>
// The ledgers and the runs directory are NOT copied anywhere: only the aggregate, secret-free summary is written.
// LABEL (always): post-hoc re-scoring with a corrected meter; it does not replace the pre-registered criterion.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { TASKS, runProtected } = require('./tasks.cjs');
const { PLAN } = require('./plan.cjs');
const { evaluateCriterion } = require('./stats.cjs');
const { reconstructFinalSource } = require('./measure.cjs');
const { scanDirectory } = require('./secret-scan.cjs');

const LABEL = 'post-hoc re-scoring with a corrected meter; it does not replace the pre-registered criterion';
const sha = (value) => createHash('sha256').update(value).digest('hex');

function parse(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 2) out[argv[index].replace(/^--/, '')] = argv[index + 1];
  return out;
}

function indexLedgers(dir, wanted) {
  const found = new Map();
  for (const name of fs.readdirSync(dir)) {
    if (!name.startsWith('hseos-ledger-fixture-')) continue;
    const file = path.join(dir, name, 'ledger.sqlite');
    if (!fs.existsSync(file)) continue;
    const digest = sha(fs.readFileSync(file));
    if (wanted.has(digest)) found.set(digest, path.join(dir, name));
  }
  return found;
}

/** Reads the session events of one ledger from a private copy under $TMPDIR (opening a ledger may touch its WAL). */
function readEvents(root, ledgerDir) {
  const { openExecutionLedgerFileFixture } = require(path.join(root, 'tools/mcp-project-state/lib/execution-ledger-schema'));
  const { RelationalSessionEventStore } = require(path.join(root, 'packages/agent-session-store'));
  const { ExecutionEventLedger } = require(path.join(root, 'tools/mcp-project-state/lib/execution-event-ledger'));
  const copy = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'hseos-ledger-fixture-'));
  try {
    for (const entry of fs.readdirSync(ledgerDir, { withFileTypes: true }))
      if (entry.isFile()) fs.copyFileSync(path.join(ledgerDir, entry.name), path.join(copy, entry.name));
    const handle = openExecutionLedgerFileFixture(copy);
    try {
      const row = handle.db.prepare("SELECT aggregate_id FROM execution_events WHERE aggregate_type = 'agent_session' LIMIT 1").get();
      const store = new RelationalSessionEventStore({ ledger: new ExecutionEventLedger(handle.db) });
      return store.readSession(row.aggregate_id);
    } finally {
      handle.close();
    }
  } finally {
    fs.rmSync(copy, { recursive: true, force: true });
  }
}

function rescore({ root, runsDir, ledgersDir }) {
  const labels = fs.readdirSync(runsDir).sort();
  const results = labels.map((label) => JSON.parse(fs.readFileSync(path.join(runsDir, label, 'result.json'), 'utf8')));
  const ledgers = indexLedgers(ledgersDir, new Set(results.map((item) => item.state_sha256)));
  const rows = results.map((original) => {
    const task = TASKS.find((item) => item.id === original.task);
    const ledgerDir = ledgers.get(original.state_sha256);
    let measure = { source: null, reason: 'ledger-not-found', applied: 0, sha_checked: 0 };
    let workspaceMatch = null;
    if (ledgerDir) {
      measure = reconstructFinalSource(readEvents(root, ledgerDir), task.stub, task.file);
      const kept = path.join(ledgerDir, 'workspace', task.file);
      if (measure.source !== null && fs.existsSync(kept)) workspaceMatch = fs.readFileSync(kept, 'utf8') === measure.source;
    }
    const protectedResult =
      measure.source === null
        ? { pass: false, passed: 0, total: task.cases.length, failed: ['no-final-write'] }
        : runProtected(task, measure.source);
    const capReached = original.reason === 'request-cap-reached';
    const approved = original.task_result === 'approved' && !capReached;
    return {
      label: original.label,
      kind: original.kind,
      task: original.task,
      condition: original.condition,
      task_result: original.task_result,
      reason: original.reason ?? null,
      protected: {
        pass: protectedResult.pass,
        passed: protectedResult.passed,
        total: protectedResult.total,
        failed: protectedResult.failed,
      },
      meter: { reason: measure.reason, applied: measure.applied, sha_checked: measure.sha_checked, workspace_match: workspaceMatch },
      original_protected: original.protected,
      requests: original.usage.requests,
      cost_usd: original.cost_usd,
      success: protectedResult.pass && approved && !capReached,
      protected_pass_ignoring_request_limit: protectedResult.pass,
      rescored: true,
    };
  });
  const cell = (task, condition, key = 'success') => {
    const group = rows.filter((row) => row.kind === 'series' && row.task === task && row.condition === condition);
    return { n: group.length, successes: group.filter((row) => row[key]).length };
  };
  const tasks = TASKS.map((task) => ({ id: task.id, promoted: cell(task.id, 'promoted'), control: cell(task.id, 'control') }));
  const informational = evaluateCriterion(tasks);
  const ignoring = evaluateCriterion(
    TASKS.map((task) => ({
      id: task.id,
      promoted: cell(task.id, 'promoted', 'protected_pass_ignoring_request_limit'),
      control: cell(task.id, 'control', 'protected_pass_ignoring_request_limit'),
    })),
  );
  const controls = rows.filter((row) => row.kind === 'series' && row.condition === 'control');
  return {
    rows,
    tasks,
    informational,
    ignoring,
    controls_at_request_limit: controls.filter((row) => row.reason === 'request-cap-reached').length,
    controls: controls.length,
  };
}

function main() {
  const args = parse(process.argv.slice(2));
  if (!args.root || !args.runs || !args.ledgers || !args.out) {
    process.stderr.write('usage: rescore.cjs --root <repo> --runs <dir> --ledgers <dir> --out <dir>\n');
    return 2;
  }
  const outcome = rescore({ root: path.resolve(args.root), runsDir: path.resolve(args.runs), ledgersDir: path.resolve(args.ledgers) });
  const summary = {
    label: LABEL,
    rescored: true,
    evidence_kind: 'real-posthoc-rescoring',
    model: PLAN.model,
    meter: 'measure.cjs: final source rebuilt from the successful engineering.write / engineering.patch events of the ledger',
    runs: outcome.rows.length,
    per_task: outcome.informational.per_task,
    p: outcome.informational.p,
    criterion_applied_as_information: outcome.informational.success,
    criterion_note: 'information only; the pre-registered criterion is not re-decided by this re-scoring',
    ignoring_request_limit: {
      per_task: outcome.ignoring.per_task,
      p: outcome.ignoring.p,
      note: 'success = protected tests pass, ignoring the product verifier and the request-limit rule (tests whether the limit alone decides the contrast)',
    },
    controls_at_request_limit: `${outcome.controls_at_request_limit}/${outcome.controls}`,
    meter_failures: outcome.rows
      .filter((row) => ['sha-mismatch', 'patch-failed', 'unknown-tool-format', 'ledger-not-found'].includes(row.meter.reason))
      .map((row) => `${row.label}:${row.meter.reason}`),
    cost_usd: outcome.rows.reduce((sum, row) => sum + row.cost_usd, 0),
    executions: outcome.rows,
  };
  fs.mkdirSync(path.resolve(args.out), { recursive: true });
  fs.writeFileSync(path.join(path.resolve(args.out), 'campaign.json'), `${JSON.stringify(summary, null, 2)}\n`);
  const scan = scanDirectory(path.resolve(args.out), { literals: [] });
  process.stdout.write(
    `${JSON.stringify({ runs: summary.runs, per_task: summary.per_task, p: summary.p, meter_failures: summary.meter_failures, artifact_scan_clean: scan.clean })}\n`,
  );
  return scan.clean ? 0 : 4;
}

if (require.main === module) process.exitCode = main();
module.exports = { rescore, LABEL };
