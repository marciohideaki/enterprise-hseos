'use strict';
// F14 campaign (stabilization): a REAL model task reads a memory the operator promoted to trusted.
// usage (repository root):
//   node f14.cjs prepare <out-dir>                      builds an activated fixture db, writes the agent note, prints the operator command
//   node --require ./fetch-guard.cjs f14.cjs run <box-dir> <mock|real> <label> <out-dir>
//     (C9_MODE, C9_DIR and C9_MAX_REQUESTS are read by fetch-guard.cjs; C9_DIR must equal <out-dir>)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = process.cwd();
const req = (p) => require(path.join(root, p));
const Database = require('node:module').createRequire(path.join(root, 'package.json'))('better-sqlite3');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const PROJECT = 'f14-live';
const MEMORY_ID = 'f14-note-1';
const MARKER = 'OVF-7391';
const NOTE = `Remember: the overflow guarantee code of this project is ${MARKER}; adding integers never overflows and the sum is exact.`;
const RULES = [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }];
const OPERATOR = { kind: 'operator', id: 'owner' };

async function prepare(out) {
  const { activateExecutionLedger, openOperationalStateDatabase } = req('tools/mcp-project-state/lib/operational-state-db');
  const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
  const { createGovernedMemory } = req('tools/cli/lib/memory-context-source');
  const box = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f14-live-'));
  const decisions = path.join(box, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(path.join(decisions, 'ADR-0048-criterion.md'), '# ADR-0048: criterion\n\n## Status\n\nAccepted — 2026-10-22\n');
  const db = path.join(box, 'state', 'project.db');
  openOperationalStateDatabase(db).close();
  await activateExecutionLedger(db, {
    adr: 'ADR-0048',
    backupDir: path.join(box, 'backups'),
    now: () => Date.now(),
    internal: { decisionsDirectory: decisions },
  });
  const handle = new Database(db);
  try {
    const store = createGovernedMemory({ ledger: new ExecutionEventLedger(handle), now: () => Date.now(), db: handle });
    store.write(
      {
        scope: { project_id: PROJECT },
        memory_id: MEMORY_ID,
        origin: 'agent',
        trust: 'untrusted',
        content: NOTE,
        source_digest: sha(NOTE),
        classification: 'internal',
        source_ref: 'doc://runbook/sums',
        ttl_seconds: 86_400,
      },
      { rules: RULES },
    );
  } finally {
    handle.close();
  }
  fs.mkdirSync(out, { recursive: true });
  const report = {
    box,
    db,
    project_id: PROJECT,
    memory_id: MEMORY_ID,
    content_sha256: sha(NOTE),
    operator_command: `hseos memory promote --db ${db} --project ${PROJECT} --memory ${MEMORY_ID} --reason "F14 campaign: reviewed marker note" --operator owner`,
  };
  fs.writeFileSync(path.join(out, 'prepare.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

function bindingYaml(base) {
  return `schema_version: "1.0"
binding_id: provider-binding:openai-compatible-example
profile_id: agent-openai-compatible-candidate
adapter: openai-compatible-sse
provider:
  provider_id: model:openai-compatible
  provider_version: 1.0.0
  base_url: ${base}
  model: gpt-4o-mini
  capabilities:
    - text_generation
    - streaming
    - tool_calls
    - usage
    - cancellation
  limits:
    context_tokens: ${process.env.F14_CONTEXT_TOKENS || 20_000}
    max_output_tokens: 1024
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
}

async function run(boxDir, mode, label, out) {
  const { runEngineeringTask } = req('tools/cli/lib/engineering-task-runtime');
  const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
  const { openExecutionLedgerFileFixture } = req('tools/mcp-project-state/lib/execution-ledger-schema');
  const { createGovernedMemory } = req('tools/cli/lib/memory-context-source');
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const scratch = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'f14-run-'));
  process.env.HSEOS_MODEL_PROVIDER_API_KEY =
    mode === 'real'
      ? execFileSync('pass', ['show', 'openai/api-key'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
          .split('\n')[0]
          .trim()
      : 'mock-key-not-a-secret';
  // A managed-project contract (the only profile with environment capabilities): index.js starts WRONG (returns n) and the
  // protected check expects 4 for 3, so the model has to edit it; the requirement points at the project memory for the comment.
  const cleanups = [];
  const { fixture } = req('test/helpers/engineering-project');
  const f = fixture({ after: (fn) => cleanups.push(fn) }, { files: { 'index.js': 'module.exports = (n) => n;\n' } });
  f.contract.requirements[0].description =
    'Make index.js export a function that returns its argument plus one, and add a comment in index.js that states the project overflow guarantee code exactly as given in the project memory data.';
  f.contract.environment = { capabilities: ['memory.retrieve'] };
  f.contract.limits = { ...f.contract.limits, max_duration_ms: 300_000, max_tool_calls: 6 };
  f.contract.verifier.sha256 = req('tools/cli/lib/engineering-project-verifier').projectVerifierDigest(f.contract);
  f.save();
  const taskFile = f.filename;
  const bindingFile = path.join(scratch, 'binding.yaml');
  fs.writeFileSync(bindingFile, bindingYaml(mode === 'real' ? 'https://api.openai.com/v1' : 'https://mock.invalid/v1'));
  const db = new Database(path.join(boxDir, 'state', 'project.db'));
  let result;
  try {
    const store = createGovernedMemory({ ledger: new ExecutionEventLedger(db), now: () => Date.now(), db });
    const host = { project_id: PROJECT, memory: { store, rules: RULES, operator: OPERATOR } };
    result = await runEngineeringTask({ taskContract: taskFile, binding: bindingFile, environmentHost: host });
  } finally {
    db.close();
  }
  const handle = openExecutionLedgerFileFixture(result.state);
  let report;
  try {
    const events = handle.db
      .prepare("SELECT payload_json FROM execution_events WHERE aggregate_type = 'agent_session' ORDER BY position")
      .all()
      .map((row) => JSON.parse(JSON.parse(row.payload_json).session_event_json));
    const assembled = events.find((e) => e.event_type === 'context.assembled');
    const sources = (assembled?.payload.sources ?? []).filter((s) => s.origin === 'memory');
    const blocks = (assembled?.payload.request.messages ?? []).map((m) => m.content).filter((c) => c.startsWith('[HSEOS MEMORY_DATA'));
    const written = events
      .filter((e) => e.event_type === 'tool.execution.started')
      .map((e) => JSON.stringify(e.payload.input))
      .join('\n');
    report = {
      label,
      mode,
      observed_at: new Date().toISOString(),
      task_run_id: result.task_run_id,
      session_id: result.session_id,
      task_result: result.task_result,
      context_assembled: Boolean(assembled),
      summary: JSON.stringify(result).slice(0, 1500),
      event_types: [...new Set(events.map((e) => e.event_type))],
      reason: result.reason ?? null,
      memory_sources: sources,
      memory_blocks: blocks.map((b) => ({ sha256: sha(b), bytes: Buffer.byteLength(b), authority_data: /authority=data/.test(b) })),
      marker_in_context: blocks.join('\n').includes(MARKER),
      marker_in_written_artifact: written.includes(MARKER),
      note_digest: sha(NOTE),
    };
  } finally {
    handle.close();
  }
  fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  fs.mkdirSync(path.join(out, 'states'), { recursive: true });
  execFileSync('cp', ['-a', result.state, path.join(out, 'states', label)]);
  fs.rmSync(scratch, { recursive: true, force: true });
  for (const fn of cleanups.toReversed()) fn();
  process.stdout.write(
    `${JSON.stringify({ label, task_result: report.task_result, memory_sources: report.memory_sources.length, marker_in_context: report.marker_in_context, marker_in_written_artifact: report.marker_in_written_artifact })}\n`,
  );
}

const [command, ...args] = process.argv.slice(2);
const main = command === 'prepare' ? () => prepare(args[0]) : () => run(...args);
main().catch((error) => {
  process.stderr.write(`${error.code || error.message} ${error.reason ?? ''} ${JSON.stringify(error.details ?? {})}\n`);
  process.exitCode = 1;
});
