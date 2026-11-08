'use strict';
// F14 v3 campaign script (pre-registered in docs/evolution/w3/stab2/T4.md). Runs the PRODUCTION path: `hseos agent run`
// with environment.memory.source_db. Offline rehearsal: F14V3_MODE=mock, every model call answered by a fake fetch.
// usage:
//   node f14v3.cjs plan
//   node f14v3.cjs filter
//   node f14v3.cjs --print-confirmation   (hash the owner confirms in F14V3_REAL_CONFIRMED to release the real mode)
//   node f14v3.cjs campaign --root <repo> --mode mock|real --source-db <project.db> --out <dir> [--seed <s>]
//        [--price-in N --price-out N (required in real mode, must equal PLAN.json)] [--pilots-only]
//        [--run-timeout-ms N (rehearsal only)] [--ceiling <usd, rehearsal only>] [--prior-spend <usd, rehearsal only>] [--work-dir <dir under $TMPDIR>]
// real mode reads the key from the environment variable named by F14V3_KEY_ENV (default F14V3_OPENAI_API_KEY), never from pass.
// The credential is never written, printed or kept in an artifact. The database copy lives under $TMPDIR and never enters the repository.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { TASKS, runProtected, runFilter } = require('./tasks.cjs');
const { PLAN, buildSchedule, cumulativeDecision, interruptedCallUsd, validateRealPrice } = require('./plan.cjs');
const { evaluateCriterion } = require('./stats.cjs');
const { scanFile, scanDirectory } = require('./secret-scan.cjs');
const { confirmationHash } = require('./confirmation.cjs');
const { reconstructFinalSource } = require('./measure.cjs');
const { sumUsage } = require('../shared/usage-from-sse.cjs');
const { summarizeProviderProof } = require('../shared/summarize-provider-proof.cjs');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = (file) => sha(fs.readFileSync(file));
const tmpBase = () => process.env.TMPDIR || os.tmpdir();
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const EXIT = { ok: 0, failed: 1, usage: 2, blocked: 3, secrets: 4, stopped: 5, usage_unreadable: 6 };

function parseArgs(argv) {
  const out = { flags: new Set() };
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const name = argv[index].slice(2);
    if (argv[index + 1] === undefined || argv[index + 1].startsWith('--')) out.flags.add(name);
    else out[name] = argv[(index += 1)];
  }
  return out;
}

/** Copies the SQLite database through its backup API (consistent with the WAL), into a directory under $TMPDIR. */
async function copyDatabase(Database, source, destination) {
  const handle = new Database(source, { readonly: true });
  try {
    await handle.backup(destination);
  } finally {
    handle.close();
  }
}

/** Box A: the note written (untrusted, not promoted). Box B: the same note promoted by the operator promotion API. */
async function buildBoxes({ root, Database, base, work }) {
  const req = (p) => require(path.join(root, p));
  const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
  const { createGovernedMemory, openOperatorMemory } = req('tools/cli/lib/memory-context-source');
  const boxA = path.join(work, 'box-a.db');
  const boxB = path.join(work, 'box-b.db');
  fs.copyFileSync(base, boxA);
  const handle = new Database(boxA);
  const notes = [];
  try {
    const store = createGovernedMemory({ ledger: new ExecutionEventLedger(handle), now: () => Date.now(), db: handle });
    for (const task of TASKS) {
      store.write(
        {
          scope: { project_id: task.project_id },
          memory_id: task.memory_id,
          origin: 'agent',
          trust: 'untrusted',
          content: task.note,
          source_digest: sha(task.note),
          classification: 'internal',
          source_ref: `doc://runbook/${task.id}`,
          ttl_seconds: 86_400,
        },
        { rules: [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }] },
      );
      notes.push({ task: task.id, memory_id: task.memory_id, content_sha256: sha(task.note) });
    }
    handle.pragma('wal_checkpoint(TRUNCATE)');
  } finally {
    handle.close();
  }
  fs.copyFileSync(boxA, boxB);
  const promotions = [];
  const operatorMemory = openOperatorMemory({ databasePath: boxB, operator: { kind: 'operator', id: 'owner' } });
  try {
    for (const task of TASKS) {
      const receipt = operatorMemory.promote({
        project_id: task.project_id,
        memory_id: task.memory_id,
        content_sha256: sha(task.note),
        reason: 'F14 v3 campaign: reviewed convention note',
      });
      promotions.push({ task: task.id, promoted_as: receipt.memory_id, content_sha256: receipt.content_sha256 });
    }
  } finally {
    operatorMemory.close();
  }
  return { boxA, boxB, notes, promotions, db_sha256: { box_a: sha256File(boxA), box_b: sha256File(boxB) } };
}

function bindingYaml(base, model) {
  return `schema_version: "1.0"
binding_id: provider-binding:openai-compatible-example
profile_id: agent-openai-compatible-candidate
adapter: openai-compatible-sse
provider:
  provider_id: model:openai-compatible
  provider_version: 1.0.0
  base_url: ${base}
  model: ${model}
  capabilities:
    - text_generation
    - streaming
    - tool_calls
    - usage
    - cancellation
  limits:
    context_tokens: 100000
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

const lastJson = (text) => {
  try {
    return JSON.parse(
      String(text || '')
        .trim()
        .split('\n')
        .at(-1),
    );
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
};

/** One execution: contract, `agent run`, `agent evidence`, proof, usage, replay, drain, protected tests. */
async function runOne(ctx, task, condition, label, kind) {
  const { root, mode, key, runsDir, Database, boxes, model } = ctx;
  const prices = { priceInPerMillion: ctx.price.in, priceOutPerMillion: ctx.price.out };
  const req = (p) => require(path.join(root, p));
  const { openExecutionLedgerFileFixture } = req('tools/mcp-project-state/lib/execution-ledger-schema');
  const { RelationalSessionEventStore } = req('packages/agent-session-store');
  const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
  const { fixture } = req('test/helpers/engineering-project');
  const { projectVerifierDigest } = req('tools/cli/lib/engineering-project-verifier');
  const runDir = path.join(runsDir, label);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-run-'));
  const cleanups = [];
  try {
    const f = fixture({ after: (fn) => cleanups.push(fn) }, { files: { [task.file]: task.stub }, entry: task.file });
    // The base contract is the addition example: its source and acceptance text are replaced by the task's OWN, so nothing
    // about integer addition reaches the model (P12 A2). The product is not touched.
    f.contract.task_id = `f14v3-${task.id}`;
    f.contract.sources[0].content = `Implement ${task.export} in ${task.file}.`;
    f.contract.sources[0].sha256 = sha(f.contract.sources[0].content);
    f.contract.requirements[0].description = task.requirement;
    f.contract.acceptance[0].description = `The protected verifier confirms the cases of ${task.export}.`;
    f.contract.environment = { capabilities: ['memory.retrieve'] };
    f.contract.limits = { ...f.contract.limits, max_duration_ms: 300_000, max_tool_calls: 10 };
    f.contract.verifier.checks = task.verifier_checks;
    f.contract.acceptance[0].check_ids = task.verifier_checks.map((item) => item.id);
    f.contract.verifier.sha256 = projectVerifierDigest(f.contract);
    f.save();
    const dbPath = condition === 'promoted' ? boxes.boxB : boxes.boxA;
    const configFile = path.join(scratch, 'config.yaml');
    fs.writeFileSync(configFile, `environment:\n  project_id: ${task.project_id}\n  memory:\n    rules: []\n    source_db: ${dbPath}\n`);
    const bindingFile = path.join(scratch, 'binding.yaml');
    fs.writeFileSync(bindingFile, bindingYaml(mode === 'real' ? 'https://api.openai.com/v1' : 'https://mock.invalid/v1', model));
    const countEvents = () => {
      const handle = new Database(dbPath, { readonly: true });
      try {
        return handle.prepare('SELECT COUNT(*) AS n, MAX(position) AS last FROM execution_events').get();
      } finally {
        handle.close();
      }
    };
    const before = countEvents();
    const childEnv = {
      PATH: process.env.PATH,
      HOME: path.join(scratch, 'home'),
      TMPDIR: tmpBase(),
      HSEOS_MODEL_PROVIDER_API_KEY: key,
      F14V3_MODE: mode,
      C9_DIR: runDir,
      C9_MAX_REQUESTS: String(PLAN.budget.max_requests_per_run),
      F14V3_PRICE_IN: String(ctx.price.in),
      F14V3_PRICE_OUT: String(ctx.price.out),
      F14V3_CEILING_USD: String(ctx.ceilingUsd),
      F14V3_SPENT_USD: String(ctx.spent),
      F14V3_PRIOR_SPEND_USD: String(ctx.priorSpendUsd),
      ...(mode === 'mock' && process.env.F14V3_MOCK_FAULT ? { F14V3_MOCK_FAULT: process.env.F14V3_MOCK_FAULT } : {}),
      C9_DEADLINE_MS: String(Date.now() + 15 * 60_000),
      ...(ctx.offline || process.env.F14V3_OFFLINE === '1' ? { F14V3_OFFLINE: '1' } : {}),
    };
    const cli = path.join(root, 'tools/cli/hseos-cli.js');
    const run = spawnSync(
      process.execPath,
      [
        '--require',
        path.join(__dirname, 'guard.cjs'),
        cli,
        'agent',
        'run',
        '--task-contract',
        f.filename,
        '--binding',
        bindingFile,
        '--config',
        configFile,
        '--json',
      ],
      { encoding: 'utf8', timeout: ctx.runTimeoutMs, env: childEnv },
    );
    const after = countEvents();
    const json = lastJson(run.stdout);
    const record = {
      label,
      kind,
      task: task.id,
      condition,
      evidence_kind: ctx.evidenceKind,
      cli_status: run.status,
      task_result: json?.task_result ?? null,
      reason: json?.reason ?? null,
      source_db_unchanged: JSON.stringify(before) === JSON.stringify(after),
      stderr_head: String(run.stderr || '')
        .replaceAll(key, '[redacted]')
        .slice(0, 300),
    };
    // Usage measured from the SSE frames by the guard.
    const logFile = path.join(runDir, 'provider-requests.jsonl');
    const inflightFile = path.join(runDir, 'inflight.json');
    // A request cut mid-flight (timeout) has no response: it is charged at the pessimistic cost and written to the log.
    if (fs.existsSync(inflightFile)) {
      const cut = JSON.parse(fs.readFileSync(inflightFile, 'utf8'));
      fs.appendFileSync(
        logFile,
        `${JSON.stringify({ n: cut.n, interrupted: true, usage: null, cost_usd: interruptedCallUsd(cut.max_tokens, prices), basis: 'declared context window as input plus max_tokens as output' })}\n`,
      );
      fs.rmSync(inflightFile, { force: true });
      record.interrupted_request = true;
    }
    const capFile = path.join(runDir, 'cap-reached.json');
    const capReached = fs.existsSync(capFile) ? JSON.parse(fs.readFileSync(capFile, 'utf8')) : null;
    const allLines = fs.existsSync(logFile)
      ? fs
          .readFileSync(logFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
    const lines = allLines.filter((line) => !line.refused);
    const usage = sumUsage(lines, { priceInPerMillion: ctx.price.in, priceOutPerMillion: ctx.price.out });
    record.usage = {
      requests: usage.requests,
      unreadable_requests: usage.unreadable_requests,
      prompt_tokens: usage.prompt_tokens,
      completion_tokens: usage.completion_tokens,
      cached_tokens: usage.cached_tokens,
      complete: usage.complete,
    };
    record.cost_usd = lines.reduce((sum, line) => sum + (line.cost_usd || 0), 0);
    const refusal = allLines.find((line) => line.refused);
    record.stop_reason = lines.some((line) => line.usage_unreadable)
      ? 'usage-unreadable'
      : refusal
        ? 'ceiling-projection'
        : record.interrupted_request
          ? 'interrupted-timeout'
          : null;
    if (refusal) record.refusal = refusal;
    record.responding_models = [...new Set(lines.map((line) => line.responding_model).filter(Boolean))];
    let finalSource = null;
    if (json?.state) {
      const handle = openExecutionLedgerFileFixture(json.state);
      try {
        const ledger = new ExecutionEventLedger(handle.db);
        const store = new RelationalSessionEventStore({ ledger });
        const events = store.readSession(json.session_id);
        const replayed = store.replay(json.session_id);
        const assembled = events.find((event) => event.event_type === 'context.assembled');
        const sources = (assembled?.payload.sources ?? []).filter((item) => item.origin === 'memory');
        const blocks = (assembled?.payload.request.messages ?? [])
          .map((m) => m.content)
          .filter((c) => String(c).startsWith('[HSEOS MEMORY_DATA'));
        // The final source is rebuilt from the successful write/patch calls of the ledger (see measure.cjs).
        const rebuilt = reconstructFinalSource(events, task.stub, task.file);
        finalSource = rebuilt.source;
        record.measure = { reason: rebuilt.reason, applied: rebuilt.applied, sha_checked: rebuilt.sha_checked };
        const invocations = Object.values(replayed.tool_invocations || {});
        record.replay = {
          ok: true,
          session_events: events.length,
          tool_invocations: invocations.length,
          // The context the model received must carry nothing of the addition example (P12 A2).
          contract_residue: /integer addition|positive, negative and zero|addIntegers/i.test(JSON.stringify(assembled?.payload ?? '')),
          note_in_context: blocks.some((block) => block.includes(task.note)),
          memory_sources: sources.map((item) => ({ trust: item.trust, authority: item.authority, source_ref: item.source_ref })),
        };
        // Drain: every started tool call must have ended; nothing is left running after the session.
        const ended = new Set(
          events.filter((event) => event.event_type === 'tool.execution.completed').map((event) => event.payload.step_id),
        );
        const started = events.filter((event) => event.event_type === 'tool.execution.started');
        record.tool_outcomes = events
          .filter((event) => event.event_type === 'tool.execution.completed')
          .map((event) =>
            JSON.stringify(event.payload.outcome, (name, value) =>
              ['content', 'stdout', 'stderr'].includes(name) ? undefined : value,
            ).slice(-260),
          );
        record.drain = { started: started.length, orphans: started.filter((event) => !ended.has(event.payload.step_id)).length };
      } catch (error) {
        record.replay = { ok: false, error: String(error?.code || error?.message).slice(0, 120) };
      } finally {
        handle.close();
      }
      const evidence = spawnSync(
        process.execPath,
        [
          '--require',
          path.join(__dirname, 'guard.cjs'),
          cli,
          'agent',
          'evidence',
          '--profile',
          'disposable-engineering-candidate',
          '--state',
          json.state,
          '--json',
        ],
        { encoding: 'utf8', timeout: 60_000, env: { ...childEnv, HSEOS_MODEL_PROVIDER_API_KEY: undefined } },
      );
      const evidenceFile = path.join(scratch, 'evidence.json');
      fs.writeFileSync(evidenceFile, evidence.stdout || '', { mode: 0o600 });
      const proofRun = spawnSync(process.execPath, [path.join(__dirname, '../shared/summarize-provider-proof.cjs'), evidenceFile], {
        encoding: 'utf8',
      });
      const evidenceJson = lastJson(evidence.stdout) || safeParse(evidence.stdout);
      // The guard refused a call past the request cap: the adapter counted it in `requests_total` but it never reached the
      // provider. The proof is judged over the requests that were made (all of them must still be verified).
      if (capReached) {
        const original = findProofObject(evidenceJson);
        if (original) {
          record.cap_adjustment = { requests_total_reported: original.requests_total, requests_made: capReached.made };
          original.requests_total = capReached.made;
          original.backend_verified = original.requests_verified === capReached.made && capReached.made > 0;
        }
      }
      const proof = summarizeProviderProof(evidenceJson);
      record.provider_proof = {
        verdict: proof.verdict,
        failures: proof.failures,
        summarizer_exit: proofRun.status,
        ...publicProof(evidenceJson),
      };
      record.state_sha256 = sha256File(path.join(json.state, fs.readdirSync(json.state).find((name) => name.endsWith('.sqlite')) || ''));
    }
    if (!record.measure) record.measure = { reason: 'no-ledger', applied: 0, sha_checked: 0 };
    const protectedResult =
      finalSource === null
        ? { pass: false, passed: 0, total: task.cases.length, failed: ['no-final-write'] }
        : runProtected(task, finalSource);
    record.protected = {
      pass: protectedResult.pass,
      passed: protectedResult.passed,
      total: protectedResult.total,
      failed: protectedResult.failed,
    };
    record.product_verifier_approved = record.task_result === 'approved';
    record.success = record.protected.pass && record.product_verifier_approved;
    if (capReached) {
      // Too many tool calls is a legitimate task failure, not a protocol failure.
      record.task_result = 'failed';
      record.reason = 'request-cap-reached';
      record.success = false;
      record.product_verifier_approved = false;
    }
    write(path.join(runDir, 'result.json'), record);
    return record;
  } finally {
    for (const fn of cleanups.toReversed()) fn();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** The public form of the proof: everything except the credential hash, which stays out of the receipt. */
function findProofObject(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.provider_proof && typeof value.provider_proof === 'object') return value.provider_proof;
  for (const child of Object.values(value)) {
    const found = findProofObject(child);
    if (found) return found;
  }
  return null;
}

function publicProof(evidence) {
  const find = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (value.provider_proof && typeof value.provider_proof === 'object') return value.provider_proof;
    for (const child of Object.values(value)) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  };
  const proof = find(evidence);
  if (!proof) return { proof_present: false };
  const { credential_sha256: credential, ...rest } = proof;
  return { proof_present: true, proof: { ...rest, credential_sha256_present: typeof credential === 'string' && credential.length === 64 } };
}

function analyse(records) {
  const tasks = TASKS.map((task) => {
    const cell = (condition) => {
      const rows = records.filter((item) => item.kind === 'series' && item.task === task.id && item.condition === condition);
      return { n: rows.length, successes: rows.filter((item) => item.success).length };
    };
    return { id: task.id, promoted: cell('promoted'), control: cell('control') };
  });
  const complete = tasks.every(
    (item) => item.promoted.n === PLAN.n_per_task_per_condition && item.control.n === PLAN.n_per_task_per_condition,
  );
  const controls = records.filter((item) => item.kind === 'series' && item.condition === 'control');
  const atLimit = controls.filter((item) => item.reason === 'request-cap-reached').length;
  const exhaustion = { controls_at_request_limit: atLimit, controls: controls.length };
  return complete
    ? { complete, ...evaluateCriterion(tasks), ...exhaustion }
    : { complete, success: false, reason: 'series-incomplete', per_task: tasks, ...exhaustion };
}

async function campaign(args) {
  const root = path.resolve(args.root || '');
  const mode = args.mode;
  if (!['mock', 'real'].includes(mode) || !args.root || !args['source-db'] || !args.out) {
    process.stderr.write('usage: campaign --root <repo> --mode mock|real --source-db <db> --out <dir> [--seed S]\n');
    return EXIT.usage;
  }
  if (mode === 'real' && process.env.F14V3_REAL_CONFIRMED !== confirmationHash()) {
    process.stderr.write(
      'BLOCKED: real mode needs F14V3_REAL_CONFIRMED equal to the hash printed by --print-confirmation; nothing was started\n',
    );
    return EXIT.blocked;
  }
  const Database = require('node:module').createRequire(path.join(root, 'package.json'))('better-sqlite3');
  const model = PLAN.model;
  let price;
  if (mode === 'real') {
    const checked = validateRealPrice(Number(args['price-in']), Number(args['price-out']));
    if (!checked.ok) {
      process.stderr.write(`${checked.reason}\n`);
      return EXIT.usage;
    }
    price = checked.price;
  } else {
    price = {
      in: Number(args['price-in'] ?? PLAN.budget.price_usd_per_million.in),
      out: Number(args['price-out'] ?? PLAN.budget.price_usd_per_million.out),
    };
    if (!(Number.isFinite(price.in) && price.in > 0 && Number.isFinite(price.out) && price.out > 0)) {
      process.stderr.write('price-invalid: --price-in and --price-out must be finite numbers > 0\n');
      return EXIT.usage;
    }
  }
  const keyEnv = process.env.F14V3_KEY_ENV || 'F14V3_OPENAI_API_KEY';
  let key;
  if (mode === 'real') {
    key = process.env[keyEnv];
    if (!key) {
      process.stderr.write(`real mode needs the key in the environment variable ${keyEnv}\n`);
      return EXIT.usage;
    }
    if (args.ceiling || args['prior-spend'] !== undefined) {
      process.stderr.write('--ceiling and --prior-spend are only for the rehearsal: the real ceiling is US$ 3, cumulative\n');
      return EXIT.usage;
    }
    if (args.seed) {
      process.stderr.write('--seed is only for the rehearsal: the real seed is drawn at start\n');
      return EXIT.usage;
    }
  } else {
    key = `fake-${randomBytes(18).toString('hex')}`;
  }
  const out = path.resolve(args.out);
  const work = fs.mkdtempSync(path.join(tmpBase(), 'f14v3-campaign-'));
  const result = {
    confirmation_sha256: confirmationHash(),
    mode,
    evidence_kind: mode === 'real' ? 'real' : 'fixture-rehearsal',
    model,
    started_at: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(path.join(out, 'runs'), { recursive: true, mode: 0o700 });
    // 1. database copy and scan BEFORE any use
    const base = path.join(work, 'base.db');
    await copyDatabase(Database, path.resolve(args['source-db']), base);
    const scan = scanFile(base, { literals: [key] });
    result.database = {
      kind: mode === 'real' ? 'real' : 'fixture-copy',
      sha256: sha256File(base),
      bytes: scan.bytes,
      secret_scan: { clean: scan.clean, hits: scan.hits },
      in_repository: false,
    };
    if (!scan.clean) {
      result.verdict = 'BLOCKED: secret scan of the database copy found hits; the database was not used';
      write(path.join(out, 'campaign.json'), result);
      return EXIT.secrets;
    }
    // 2. boxes
    const boxes = await buildBoxes({ root, Database, base, work });
    fs.rmSync(base, { force: true });
    result.boxes = { notes: boxes.notes, promotions: boxes.promotions, db_sha256: boxes.db_sha256 };
    // 3. seed, recorded BEFORE the first call
    const seed = args.seed || randomBytes(16).toString('hex');
    const schedule = buildSchedule(seed);
    const seedFile = path.join(out, 'seed.json');
    const fd = fs.openSync(seedFile, 'w', 0o600);
    fs.writeSync(
      fd,
      `${JSON.stringify({ seed, drawn_at: new Date().toISOString(), plan_sha256: sha(JSON.stringify(PLAN)), schedule_sha256: sha(JSON.stringify(schedule)) }, null, 2)}\n`,
    );
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    result.seed_recorded_before_first_call = true;
    result.schedule = schedule;
    // Cumulative ceiling: what earlier executions already spent counts. The rehearsal can set it (--prior-spend); with a custom
    // --ceiling and no --prior-spend it starts from zero so the small test ceilings stay meaningful.
    let priorSpendUsd = PLAN.budget.prior_spend_usd;
    if (mode !== 'real') {
      if (args['prior-spend'] === undefined) {
        if (args.ceiling) priorSpendUsd = 0;
      } else priorSpendUsd = Number(args['prior-spend']);
    }
    const ctx = {
      root,
      mode,
      key,
      work,
      runsDir: path.join(out, 'runs'),
      Database,
      boxes,
      model,
      price,
      offline: mode === 'mock',
      evidenceKind: result.evidence_kind,
      ceilingUsd: args.ceiling ? Number(args.ceiling) : PLAN.budget.ceiling_usd,
      runTimeoutMs: mode === 'mock' && args['run-timeout-ms'] ? Number(args['run-timeout-ms']) : 280_000,
      spent: 0,
      priorSpendUsd,
    };
    const records = [];
    let spent = 0;
    const gate = () => {
      const decision = cumulativeDecision({
        priorUsd: priorSpendUsd,
        spentUsd: spent,
        ceilingUsd: args.ceiling ? Number(args.ceiling) : PLAN.budget.ceiling_usd,
      });
      if (decision.stop) {
        result.stopped = {
          reason: 'cumulative ceiling',
          ...decision,
          prior_spend_usd: priorSpendUsd,
          spent_usd: spent,
          runs_done: records.length,
        };
        return false;
      }
      return true;
    };
    // A protocol failure (control-provider refusal or a failed adapter proof) ends the campaign at once: the same
    // failure must never be paid for twice.
    const protocolFailure = (record) => {
      if (record.stop_reason) return null;
      if (String(record.reason ?? '').startsWith('CONTROL_PROVIDER_')) return record.reason;
      if (record.provider_proof?.verdict !== 'pass') return `provider-proof-${record.provider_proof?.verdict ?? 'absent'}`;
      return null;
    };
    const halted = (record) => {
      const failure = protocolFailure(record);
      if (failure) {
        result.stopped = { reason: 'protocol failure', detail: failure, after_run: record.label, runs_done: records.length };
        return true;
      }
      if (record.stop_reason !== 'usage-unreadable' && record.stop_reason !== 'ceiling-projection') return false;
      result.stopped = {
        reason: record.stop_reason === 'ceiling-projection' ? 'cumulative ceiling' : record.stop_reason,
        ...(record.stop_reason === 'ceiling-projection' ? { detail: 'ceiling-projection' } : {}),
        after_run: record.label,
        runs_done: records.length,
        ...(record.refusal ? { refusal: record.refusal } : {}),
      };
      return true;
    };
    // 4. pilots: control, one per task
    for (const task of TASKS) {
      if (!gate()) break;
      ctx.spent = spent;
      const record = await runOne(ctx, task, 'control', `pilot-${task.id}`, 'pilot');
      spent += record.cost_usd;
      records.push(record);
      if (halted(record)) break;
    }
    result.pilots = records.map((item) => ({
      task: item.task,
      passed_protected_tests: item.protected.pass,
      rejects_task: item.protected.pass,
    }));
    const rejected = result.pilots.filter((item) => item.rejects_task).map((item) => item.task);
    if (!result.stopped && rejected.length > 0) {
      result.verdict = `BLOCKED: pilot passed without memory, task rejected: ${rejected.join(', ')}`;
    } else if (!result.stopped && !args.flags.has('pilots-only')) {
      for (const item of schedule) {
        if (!gate()) break;
        const task = TASKS.find((candidate) => candidate.id === item.task);
        ctx.spent = spent;
        const record = await runOne(
          ctx,
          task,
          item.condition,
          `s${String(item.order).padStart(2, '0')}-${item.task}-${item.condition}-${item.rep}`,
          'series',
        );
        spent += record.cost_usd;
        records.push(record);
        if (halted(record)) break;
      }
    }
    // 5. analysis and measures
    const series = records.filter((item) => item.kind === 'series');
    result.analysis = analyse(records);
    result.runs = records.map((record) => ({ ...record, stderr_head: undefined }));
    result.totals = {
      runs: records.length,
      series_runs: series.length,
      cost_usd_estimate: spent,
      prior_spend_usd: priorSpendUsd,
      cumulative_cost_usd: priorSpendUsd + spent,
      requests: records.reduce((sum, item) => sum + item.usage.requests, 0),
      prompt_tokens: records.reduce((sum, item) => sum + item.usage.prompt_tokens, 0),
      completion_tokens: records.reduce((sum, item) => sum + item.usage.completion_tokens, 0),
      price_declared_usd_per_million: price,
    };
    const issues = [];
    for (const item of records) {
      if (!item.usage.complete) issues.push(`${item.label}: usage-incomplete`);
      if (item.provider_proof?.verdict !== 'pass') issues.push(`${item.label}: provider-proof-${item.provider_proof?.verdict ?? 'absent'}`);
      if (!item.replay?.ok) issues.push(`${item.label}: replay-failed`);
      if (item.replay?.contract_residue !== false) issues.push(`${item.label}: contract-residue`);
      if (['sha-mismatch', 'patch-failed', 'unknown-tool-format'].includes(item.measure?.reason))
        issues.push(`${item.label}: meter-${item.measure.reason}`);
      if (item.drain?.orphans !== 0) issues.push(`${item.label}: drain-orphans`);
      if (!item.source_db_unchanged) issues.push(`${item.label}: source-db-changed`);
      const expected = item.condition === 'promoted' ? 1 : 0;
      if (item.replay?.memory_sources?.length !== expected || item.replay?.note_in_context !== (expected === 1))
        issues.push(`${item.label}: box-mismatch`);
    }
    result.protocol_issues = issues;
    result.verdict =
      result.verdict ||
      (result.stopped
        ? `STOPPED: ${result.stopped.reason}`
        : issues.length > 0
          ? 'FAIL: protocol issues'
          : args.flags.has('pilots-only')
            ? 'NOT EVALUATED: pilots only, no series run'
            : result.analysis.success
              ? 'CRITERION MET'
              : 'CRITERION NOT MET');
    result.limits = {
      guard_coverage:
        'The guard wraps the global fetch of the agent process only. node:https, node:http and child processes are NOT covered.',
      key_scope:
        'The key exists only in the environment of the agent process (spawn env) and is not passed to agent evidence. Engineering tools run under bwrap --clearenv (packages/agent-isolation-attestation/index.js:364) with an environment declared as not inherited (profiles.js:205). Read from the code, not measured in a run.',
      protected_comparison: 'Protected cases compare with JSON.stringify: undefined, NaN, -0 and object key order are not distinguished.',
      requests_per_run_cap: PLAN.budget.max_requests_per_run,
      request_cap_effect:
        'The cap of 8 requests per execution punishes the control by exhaustion: it confounds "memory helps to get it right" with "memory helps to finish within the limit". The analysis reports how many controls hit the limit (analysis.controls_at_request_limit).',
    };
    result.finished_at = new Date().toISOString();
    write(path.join(out, 'campaign.json'), result);
    // 6. secret scan over every artifact, with the key as a literal
    const artifactScan = scanDirectory(out, { literals: [key] });
    result.artifact_scan = artifactScan;
    write(path.join(out, 'campaign.json'), result);
    process.stdout.write(
      `${JSON.stringify({ verdict: result.verdict, runs: records.length, cost_usd_estimate: Number(spent.toFixed(4)), p: result.analysis.p ?? null, protocol_issues: issues.length, artifact_scan_clean: artifactScan.clean })}\n`,
    );
    if (result.stopped?.reason === 'usage-unreadable') return EXIT.usage_unreadable;
    if (result.stopped) return EXIT.stopped;
    if (!artifactScan.clean || issues.length > 0) return EXIT.failed;
    if (result.verdict.startsWith('BLOCKED')) return EXIT.blocked;
    return mode === 'real' && !args.flags.has('pilots-only') && !result.analysis.success ? EXIT.failed : EXIT.ok;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--print-confirmation' || command === 'print-confirmation') {
    process.stdout.write(`${confirmationHash()}\n`);
    return EXIT.ok;
  }
  if (command === 'plan') {
    process.stdout.write(`${JSON.stringify(PLAN, null, 2)}\n`);
    return EXIT.ok;
  }
  if (command === 'filter') {
    const filter = runFilter();
    process.stdout.write(`${JSON.stringify(filter, null, 2)}\n`);
    return filter.accepted ? EXIT.ok : EXIT.failed;
  }
  if (command === 'campaign') return campaign(parseArgs(rest));
  process.stderr.write('usage: f14v3.cjs plan | filter | campaign ...\n');
  return EXIT.usage;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.code || error.message}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = { analyse, publicProof, parseArgs, EXIT };
