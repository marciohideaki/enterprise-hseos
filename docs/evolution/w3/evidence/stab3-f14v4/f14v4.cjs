'use strict';
// F14 v4 campaign script (protocol approved by the owner on 2026-11-09: docs/evolution/w3/stab2/F14-V4-PROTOCOL.md).
// Runs the PRODUCTION path: `hseos agent run` with environment.memory.source_db. Offline rehearsal: mode `fixture`, every model call
// answered by a fake fetch. The campaign NEVER promotes memory in real mode: the owner does it in his own terminal.
// usage (the repository root is ALWAYS an absolute path; never wrap the campaign in heavy-run):
//   node f14v4.cjs plan
//   node f14v4.cjs filter
//   node f14v4.cjs --print-confirmation       (hash the owner gives back in F14V4_REAL_CONFIRMED to release the real mode)
//   node f14v4.cjs prepare --root <abs> --mode real|fixture --source-db <project.db> [--work-dir <dir under $TMPDIR>]
//        copies the database (SQLite backup), scans it, creates the boxes A, B and C with the notes as AGENT memory (untrusted)
//        and PRINTS the 6 `hseos memory promote` commands for the owner to run in his terminal
//   node f14v4.cjs verify-promotions --root <abs> --prepared <dir>
//        opens every box and requires the 6 promotions (trust, content sha256, operator owner) and the control untouched
//   node f14v4.cjs campaign --root <abs> --mode fixture --source-db <project.db> --out <dir> [--seed <s>] [--pilots-only]
//        [--run-timeout-ms N] [--ceiling <usd>] [--prior-spend <usd>] [--wall-clock-minutes N]   (rehearsal only; promotes through the API)
//   node f14v4.cjs campaign --root <abs> --mode real --prepared <dir> --out <dir> --price-in 2.5 --price-out 10 --credit-usd <n>
//        [--pilots-only]   (real: verifies the promotions before the first call; reads F14V4_OPENAI_API_KEY; needs F14V4_REAL_CONFIRMED)
// The credential is never written, printed or kept in an artifact. The database copy lives under $TMPDIR and never enters the repository.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { TASKS, runProtected, runFilter } = require('./tasks.cjs');
const {
  PLAN,
  buildSchedule,
  cumulativeDecision,
  interruptedCallUsd,
  effectiveCeilingUsd,
  campaignCeilingUsd,
  validateRealPrice,
  countIndependentProofChecks,
} = require('./plan.cjs');
const { evaluateCriterion } = require('../stab3-f14v3/stats.cjs');
const { scanFile, scanDirectory } = require('../stab3-f14v3/secret-scan.cjs');
const { confirmationHash, productFileHashes } = require('./confirmation.cjs');
const { reconstructFinalSource } = require('../stab3-f14v3/measure.cjs');
const { sumUsage } = require('../shared/usage-from-sse.cjs');
const { summarizeProviderProof } = require('../shared/summarize-provider-proof.cjs');

const sha = (value) => createHash('sha256').update(value).digest('hex');
const sha256File = (file) => sha(fs.readFileSync(file));
const tmpBase = () => process.env.TMPDIR || os.tmpdir();
const write = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
const EXIT = { ok: 0, failed: 1, usage: 2, blocked: 3, secrets: 4, stopped: 5, usage_unreadable: 6 };
const OPERATOR = PLAN.promotion.operator;
const BOXES = Object.freeze({ control: 'A', promoted: 'B', placebo: 'C' });
const MANIFEST = 'prepared.json';

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

const loadDatabase = (root) => require('node:module').createRequire(path.join(root, 'package.json'))('better-sqlite3');

/** The notes of one box: A and B hold the OWN note of each task, C holds the note of ANOTHER task (placebo). */
function boxNotes(box) {
  return TASKS.map((task) =>
    box === 'C'
      ? {
          task: task.id,
          role: 'placebo',
          project_id: task.project_id,
          memory_id: task.placebo_memory_id,
          content: task.placebo_note,
          from: task.placebo_of,
        }
      : { task: task.id, role: 'own', project_id: task.project_id, memory_id: task.memory_id, content: task.note, from: task.id },
  );
}

/** The 6 promotions the owner makes: the 3 own notes in box B and the 3 placebo notes in box C. */
function expectedPromotions(boxFiles) {
  return ['B', 'C'].flatMap((box) =>
    boxNotes(box).map((note) => ({
      box,
      ...note,
      db: boxFiles[box],
      promoted_id: `${note.memory_id}:promoted`,
      content_sha256: sha(note.content),
    })),
  );
}

const shellQuote = (value) => (/^[\w./:=@%+-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`);

/** The exact command the owner runs, one per promotion (it needs a TTY and handles one memory at a time). */
function promotionCommand(item) {
  const reason = `F14 v4: owner reviewed the ${item.role} note of ${item.from} against F14-V4-PROTOCOL.md section 3`;
  return `hseos memory promote --db ${shellQuote(item.db)} --project ${item.project_id} --memory ${item.memory_id} --reason "${reason}" --operator ${OPERATOR}`;
}

/**
 * Creates the three boxes with the notes as AGENT memory (untrusted). Nothing is promoted here. The database copy is scanned for
 * secrets BEFORE any use and removed once the boxes exist. Returns { ok, manifest } or { ok: false, scan }.
 */
async function prepareBoxes({ root, Database, source, workDir, mode, literals = [] }) {
  const req = (p) => require(path.join(root, p));
  const { ExecutionEventLedger } = req('tools/mcp-project-state/lib/execution-event-ledger');
  const { createGovernedMemory } = req('tools/cli/lib/memory-context-source');
  fs.mkdirSync(workDir, { recursive: true, mode: 0o700 });
  const base = path.join(workDir, 'base.db');
  await copyDatabase(Database, source, base);
  const scan = scanFile(base, { literals });
  const baseSha = sha256File(base);
  if (!scan.clean) {
    fs.rmSync(base, { force: true });
    return { ok: false, scan: { clean: false, hits: scan.hits }, base_sha256: baseSha };
  }
  const files = { A: path.join(workDir, 'box-a.db'), B: path.join(workDir, 'box-b.db'), C: path.join(workDir, 'box-c.db') };
  for (const [box, file] of Object.entries(files)) {
    fs.copyFileSync(base, file);
    const handle = new Database(file);
    try {
      const store = createGovernedMemory({ ledger: new ExecutionEventLedger(handle), now: () => Date.now(), db: handle });
      for (const note of boxNotes(box)) {
        store.write(
          {
            scope: { project_id: note.project_id },
            memory_id: note.memory_id,
            origin: 'agent',
            trust: 'untrusted',
            content: note.content,
            source_digest: sha(note.content),
            classification: 'internal',
            source_ref: `doc://runbook/${note.from}`,
            ttl_seconds: PLAN.promotion.memory_ttl_seconds,
          },
          { rules: [{ id: 'memory-write', source: 'project', stage: 'allow', decision: 'allow' }] },
        );
      }
      handle.pragma('wal_checkpoint(TRUNCATE)');
    } finally {
      handle.close();
    }
  }
  fs.rmSync(base, { force: true });
  const promotions = expectedPromotions(files).map((item) => ({ ...item, command: promotionCommand(item) }));
  const manifest = {
    schema: 'f14v4-prepared/1',
    kind: mode === 'real' ? 'real' : 'fixture',
    created_at: new Date().toISOString(),
    base_sha256: baseSha,
    secret_scan: { clean: true, hits: 0 },
    boxes: Object.fromEntries(
      Object.entries(files).map(([box, file]) => [box, { file, sha256_before_promotion: sha256File(file), notes: boxNotes(box).length }]),
    ),
    promotions: promotions.map((item) => ({
      box: item.box,
      task: item.task,
      role: item.role,
      from: item.from,
      project_id: item.project_id,
      memory_id: item.memory_id,
      promoted_id: item.promoted_id,
      content_sha256: item.content_sha256,
      db: item.db,
      command: item.command,
    })),
  };
  write(path.join(workDir, MANIFEST), manifest);
  return { ok: true, manifest };
}

/**
 * FIXTURE ONLY: the rehearsal promotes through the operator API. In real mode this function is never called and refuses to run:
 * the owner promotes in his own terminal with `hseos memory promote`. It is the ONLY place of this script that calls the promote method of the operator memory.
 */
function promoteViaApi({ root, manifest, mode }) {
  if (mode !== 'fixture' || manifest.kind !== 'fixture')
    throw new TypeError('promotion through the API exists only for the fixture rehearsal');
  const { openOperatorMemory } = require(path.join(root, 'tools/cli/lib/memory-context-source'));
  const done = [];
  for (const box of ['B', 'C']) {
    const operatorMemory = openOperatorMemory({ databasePath: manifest.boxes[box].file, operator: { kind: 'operator', id: OPERATOR } });
    try {
      for (const item of manifest.promotions.filter((entry) => entry.box === box)) {
        const receipt = operatorMemory.promote({
          project_id: item.project_id,
          memory_id: item.memory_id,
          content_sha256: item.content_sha256,
          reason: 'F14 v4 rehearsal: promoted through the operator API (fixture mode only)',
        });
        done.push(receipt.memory_id);
      }
    } finally {
      operatorMemory.close();
    }
  }
  return done;
}

const inspect = (operatorMemory, projectId, memoryId) => {
  try {
    return operatorMemory.inspect(projectId, memoryId);
  } catch {
    return null;
  }
};

/**
 * Opens every box and checks the 6 promotions: the promoted entry is active, trusted, of operator origin, with the expected
 * content sha256 and promoted by the operator `owner`; the control box (A) must hold the notes still untrusted. Any divergence is a problem
 * and the caller answers BLOCKED. Returns { ok, problems, promotions }.
 */
function verifyPromotions({ root, Database, manifest }) {
  const problems = [];
  const promotions = [];
  // The expectations come from the CODE (TASKS), never from the manifest: ids, projects and sha256 below are what the notes must be.
  // The manifest can only CONFIRM them; any divergence (an old or edited manifest) is a problem.
  const expected = expectedPromotions(Object.fromEntries(['A', 'B', 'C'].map((box) => [box, manifest.boxes?.[box]?.file])));
  const listed = Array.isArray(manifest.promotions) ? manifest.promotions : [];
  if (listed.length !== expected.length) problems.push('manifest-diverges:promotion-count');
  for (const item of expected) {
    const entry = listed.find(
      (candidate) => candidate.box === item.box && candidate.project_id === item.project_id && candidate.memory_id === item.memory_id,
    );
    if (!entry || entry.promoted_id !== item.promoted_id || entry.content_sha256 !== item.content_sha256)
      problems.push(`manifest-diverges:box-${item.box}:${item.project_id}/${item.memory_id}`);
  }
  // The control box is never touched after the preparation: its bytes must still be the ones recorded.
  const controlFile = manifest.boxes?.A?.file;
  if (typeof controlFile === 'string' && fs.existsSync(controlFile) && manifest.boxes.A.sha256_before_promotion !== sha256File(controlFile))
    problems.push('control-box-changed');
  const { openOperatorMemory } = require(path.join(root, 'tools/cli/lib/memory-context-source'));
  const { ExecutionEventLedger } = require(path.join(root, 'tools/mcp-project-state/lib/execution-event-ledger'));
  const open = (box) => {
    const file = manifest.boxes?.[box]?.file;
    if (typeof file !== 'string' || !fs.existsSync(file)) {
      problems.push(`db-missing:box-${box}`);
      return null;
    }
    try {
      return openOperatorMemory({ databasePath: file, operator: { kind: 'operator', id: OPERATOR } });
    } catch {
      problems.push(`db-unreadable:box-${box}`);
      return null;
    }
  };
  const promotedBy = (file, projectId, promotedId) => {
    const handle = new Database(file, { readonly: true });
    try {
      const events = new ExecutionEventLedger(handle).readStream('agent_memory', projectId);
      const found = events.find((event) => event.payload?.memory_id === promotedId && event.payload?.promotion);
      return found?.payload.promotion.promoted_by ?? null;
    } catch {
      return null;
    } finally {
      handle.close();
    }
  };
  // Box A (control): the own notes exist, are agent memory and were NOT promoted.
  const boxA = open('A');
  if (boxA) {
    try {
      for (const note of boxNotes('A')) {
        const own = inspect(boxA, note.project_id, note.memory_id);
        if (!own) problems.push(`control-note-missing:${note.project_id}/${note.memory_id}`);
        else if (own.trust === 'trusted' || own.origin !== 'agent' || own.status !== 'active')
          problems.push(`control-note-altered:${note.project_id}/${note.memory_id}`);
        else if (own.content_sha256 !== sha(note.content)) problems.push(`control-note-content:${note.project_id}/${note.memory_id}`);
        if (inspect(boxA, note.project_id, `${note.memory_id}:promoted`))
          problems.push(`control-note-promoted:${note.project_id}/${note.memory_id}`);
      }
    } finally {
      boxA.close();
    }
  }
  for (const box of ['B', 'C']) {
    const operatorMemory = open(box);
    if (!operatorMemory) continue;
    try {
      for (const item of expected.filter((entry) => entry.box === box)) {
        const label = `${item.project_id}/${item.memory_id}`;
        const shown = inspect(operatorMemory, item.project_id, item.promoted_id);
        if (!shown) {
          problems.push(`not-promoted:box-${box}:${label}`);
          continue;
        }
        const operator = promotedBy(manifest.boxes[box].file, item.project_id, item.promoted_id);
        const row = {
          box,
          task: item.task,
          project_id: item.project_id,
          memory_id: item.memory_id,
          promoted_as: item.promoted_id,
          content_sha256: shown.content_sha256,
          operator,
        };
        promotions.push(row);
        if (shown.trust !== 'trusted' || shown.origin !== 'operator' || shown.status !== 'active')
          problems.push(`not-trusted:box-${box}:${label}`);
        if (shown.content_sha256 !== item.content_sha256) problems.push(`sha-mismatch:box-${box}:${label}`);
        if (operator !== OPERATOR) problems.push(`operator-not-${OPERATOR}:box-${box}:${label}`);
        const original = inspect(operatorMemory, item.project_id, item.memory_id);
        if (!original || original.status !== 'superseded') problems.push(`original-not-superseded:box-${box}:${label}`);
        else if (original.content_sha256 !== item.content_sha256) problems.push(`original-content:box-${box}:${label}`);
      }
    } finally {
      operatorMemory.close();
    }
  }
  const delivery = deliveryCheck({ root, Database, manifest, problems });
  return { ok: problems.length === 0, problems, promotions, delivery };
}

/**
 * Delivery check, run through the product's own retrieval: the agent retrieves memory with the REQUIREMENT of the task as the query
 * (lexical match, trusted entries only), so a promoted note that shares no term with the requirement never reaches the context. For
 * each task and each box this opens the box read-only, exactly as `source_db` does, and requires: box A (control) delivers nothing;
 * box B delivers the promoted own note; box C delivers the promoted placebo note. A note that cannot be delivered is a problem
 * (`not-deliverable`): the run would silently be a control, so the campaign is BLOCKED before any call.
 */
function deliveryCheck({ root, Database, manifest, problems }) {
  const { createGovernedMemory } = require(path.join(root, 'tools/cli/lib/memory-context-source'));
  const { ExecutionEventLedger } = require(path.join(root, 'tools/mcp-project-state/lib/execution-event-ledger'));
  const { taskMemoryQuery } = require(path.join(root, 'tools/cli/lib/engineering-task-extensions'));
  const report = [];
  for (const box of ['A', 'B', 'C']) {
    const file = manifest.boxes?.[box]?.file;
    if (typeof file !== 'string' || !fs.existsSync(file)) continue;
    let handle;
    try {
      handle = new Database(file, { readonly: true, fileMustExist: true });
      const store = createGovernedMemory({ ledger: new ExecutionEventLedger(handle), db: handle });
      for (const task of TASKS) {
        const query = taskMemoryQuery({ requirements: [{ description: task.requirement }] });
        const sources = store.retrieve({ project_id: task.project_id, query, limit: 5, include_untrusted: false }, { boundary: 'context' });
        const refs = sources.map((item) => item.source_ref);
        const memoryId = box === 'C' ? task.placebo_memory_id : task.memory_id;
        const expected = box === 'A' ? [] : [`memory://${task.project_id}/${memoryId}:promoted`];
        const delivered = expected.length === refs.length && expected.every((ref) => refs.includes(ref));
        report.push({ box, task: task.id, expected, delivered: refs, ok: delivered });
        if (!delivered) problems.push(`${box === 'A' ? 'control-note-delivered' : 'not-deliverable'}:box-${box}:${task.project_id}`);
      }
    } catch {
      problems.push(`delivery-check-failed:box-${box}`);
    } finally {
      handle?.close();
    }
  }
  return report;
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

/** Informative only (outside the confirmation hash): the commit the run was made from. */
function gitHead(root) {
  const run = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10_000 });
  return run.status === 0 ? run.stdout.trim() : null;
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

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function findProofObject(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.provider_proof && typeof value.provider_proof === 'object') return value.provider_proof;
  for (const child of Object.values(value)) {
    const found = findProofObject(child);
    if (found) return found;
  }
  return null;
}

/** The public form of the proof: everything except the credential hash, which stays out of the receipt. */
function publicProof(evidence) {
  const proof = findProofObject(evidence);
  if (!proof) return { proof_present: false };
  const { credential_sha256: credential, ...rest } = proof;
  return { proof_present: true, proof: { ...rest, credential_sha256_present: typeof credential === 'string' && credential.length === 64 } };
}

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
  const scratch = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-run-'));
  const cleanups = [];
  try {
    const f = fixture({ after: (fn) => cleanups.push(fn) }, { files: { [task.file]: task.stub }, entry: task.file });
    // The base contract is the addition example: its source and acceptance text are replaced by the task's OWN, so nothing
    // about integer addition reaches the model. The product is not touched.
    f.contract.task_id = `f14v4-${task.id}`;
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
    const dbPath = boxes[BOXES[condition]];
    const configFile = path.join(scratch, 'config.yaml');
    fs.writeFileSync(configFile, `environment:\n  project_id: ${task.project_id}\n  memory:\n    rules: []\n    source_db: ${dbPath}\n`);
    const bindingFile = path.join(scratch, 'binding.yaml');
    fs.writeFileSync(bindingFile, bindingYaml(mode === 'real' ? `${PLAN.binding.origin}/v1` : 'https://mock.invalid/v1', model));
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
      F14V4_MODE: mode,
      C9_DIR: runDir,
      C9_MAX_REQUESTS: String(PLAN.budget.max_requests_per_run),
      F14V4_PRICE_IN: String(ctx.price.in),
      F14V4_PRICE_OUT: String(ctx.price.out),
      F14V4_CEILING_USD: String(ctx.ceilingUsd),
      F14V4_SPENT_USD: String(ctx.spent),
      F14V4_PRIOR_SPEND_USD: String(ctx.priorSpendUsd),
      ...(mode === 'fixture' && process.env.F14V4_MOCK_FAULT ? { F14V4_MOCK_FAULT: process.env.F14V4_MOCK_FAULT } : {}),
      C9_DEADLINE_MS: String(Math.min(Date.now() + 15 * 60_000, ctx.deadlineMs)),
      ...(ctx.offline || process.env.F14V4_OFFLINE === '1' ? { F14V4_OFFLINE: '1' } : {}),
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
      box: BOXES[condition],
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
        `${JSON.stringify({ n: cut.n, interrupted: true, usage: null, cost_usd: interruptedCallUsd(cut.max_tokens, prices), cost_usd_no_cache: interruptedCallUsd(cut.max_tokens, prices), basis: 'declared context window as input plus max_tokens as output' })}\n`,
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
    // cost_usd (with the published cache discount) is the base of the ceiling gate; cost_usd_no_cache is the old base, kept visible.
    record.cost_usd = lines.reduce((sum, line) => sum + (line.cost_usd || 0), 0);
    record.cost_usd_no_cache = lines.reduce((sum, line) => sum + (line.cost_usd_no_cache ?? line.cost_usd ?? 0), 0);
    record.cost_basis = PLAN.budget.cost_basis;
    // The cap is a datum of its own: the run is marked and counted apart; nothing of the adapter proof is rewritten.
    record.cap_reached = Boolean(capReached);
    if (capReached) record.cap = { made: capReached.made, max: capReached.max };
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
        // The final source is rebuilt from the successful write/patch calls of the ledger (see stab3-f14v3/measure.cjs).
        const rebuilt = reconstructFinalSource(events, task.stub, task.file);
        finalSource = rebuilt.source;
        record.measure = { reason: rebuilt.reason, applied: rebuilt.applied, sha_checked: rebuilt.sha_checked };
        const invocations = Object.values(replayed.tool_invocations || {});
        record.replay = {
          ok: true,
          session_events: events.length,
          tool_invocations: invocations.length,
          // The context the model received must carry nothing of the addition example.
          contract_residue: /integer addition|positive, negative and zero|addIntegers/i.test(JSON.stringify(assembled?.payload ?? '')),
          // The note of the OWN task is in the context (box B only); the placebo note is the one of another task (box C only).
          note_in_context: blocks.some((block) => block.includes(task.note)),
          placebo_in_context: blocks.some((block) => block.includes(task.placebo_note)),
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
      // The proof is read as the adapter wrote it, with NO adjustment: a run that hit the cap keeps the original requests_total.
      const proof = summarizeProviderProof(evidenceJson);
      record.provider_proof = {
        verdict: proof.verdict,
        failures: proof.failures,
        summarizer_exit: proofRun.status,
        ...(record.cap_reached ? { marker: 'cap-reached' } : {}),
        ...publicProof(evidenceJson),
      };
      record.proof_independent_checks = countIndependentProofChecks(findProofObject(evidenceJson), {
        model: PLAN.model,
        origin: ctx.declaredOrigin,
      });
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
    // Primary outcome: protected tests pass on the rebuilt final file AND the product verifier approves. Hitting the cap is
    // recorded above as its own datum (cap_reached) and does not rewrite task_result, reason or the outcome.
    record.product_verifier_approved = record.task_result === 'approved';
    record.success = record.protected.pass && record.product_verifier_approved;
    write(path.join(runDir, 'result.json'), record);
    return record;
  } finally {
    for (const fn of cleanups.toReversed()) fn();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

const mean = (values) => (values.length === 0 ? null : Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)));

const summarizeArm = (rows) => ({
  runs: rows.length,
  successes: rows.filter((item) => item.success).length,
  requests_per_run: rows.map((item) => item.usage?.requests ?? null),
  requests_mean: mean(rows.map((item) => item.usage?.requests).filter((value) => Number.isFinite(value))),
  cap_reached: rows.filter((item) => item.cap_reached === true).length,
  note_in_context: rows.filter((item) => item.replay?.note_in_context === true).length,
  placebo_in_context: rows.filter((item) => item.replay?.placebo_in_context === true).length,
  memory_sources_total: rows.reduce((sum, item) => sum + (item.replay?.memory_sources?.length ?? 0), 0),
});

/** Informative measures per arm (and per task and arm): requests per run, runs that hit the cap, note_in_context. */
function armReport(records) {
  const series = records.filter((item) => item.kind === 'series');
  const out = { by_arm: {}, by_task_and_arm: {} };
  for (const condition of Object.keys(BOXES)) {
    out.by_arm[condition] = summarizeArm(series.filter((item) => item.condition === condition));
    for (const task of TASKS)
      out.by_task_and_arm[`${task.id}/${condition}`] = summarizeArm(
        series.filter((item) => item.task === task.id && item.condition === condition),
      );
  }
  return out;
}

function analyse(records) {
  const series = records.filter((item) => item.kind === 'series');
  const cell = (taskId, condition) => {
    const rows = series.filter((item) => item.task === taskId && item.condition === condition);
    return { n: rows.length, successes: rows.filter((item) => item.success).length };
  };
  const tasks = TASKS.map((task) => ({ id: task.id, promoted: cell(task.id, 'promoted'), control: cell(task.id, 'control') }));
  const placebo = TASKS.map((task) => ({ id: task.id, ...cell(task.id, 'placebo') }));
  const complete =
    tasks.every((item) => item.promoted.n === PLAN.n_per_task.promoted && item.control.n === PLAN.n_per_task.control) &&
    placebo.every((item) => item.n === PLAN.n_per_task.placebo);
  const extra = {
    placebo_descriptive: placebo.map((item) => ({ id: item.id, placebo: `${item.successes}/${item.n}` })),
    ...armReport(records),
  };
  return complete
    ? { complete, ...evaluateCriterion(tasks), ...extra }
    : { complete, success: false, reason: 'series-incomplete', per_task: tasks, ...extra };
}

/** True when an ancestor process is the `heavy-run` wrapper: the campaign must not run inside it (it is pinned and queued). */
function heavyRunStatus(readProc = (file) => fs.readFileSync(file, 'utf8'), startPid = process.ppid) {
  let pid = startPid;
  for (let depth = 0; depth < 12 && pid > 1; depth += 1) {
    try {
      const cmdline = readProc(`/proc/${pid}/cmdline`).replaceAll('\0', ' ');
      if (/(^|[\s/])heavy-run(\s|$)/.test(cmdline)) return 'wrapped';
      const stat = readProc(`/proc/${pid}/stat`);
      pid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      if (!Number.isInteger(pid)) return 'unknown';
    } catch {
      return 'unknown';
    }
  }
  return pid > 1 ? 'unknown' : 'clear';
}

/** Compatibility form: true only when the wrapper was positively found. The real mode uses heavyRunStatus and fails closed. */
function wrappedInHeavyRun(readProc, startPid) {
  return heavyRunStatus(readProc, startPid) === 'wrapped';
}

const underTmp = (dir) => {
  const base = path.resolve(tmpBase());
  const target = path.resolve(dir);
  return target === base || target.startsWith(`${base}${path.sep}`);
};

function requireAbsoluteRoot(args) {
  if (!args.root || !path.isAbsolute(args.root)) {
    process.stderr.write('usage: --root must be an ABSOLUTE path of the repository root\n');
    return false;
  }
  return true;
}

function printPromotionCommands(manifest, dir) {
  const lines = [
    `prepared directory (under $TMPDIR, removed when the campaign ends): ${dir}`,
    `kind: ${manifest.kind}; base database sha256: ${manifest.base_sha256}`,
    '',
    'Run these 6 commands in YOUR OWN terminal (each shows the content and the sha256 and asks for confirmation; compare the text with',
    'the note of docs/evolution/w3/stab2/F14-V4-PROTOCOL.md section 3; the placebo notes of box C are the notes of ANOTHER task):',
    '',
    ...manifest.promotions.map(
      (item) => `# box ${item.box}, ${item.role} note of ${item.from}, sha256 ${item.content_sha256}\n${item.command}\n`,
    ),
    `Then: node ${__filename} verify-promotions --root <abs repo> --prepared ${dir}`,
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function prepareCommand(args) {
  if (!requireAbsoluteRoot(args) || !['real', 'fixture'].includes(args.mode) || !args['source-db']) {
    process.stderr.write('usage: prepare --root <abs> --mode real|fixture --source-db <db> [--work-dir <dir under $TMPDIR>]\n');
    return EXIT.usage;
  }
  const workDir = args['work-dir']
    ? path.resolve(args['work-dir'])
    : path.join(tmpBase(), `f14v4-prepared-${randomBytes(6).toString('hex')}`);
  if (!underTmp(workDir) || (fs.existsSync(workDir) && fs.readdirSync(workDir).length > 0)) {
    process.stderr.write('--work-dir must be a new or empty directory under $TMPDIR\n');
    return EXIT.usage;
  }
  const root = args.root;
  const prepared = await prepareBoxes({
    root,
    Database: loadDatabase(root),
    source: path.resolve(args['source-db']),
    workDir,
    mode: args.mode,
  });
  if (!prepared.ok) {
    fs.rmSync(workDir, { recursive: true, force: true });
    process.stderr.write('BLOCKED: secret scan of the database copy found hits; the database was not used\n');
    return EXIT.secrets;
  }
  printPromotionCommands(prepared.manifest, workDir);
  return EXIT.ok;
}

function loadManifest(prepared) {
  const file = path.join(path.resolve(prepared), MANIFEST);
  return fs.existsSync(file) ? safeParse(fs.readFileSync(file, 'utf8')) : null;
}

async function verifyCommand(args) {
  if (!requireAbsoluteRoot(args) || !args.prepared) {
    process.stderr.write('usage: verify-promotions --root <abs> --prepared <dir>\n');
    return EXIT.usage;
  }
  const manifest = loadManifest(args.prepared);
  if (!manifest) {
    process.stdout.write(
      `${JSON.stringify({ ok: false, verdict: 'BLOCKED: prepared directory or manifest missing', problems: ['manifest-missing'] })}\n`,
    );
    return EXIT.blocked;
  }
  const result = verifyPromotions({ root: args.root, Database: loadDatabase(args.root), manifest });
  process.stdout.write(
    `${JSON.stringify({ ok: result.ok, verdict: result.ok ? 'PROMOTIONS VERIFIED' : 'BLOCKED: promotions not verified', problems: result.problems, promotions: result.promotions, delivery: result.delivery }, null, 2)}\n`,
  );
  return result.ok ? EXIT.ok : EXIT.blocked;
}

async function campaign(args) {
  const mode = args.mode;
  if (!requireAbsoluteRoot(args) || !['fixture', 'real'].includes(mode) || !args.out) {
    process.stderr.write(
      'usage: campaign --root <abs> --mode fixture|real --out <dir> (fixture: --source-db <db>; real: --prepared <dir>)\n',
    );
    return EXIT.usage;
  }
  if (mode === 'fixture' ? !args['source-db'] : !args.prepared) {
    process.stderr.write(
      mode === 'fixture' ? 'fixture mode needs --source-db <db>\n' : 'real mode needs --prepared <dir> (see the prepare command)\n',
    );
    return EXIT.usage;
  }
  const root = path.resolve(args.root);
  if (mode === 'real' && process.env.F14V4_REAL_CONFIRMED !== confirmationHash({ root })) {
    process.stderr.write(
      'BLOCKED: real mode needs F14V4_REAL_CONFIRMED equal to the hash printed by --print-confirmation; nothing was started\n',
    );
    return EXIT.blocked;
  }
  const Database = loadDatabase(root);
  const model = PLAN.model;
  let price;
  if (mode === 'real') {
    const checked = validateRealPrice(Number(args['price-in']), Number(args['price-out']));
    if (!checked.ok) {
      process.stderr.write(`${checked.reason}\n`);
      return EXIT.usage;
    }
    price = checked.price;
    const credit = Number(args['credit-usd']);
    if (!(Number.isFinite(credit) && credit >= PLAN.budget.ceiling_usd)) {
      process.stderr.write(
        `BLOCKED: --credit-usd (the credit read from the console) must be a number >= ${PLAN.budget.ceiling_usd}; nothing was started\n`,
      );
      return EXIT.blocked;
    }
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
  const keyEnv = 'F14V4_OPENAI_API_KEY';
  let key;
  if (mode === 'real') {
    key = process.env[keyEnv];
    if (!key) {
      process.stderr.write(`real mode needs the key in the environment variable ${keyEnv}\n`);
      return EXIT.usage;
    }
    for (const rehearsalOnly of ['ceiling', 'prior-spend', 'seed', 'source-db', 'run-timeout-ms', 'wall-clock-minutes']) {
      if (args[rehearsalOnly] !== undefined) {
        process.stderr.write(`--${rehearsalOnly} is only for the rehearsal: the real values come from PLAN.json\n`);
        return EXIT.usage;
      }
    }
  } else {
    key = `fake-${randomBytes(18).toString('hex')}`;
  }
  const heavy = mode === 'real' ? heavyRunStatus() : 'clear';
  if (heavy === 'unknown') {
    process.stderr.write(
      'BLOCKED: the process ancestry could not be read, so the absence of heavy-run is not verified; nothing was started\n',
    );
    return EXIT.blocked;
  }
  if (heavy === 'wrapped') {
    process.stderr.write(
      'BLOCKED: the real campaign must not run inside heavy-run (the wrapper pins and queues it); nothing was started\n',
    );
    return EXIT.blocked;
  }
  const out = path.resolve(args.out);
  const work = fs.mkdtempSync(path.join(tmpBase(), 'f14v4-campaign-'));
  const result = {
    confirmation_sha256: confirmationHash({ root }),
    git_head: gitHead(root),
    product_files_sha256: productFileHashes(root),
    mode,
    evidence_kind: mode === 'real' ? 'real' : 'fixture-rehearsal',
    model,
    started_at: new Date().toISOString(),
  };
  let preparedDir = mode === 'real' ? path.resolve(args.prepared) : path.join(work, 'prepared');
  let removePrepared = mode !== 'real';
  try {
    fs.mkdirSync(path.join(out, 'runs'), { recursive: true, mode: 0o700 });
    // 1. boxes: fixture builds them and promotes through the API; real only READS the ones the owner promoted
    let manifest;
    if (mode === 'fixture') {
      const prepared = await prepareBoxes({
        root,
        Database,
        source: path.resolve(args['source-db']),
        workDir: preparedDir,
        mode,
        literals: [key],
      });
      result.database = {
        kind: 'fixture-copy',
        sha256: prepared.manifest?.base_sha256 ?? prepared.base_sha256,
        secret_scan: prepared.ok ? prepared.manifest.secret_scan : prepared.scan,
        in_repository: false,
      };
      if (!prepared.ok) {
        result.verdict = 'BLOCKED: secret scan of the database copy found hits; the database was not used';
        write(path.join(out, 'campaign.json'), result);
        return EXIT.secrets;
      }
      manifest = prepared.manifest;
      promoteViaApi({ root, manifest, mode });
      result.promotion_method = 'api-rehearsal';
    } else {
      manifest = loadManifest(preparedDir);
      if (!manifest || manifest.kind !== 'real') {
        result.verdict = 'BLOCKED: prepared directory missing, unreadable or not prepared in real mode';
        write(path.join(out, 'campaign.json'), result);
        process.stderr.write(`${result.verdict}\n`);
        return EXIT.blocked;
      }
      result.database = { kind: 'real', sha256: manifest.base_sha256, secret_scan: manifest.secret_scan, in_repository: false };
    }
    const verified = verifyPromotions({ root, Database, manifest });
    if (!verified.ok) {
      // The prepared boxes stay where they are: the owner may still have promotions to make.
      removePrepared = false;
      result.verdict = 'BLOCKED: promotions not verified';
      result.promotion_problems = verified.problems;
      write(path.join(out, 'campaign.json'), result);
      process.stderr.write(`BLOCKED: promotions not verified (${verified.problems.join(', ')}); nothing was started\n`);
      return EXIT.blocked;
    }
    removePrepared = true;
    // `owner-terminal` is recorded only here, AFTER the verification above succeeded.
    if (mode === 'real') result.promotion_method = 'owner-terminal';
    const boxFiles = { A: manifest.boxes.A.file, B: manifest.boxes.B.file, C: manifest.boxes.C.file };
    // The boxes must not carry the key either (scan before the first call).
    for (const [box, file] of Object.entries(boxFiles)) {
      const scan = scanFile(file, { literals: [key] });
      if (!scan.clean) {
        result.verdict = `BLOCKED: secret scan of box ${box} found hits; nothing was started`;
        write(path.join(out, 'campaign.json'), result);
        return EXIT.secrets;
      }
    }
    result.boxes = {
      notes: TASKS.map((task) => ({
        task: task.id,
        memory_id: task.memory_id,
        content_sha256: sha(task.note),
        placebo_memory_id: task.placebo_memory_id,
        placebo_of: task.placebo_of,
        placebo_content_sha256: sha(task.placebo_note),
      })),
      promotion_method: result.promotion_method,
      promotions: verified.promotions,
      delivery_check: verified.delivery,
      db_sha256: { box_a: sha256File(boxFiles.A), box_b: sha256File(boxFiles.B), box_c: sha256File(boxFiles.C) },
    };
    if (mode === 'real') {
      result.credit_declared_usd = Number(args['credit-usd']);
      result.credit_usd = result.credit_declared_usd;
      result.effective_ceiling_usd = effectiveCeilingUsd(result.credit_usd);
    }
    // 2. seed, recorded BEFORE the first call
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
    // Cumulative ceiling: the prior spend is 0 (new campaign). The rehearsal can set it (--prior-spend).
    let priorSpendUsd = PLAN.budget.prior_spend_usd;
    if (mode !== 'real' && args['prior-spend'] !== undefined) priorSpendUsd = Number(args['prior-spend']);
    const ceilingUsd = campaignCeilingUsd({ mode, credit_usd: result.credit_usd, ceiling_arg: args.ceiling });
    const wallMinutes = mode !== 'real' && args['wall-clock-minutes'] ? Number(args['wall-clock-minutes']) : PLAN.budget.wall_clock_minutes;
    const startedMs = Date.now();
    const deadlineMs = startedMs + wallMinutes * 60_000;
    const ctx = {
      root,
      mode,
      key,
      work,
      runsDir: path.join(out, 'runs'),
      Database,
      boxes: boxFiles,
      model,
      price,
      offline: mode === 'fixture',
      evidenceKind: result.evidence_kind,
      declaredOrigin: mode === 'real' ? PLAN.binding.origin : 'https://mock.invalid',
      ceilingUsd,
      deadlineMs,
      runTimeoutMs: mode === 'fixture' && args['run-timeout-ms'] ? Number(args['run-timeout-ms']) : 280_000,
      spent: 0,
      priorSpendUsd,
    };
    const records = [];
    let spent = 0;
    let spentNoCache = 0;
    const gate = () => {
      if (Date.now() >= deadlineMs) {
        result.stopped = { reason: 'time limit', wall_clock_minutes: wallMinutes, runs_done: records.length };
        return false;
      }
      const decision = cumulativeDecision({ priorUsd: priorSpendUsd, spentUsd: spent, ceilingUsd });
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
    // A protocol failure (control-provider refusal or an adapter proof that is not pass) ends the campaign at once: the same
    // failure must never be paid for twice. A run that hit the request cap keeps its ORIGINAL proof (never rewritten) and is not
    // judged on the request count: only the checks that do not depend on it decide (model, origin, no pool, no fallback, credential
    // source). Any other run whose proof is not pass stops the campaign.
    const protocolFailure = (record) => {
      if (record.stop_reason) return null;
      if (record.cap_reached) {
        const checks = record.proof_independent_checks;
        return checks?.ok === true ? null : `cap-reached-proof-checks:${(checks?.failures ?? ['absent']).join('+')}`;
      }
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
      // A request cut by the timeout (interrupted, no response, no proof) stops the campaign at the FIRST occurrence, after it was
      // charged at the pessimistic cost. This differs from v3, which left the decision to the owner.
      if (!['usage-unreadable', 'ceiling-projection', 'interrupted-timeout'].includes(record.stop_reason)) return false;
      result.stopped = {
        reason: { 'ceiling-projection': 'cumulative ceiling', 'interrupted-timeout': 'timeout' }[record.stop_reason] ?? record.stop_reason,
        ...(record.stop_reason === 'ceiling-projection' ? { detail: 'ceiling-projection' } : {}),
        after_run: record.label,
        runs_done: records.length,
        ...(record.refusal ? { refusal: record.refusal } : {}),
      };
      return true;
    };
    // 3. pilots: control, one per task
    for (const task of TASKS) {
      if (!gate()) break;
      ctx.spent = spent;
      const record = await runOne(ctx, task, 'control', `pilot-${task.id}`, 'pilot');
      spent += record.cost_usd;
      spentNoCache += record.cost_usd_no_cache;
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
        spentNoCache += record.cost_usd_no_cache;
        records.push(record);
        if (halted(record)) break;
      }
    }
    // 4. analysis and measures
    const series = records.filter((item) => item.kind === 'series');
    result.analysis = analyse(records);
    result.runs = records.map((record) => ({ ...record, stderr_head: undefined }));
    const capRuns = records.filter((item) => item.cap_reached === true);
    result.totals = {
      runs: records.length,
      series_runs: series.length,
      cost_usd_estimate: spent,
      cost_usd: spent,
      cost_usd_no_cache: spentNoCache,
      cost_basis: PLAN.budget.cost_basis,
      cached_tokens: records.reduce((sum, item) => sum + item.usage.cached_tokens, 0),
      effective_ceiling_usd: ceilingUsd,
      prior_spend_usd: priorSpendUsd,
      cumulative_cost_usd: priorSpendUsd + spent,
      requests: records.reduce((sum, item) => sum + item.usage.requests, 0),
      prompt_tokens: records.reduce((sum, item) => sum + item.usage.prompt_tokens, 0),
      completion_tokens: records.reduce((sum, item) => sum + item.usage.completion_tokens, 0),
      price_declared_usd_per_million: price,
      adapter_proof_pass: records.filter((item) => item.provider_proof?.verdict === 'pass' && item.cap_reached !== true).length,
      cap_reached_runs: capRuns.length,
      cap_reached_labels: capRuns.map((item) => item.label),
    };
    const issues = [];
    for (const item of records) {
      if (!item.usage.complete) issues.push(`${item.label}: usage-incomplete`);
      if (item.cap_reached) {
        // Not counted as "proof pass"; only the checks that do not depend on the count must hold.
        if (item.proof_independent_checks?.ok !== true) issues.push(`${item.label}: cap-reached-proof-checks`);
      } else if (item.provider_proof?.verdict !== 'pass')
        issues.push(`${item.label}: provider-proof-${item.provider_proof?.verdict ?? 'absent'}`);
      if (!item.replay?.ok) issues.push(`${item.label}: replay-failed`);
      if (item.replay?.contract_residue !== false) issues.push(`${item.label}: contract-residue`);
      if (['sha-mismatch', 'patch-failed', 'unknown-tool-format'].includes(item.measure?.reason))
        issues.push(`${item.label}: meter-${item.measure.reason}`);
      if (item.drain?.orphans !== 0) issues.push(`${item.label}: drain-orphans`);
      if (!item.source_db_unchanged) issues.push(`${item.label}: source-db-changed`);
      const task = TASKS.find((candidate) => candidate.id === item.task);
      const expectedSources = item.condition === 'control' ? 0 : 1;
      const expectedRef = {
        promoted: `memory://${task.project_id}/${task.memory_id}:promoted`,
        placebo: `memory://${task.project_id}/${task.placebo_memory_id}:promoted`,
      }[item.condition];
      const source = item.replay?.memory_sources?.[0];
      const sourceOk = expectedSources === 0 || (source?.trust === 'trusted' && source?.source_ref === expectedRef);
      if (
        item.replay?.memory_sources?.length !== expectedSources ||
        item.replay?.note_in_context !== (item.condition === 'promoted') ||
        item.replay?.placebo_in_context !== (item.condition === 'placebo') ||
        !sourceOk
      )
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
        'The key exists only in the environment of the agent process (spawn env) and is not passed to agent evidence. Engineering tools run under bwrap --clearenv with an environment declared as not inherited. Read from the code, not measured in a run.',
      protected_comparison:
        'Protected cases compare with isDeepStrictEqual (key order of an object is irrelevant; undefined, NaN, -0 and the type are distinguished).',
      requests_per_run_cap: PLAN.budget.max_requests_per_run,
      cap_effect:
        'Hitting the cap is a datum apart (cap_reached, analysis.by_arm): the original adapter proof is kept untouched and the outcome is the protected tests on the rebuilt final file plus the product verifier.',
      ...PLAN.limits_declared,
      measures:
        'Does not measure usefulness in real work; one model, one provider, n = 5 per task and condition; "almost certain by construction" caveat of the protocol stands.',
    };
    result.finished_at = new Date().toISOString();
    write(path.join(out, 'campaign.json'), result);
    // 5. secret scan over every artifact, with the key as a literal
    const artifactScan = scanDirectory(out, { literals: [key] });
    result.artifact_scan = artifactScan;
    write(path.join(out, 'campaign.json'), result);
    process.stdout.write(
      `${JSON.stringify({ verdict: result.verdict, runs: records.length, cost_usd_estimate: Number(spent.toFixed(4)), p: result.analysis.p ?? null, protocol_issues: issues.length, cap_reached_runs: capRuns.length, artifact_scan_clean: artifactScan.clean })}\n`,
    );
    if (result.stopped?.reason === 'usage-unreadable') return EXIT.usage_unreadable;
    if (result.stopped) return EXIT.stopped;
    if (!artifactScan.clean || issues.length > 0) return EXIT.failed;
    if (result.verdict.startsWith('BLOCKED')) return EXIT.blocked;
    return mode === 'real' && !args.flags.has('pilots-only') && !result.analysis.success ? EXIT.failed : EXIT.ok;
  } finally {
    if (removePrepared) fs.rmSync(preparedDir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === '--print-confirmation' || command === 'print-confirmation') {
    const given = parseArgs(rest).root;
    process.stdout.write(`${confirmationHash(given ? { root: path.resolve(given) } : {})}\n`);
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
  if (command === 'prepare') return prepareCommand(parseArgs(rest));
  if (command === 'verify-promotions') return verifyCommand(parseArgs(rest));
  if (command === 'campaign') return campaign(parseArgs(rest));
  process.stderr.write('usage: f14v4.cjs plan | filter | --print-confirmation | prepare | verify-promotions | campaign ...\n');
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

module.exports = {
  analyse,
  armReport,
  publicProof,
  parseArgs,
  prepareBoxes,
  promoteViaApi,
  verifyPromotions,
  promotionCommand,
  expectedPromotions,
  boxNotes,
  wrappedInHeavyRun,
  heavyRunStatus,
  gitHead,
  EXIT,
};
