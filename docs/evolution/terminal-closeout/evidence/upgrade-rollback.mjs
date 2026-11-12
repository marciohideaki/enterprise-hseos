// Roteiro de upgrade, downgrade, schema 16 -> 17 e rollback sobre bancos de estado descartaveis.
// Cada pacote e instalado de um tarball num consumidor fora do checkout; nenhum project.db real e tocado.
// Uso: node upgrade-rollback.mjs --work <dir> --tgz-current <tgz> --tgz-s17 <tgz> --tgz-s16 <tgz> [--out <json>]
// A saida e um JSON com fatos copiados das ferramentas (hashes, user_version, codigos de erro, exit codes).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const need = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`missing --${name}`);
  return path.resolve(value);
};
const work = need('work');
const tgz = { current: need('tgz-current'), s17: need('tgz-s17'), s16: need('tgz-s16') };
const outFile = args.get('out') ? path.resolve(args.get('out')) : null;
fs.mkdirSync(work, { recursive: true });

const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = (cmd, argv, options = {}) => {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 300_000, ...options });
  return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
};
const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    return { unparsed: text.slice(0, 400), parse_error: error.message };
  }
};

function install(consumer, file) {
  fs.mkdirSync(consumer, { recursive: true });
  const manifest = path.join(consumer, 'package.json');
  if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }));
  const r = run('npm', ['install', '--offline', '--no-audit', '--no-fund', file], { cwd: consumer });
  if (r.rc !== 0) throw new Error(`npm install --offline failed rc=${r.rc}: ${r.stderr.slice(0, 400)}`);
  const pkg = JSON.parse(fs.readFileSync(path.join(consumer, 'node_modules', 'hseos', 'package.json'), 'utf8'));
  return { installed_version: pkg.version, tgz_sha256: sha256File(file) };
}

const hseos = (consumer) => path.join(consumer, 'node_modules', '.bin', 'hseos');

// Snippets executados com o Node dentro do consumidor, importando o pacote la instalado.
const PRELUDE = `
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.join(process.cwd(), 'node_modules', 'hseos', 'package.json'));
const input = JSON.parse(process.argv[1]);
const dbLib = req('./tools/mcp-project-state/lib/operational-state-db.js');
const out = (value) => process.stdout.write(JSON.stringify(value));
const codeOf = (error) => ({ code: error.code || null, message: String(error.message).slice(0, 240) });
`;
const APPEND = `
const Database = req('better-sqlite3');
const { randomUUID } = require('node:crypto');
const { ExecutionEventLedger } = req('./tools/mcp-project-state/lib/execution-event-ledger.js');
function appendEvents(dbPath, count, tag) {
  const db = new Database(dbPath);
  try {
    const ledger = new ExecutionEventLedger(db);
    const id = input.aggregate_id;
    for (let i = 0; i < count; i++) {
      const version = ledger.getVersion('control_task', id);
      const eventId = randomUUID();
      ledger.append({
        aggregate_type: 'control_task', aggregate_id: id, expected_version: version,
        events: [{
          event_id: eventId, event_type: 'ControlCommandRecorded', schema_version: 1,
          occurred_at: new Date().toISOString(), correlation_id: id, causation_id: id,
          actor: { type: 'hseos', id: 'upgrade-rollback' }, operation_id: null,
          payload: { kind: tag + '-' + i }, evidence_refs: [],
        }],
      });
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
    return ledger.getVersion('control_task', id);
  } finally {
    db.close();
  }
}
`;
const SNIPPETS = {
  activate: `${PRELUDE}${APPEND}
(async () => {
  if (!require('node:fs').existsSync(input.db)) dbLib.openOperationalStateDatabase(input.db).close();
  const internal = { decisionsDirectory: input.decisions };
  if (input.migrations) internal.migrationsDirectory = input.migrations;
  const receipt = await dbLib.activateExecutionLedger(input.db, { adr: 'ADR-0048', backupDir: input.backup_dir, internal });
  const version = input.events ? appendEvents(input.db, input.events, 'seed') : 0;
  out({ receipt: receipt.receipt, stream_version: version, mode: dbLib.resolveGovernedExecutionMode(input.db) });
})().catch((error) => { out({ error: codeOf(error) }); });
`,
  append: `${PRELUDE}${APPEND}
try {
  const mode = dbLib.resolveGovernedExecutionMode(input.db);
  const version = appendEvents(input.db, input.count, input.tag);
  out({ mode, stream_version: version });
} catch (error) { out({ error: codeOf(error) }); }
`,
  mode: `${PRELUDE}
try { out({ mode: dbLib.resolveGovernedExecutionMode(input.db) }); } catch (error) { out({ error: codeOf(error) }); }
`,
  open: `${PRELUDE}
try { dbLib.openOperationalStateDatabase(input.db).close(); out({ opened: true }); } catch (error) { out({ opened: false, error: codeOf(error) }); }
`,
  plan: `${PRELUDE}
try {
  const plan = dbLib.planExecutionLedgerActivation(input.db, { adr: 'ADR-0048', backupDir: input.backup_dir, internal: { decisionsDirectory: input.decisions } });
  out({ ready: plan.ready, blockers: plan.blockers.map((b) => b.code), user_version: plan.user_version });
} catch (error) { out({ error: codeOf(error) }); }
`,
};
const inConsumer = (consumer, name, payload) => {
  const r = run(process.execPath, ['-e', SNIPPETS[name], JSON.stringify(payload)], { cwd: consumer });
  return { rc: r.rc, ...parseJson(r.stdout || '{}'), ...(r.rc === 0 ? {} : { stderr: r.stderr.slice(0, 400) }) };
};

// Hash canonico dos eventos (ordem por posicao), calculado numa COPIA do arquivo para nao tocar no original.
function eventState(consumer, dbFile) {
  const copyDir = fs.mkdtempSync(path.join(work, 'copy-'));
  const copy = path.join(copyDir, 'copy.db');
  fs.copyFileSync(dbFile, copy);
  const code = `
    const path = require('node:path');
    const { createRequire } = require('node:module');
    const { createHash } = require('node:crypto');
    const req = createRequire(path.join(process.cwd(), 'node_modules', 'hseos', 'package.json'));
    const Database = req('better-sqlite3');
    const db = new Database(process.argv[1], { readonly: true });
    const userVersion = db.pragma('user_version', { simple: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'execution_events'").get();
    const rows = has ? db.prepare('SELECT position, event_id, event_type, aggregate_type, aggregate_id, stream_sequence, schema_version, occurred_at, correlation_id, causation_id, actor_json, operation_id, payload_json, evidence_refs_json FROM execution_events ORDER BY position').all() : [];
    const hashOf = (list) => createHash('sha256').update(JSON.stringify(list)).digest('hex');
    process.stdout.write(JSON.stringify({ user_version: userVersion, integrity_check: integrity, has_execution_events: Boolean(has), count: rows.length, ids: rows.map((r) => r.event_id), rows_hash: hashOf(rows), hashes: rows.map((r) => hashOf([r])) }));
  `;
  const r = run(process.execPath, ['-e', code, copy], { cwd: consumer });
  fs.rmSync(copyDir, { recursive: true, force: true });
  return parseJson(r.stdout || '{}');
}
const prefixUnchanged = (before, after) =>
  before.count <= after.count && before.hashes.every((h, i) => h === after.hashes[i]) && before.ids.every((id, i) => id === after.ids[i]);

const decisions = path.join(work, 'adr-fixture');
fs.mkdirSync(decisions, { recursive: true });
fs.writeFileSync(
  path.join(decisions, 'ADR-0048-governed-execution-activation-criterion.md'),
  '# ADR-0048 (FIXTURE do roteiro, nao e o ADR real)\n\n## Status\n\nAccepted - 2026-10-22\n',
);

const result = { schema: 'upgrade-rollback/1', scenarios: {} };

// ---- (a) mesmo schema 17: pacote da distribuicao global (s17) -> pacote desta revisao ----
{
  const consumer = path.join(work, 'consumer-a');
  const s = { packages: { s17: install(consumer, tgz.s17) } };
  const db = path.join(consumer, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  const aggregate_id = '11111111-1111-4111-8111-111111111111';
  s.activate_with_s17 = inConsumer(consumer, 'activate', {
    db,
    decisions,
    backup_dir: path.join(work, 'backups-a'),
    events: 3,
    aggregate_id,
  });
  const before = eventState(consumer, db);
  s.before = { ...before, ids: undefined, db_sha256: sha256File(db) };
  s.packages.current = install(consumer, tgz.current);
  s.mode_with_current = inConsumer(consumer, 'mode', { db });
  s.append_with_current = inConsumer(consumer, 'append', { db, count: 2, tag: 'after-upgrade', aggregate_id });
  const after = eventState(consumer, db);
  s.after = { ...after, ids: undefined };
  s.checks = {
    old_events_hash_unchanged: prefixUnchanged(before, after),
    only_appended: after.count - before.count,
    user_version_before: before.user_version,
    user_version_after: after.user_version,
    integrity_check_after: after.integrity_check,
  };
  // ---- (b) downgrade: pacote de schema 16 sobre o banco ja escrito pela revisao nova ----
  const b = { packages: { s16: install(consumer, tgz.s16) } };
  const shaBefore = sha256File(db);
  const sidecarsBefore = ['-wal', '-shm'].map((x) => fs.existsSync(db + x));
  b.open_with_s16 = inConsumer(consumer, 'open', { db });
  const cli = run(hseos(consumer), ['state-list'], { cwd: consumer, env: { ...process.env, HSEOS_STATE_DB: db } });
  b.cli_state_list_with_s16 = { rc: cli.rc, stderr: cli.stderr.slice(0, 300), stdout: cli.stdout.slice(0, 200) };
  const shaAfter = sha256File(db);
  const afterDowngrade = eventState(consumer, db);
  b.checks = {
    db_sha256_before: shaBefore,
    db_sha256_after: shaAfter,
    main_file_unchanged: shaBefore === shaAfter,
    sidecars_before: sidecarsBefore,
    sidecars_after: ['-wal', '-shm'].map((x) => fs.existsSync(db + x)),
    events_unchanged: prefixUnchanged(after, afterDowngrade) && afterDowngrade.count === after.count,
  };
  s.downgrade = b;
  result.scenarios.a_same_schema_and_b_downgrade = s;
}

// ---- (c) schema 16 -> 17 ----
{
  const consumer = path.join(work, 'consumer-c');
  const s = { packages: { s16: install(consumer, tgz.s16) } };
  const pendingDir = path.join(work, 's16-pending');
  fs.mkdirSync(pendingDir, { recursive: true });
  const tarRun = run('tar', [
    '-xzf',
    tgz.s16,
    '-C',
    pendingDir,
    '--strip-components=4',
    'package/tools/mcp-project-state/migrations-pending-activation',
  ]);
  s.extract_s16_migrations = { rc: tarRun.rc, files: fs.readdirSync(pendingDir).length };
  s.activation_code_in_s16_package = fs.existsSync(path.join(consumer, 'node_modules', 'hseos', 'tools', 'cli'))
    ? 'checked-by-grep'
    : 'no-cli-dir';
  const s16Lib = fs.readFileSync(
    path.join(consumer, 'node_modules', 'hseos', 'tools', 'mcp-project-state', 'lib', 'operational-state-db.js'),
    'utf8',
  );
  s.s16_package_exports_activation = /activateExecutionLedger/.test(s16Lib);
  s.packages.current = install(consumer, tgz.current);
  const db = path.join(consumer, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  const aggregate_id = '22222222-2222-4222-8222-222222222222';
  s.reconstruct_schema16_db = inConsumer(consumer, 'activate', {
    db,
    decisions,
    backup_dir: path.join(work, 'backups-c'),
    migrations: pendingDir,
    events: 3,
    aggregate_id,
  });
  const before = eventState(consumer, db);
  const shaBefore = sha256File(db);
  s.before = { ...before, ids: undefined, db_sha256: shaBefore };
  s.mode_with_current = inConsumer(consumer, 'mode', { db });
  s.plan_with_current = inConsumer(consumer, 'plan', { db, backup_dir: path.join(work, 'backups-c2'), decisions });
  s.append_with_current = inConsumer(consumer, 'append', { db, count: 1, tag: 'on-schema16', aggregate_id });
  const cliPlan = run(
    hseos(consumer),
    ['execution-activation', 'plan', '--db', db, '--adr', 'ADR-0048', '--backup-dir', path.join(work, 'backups-c3'), '--json'],
    { cwd: consumer },
  );
  s.cli_plan_with_current = { rc: cliPlan.rc, output: parseJson(cliPlan.stdout), stderr: cliPlan.stderr.slice(0, 300) };
  const after = eventState(consumer, db);
  s.checks = {
    db_sha256_after: sha256File(db),
    main_file_unchanged: sha256File(db) === shaBefore,
    events_unchanged: prefixUnchanged(before, after) && before.count === after.count,
    user_version_before: before.user_version,
    user_version_after: after.user_version,
  };
  result.scenarios.c_schema16_to_17 = s;
}

// ---- (d) rollback pelo mecanismo do produto ----
{
  const consumer = path.join(work, 'consumer-d');
  const s = { packages: { current: install(consumer, tgz.current) } };
  const db = path.join(consumer, '.hseos', 'state', 'project.db');
  fs.mkdirSync(path.dirname(db), { recursive: true });
  inConsumer(consumer, 'open', { db });
  const originalSha = sha256File(db);
  const aggregate_id = '33333333-3333-4333-8333-333333333333';
  const backupDir = path.join(work, 'backups-d');
  s.activate = inConsumer(consumer, 'activate', { db, decisions, backup_dir: backupDir, events: 2, aggregate_id });
  const activated = eventState(consumer, db);
  s.activated = { ...activated, ids: undefined };
  const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  const backupName = backups.find((f) => f.endsWith('.db'));
  const backupFile = backupName ? path.join(backupDir, backupName) : null;
  s.backup = { files: backups, backup_sha256: backupFile ? sha256File(backupFile) : null, original_sha256_before_activation: originalSha };
  if (backupFile) {
    const rb = run(
      hseos(consumer),
      ['execution-activation', 'rollback', '--db', db, '--backup', backupFile, '--expected-sha256', originalSha, '--json'],
      { cwd: consumer },
    );
    s.rollback_cli = { rc: rb.rc, output: parseJson(rb.stdout), stderr: rb.stderr.slice(0, 300) };
    const restored = eventState(consumer, db);
    const preserved = rb.stdout ? parseJson(rb.stdout).preserved_activated_path : null;
    if (preserved && fs.existsSync(preserved)) {
      const kept = eventState(consumer, preserved);
      s.preserved_activated_copy = {
        ...kept,
        ids: undefined,
        events_equal_to_activated: prefixUnchanged(activated, kept) && kept.count === activated.count,
      };
    }
    s.restored = { ...restored, ids: undefined, db_sha256: sha256File(db) };
    s.checks = {
      restored_sha256_equals_backup: sha256File(db) === s.backup.backup_sha256,
      restored_sha256_equals_original: sha256File(db) === originalSha,
      user_version_after: restored.user_version,
      execution_tables_present_after: restored.has_execution_events,
      note: 'o rollback restaura o banco pre-ativacao: eventos anexados apos a ativacao deixam de existir por desenho; o backup e o original nao sao alterados',
    };
  }
  result.scenarios.d_rollback = s;
}

const text = `${JSON.stringify(result, null, 2)}\n`;
if (outFile) fs.writeFileSync(outFile, text);
process.stdout.write(text);
