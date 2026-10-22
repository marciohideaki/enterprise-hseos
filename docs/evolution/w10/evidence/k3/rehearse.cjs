'use strict';
// K3: ensaio de ativacao + rollback sobre COPIA do project.db real. A origem e aberta somente para leitura.
// Uso: node rehearse.cjs <repo-do-worktree> <project.db-origem> <scratch-dir> <saida-dir> [normalized|wal-mode]
// normalized: a copia e convertida para journal_mode=delete (arquivo unico, hash estavel). wal-mode: a copia mantem o cabecalho WAL da origem.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [repo, source, scratch, outDir] = process.argv.slice(2, 6).map((p) => path.resolve(p));
const variant = process.argv[6] || 'normalized';
const Database = require(path.join(repo, 'node_modules', 'better-sqlite3'));
const lib = require(path.join(repo, 'tools', 'mcp-project-state', 'lib', 'operational-state-db.js'));

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fileFacts = (file) => {
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file);
  return { size: st.size, mtime: st.mtime.toISOString(), sha256: sha(file) };
};
const statNs = (file) => {
  if (!fs.existsSync(file)) return null;
  const st = fs.statSync(file, { bigint: true });
  return { size: Number(st.size), mtime_ns: String(st.mtimeNs) };
};
const redact = (text) => text.split(os.homedir()).join('~').split(repo).join('<worktree>');
const write = (name, value) =>
  fs.writeFileSync(path.join(outDir, name), redact(typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`));

function tableDigests(file) {
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((r) => r.name);
    const out = {};
    for (const t of tables) {
      const hash = crypto.createHash('sha256');
      let n = 0;
      const lines = [];
      for (const row of db.prepare(`SELECT * FROM "${t}"`).iterate()) lines.push(JSON.stringify(row));
      lines.sort();
      for (const line of lines) hash.update(`${line}\n`);
      n = lines.length;
      out[t] = { rows: n, sha256: hash.digest('hex') };
    }
    return {
      user_version: db.pragma('user_version', { simple: true }),
      application_id: db.pragma('application_id', { simple: true }),
      journal_mode: db.pragma('journal_mode', { simple: true }),
      integrity_check: db.pragma('integrity_check', { simple: true }),
      tables: out,
    };
  } finally {
    db.close();
  }
}

(async () => {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });
  fs.mkdirSync(outDir, { recursive: true });
  const R = { started_at: new Date().toISOString(), variant };

  // 1. origem: fatos antes
  const sidecars = [`${source}-wal`, `${source}-shm`];
  R.source = {
    path: source,
    before: fileFacts(source),
    sidecars_before: Object.fromEntries(sidecars.map((s) => [path.basename(s), statNs(s)])),
  };

  // 2. copia por leitura: API de backup (nunca copia bruta de -wal/-shm)
  fs.mkdirSync(path.join(scratch, 'db'));
  const copy = path.join(scratch, 'db', 'project-copy.db');
  const src = new Database(source, { readonly: true, fileMustExist: true });
  R.source.live_view = {
    user_version: src.pragma('user_version', { simple: true }),
    journal_mode: src.pragma('journal_mode', { simple: true }),
  };
  await src.backup(copy);
  src.close();
  R.copy = { path: copy, facts: fileFacts(copy) };
  // a copia vem do backup em WAL com o conteudo do WAL incorporado; normaliza para journal_mode delete como o ensaio exige arquivo estavel
  const norm = new Database(copy);
  R.copy.journal_mode_after_backup = norm.pragma('journal_mode', { simple: true });
  if (variant === 'normalized') norm.pragma('journal_mode = delete');
  norm.close();
  for (const s of [`${copy}-wal`, `${copy}-shm`]) fs.rmSync(s, { force: true });
  R.copy.facts_after_normalise = fileFacts(copy);

  // 3. dump antes
  const before = tableDigests(copy);
  R.pre_activation = before;
  // a leitura readonly de arquivo WAL cria sidecars: limpa-os e reconfere o hash
  for (const s of [`${copy}-wal`, `${copy}-shm`]) fs.rmSync(s, { force: true });
  const copySha = sha(copy);
  R.copy.sha256_pre_activation = copySha;

  // 4. CLI real com o ADR-0048 Proposed: deve recusar
  const cli = path.join(repo, 'tools', 'cli', 'hseos-cli.js');
  const backupDirCli = path.join(scratch, 'backups-cli');
  const runCli = (args) => {
    try {
      const out = execFileSync(process.execPath, [cli, 'execution-activation', ...args, '--db', copy, '--json'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NO_COLOR: '1' },
      });
      return { exit: 0, stdout: JSON.parse(out) };
    } catch (error) {
      return { exit: error.status, stdout: (error.stdout || '').slice(0, 4000), stderr: (error.stderr || '').slice(0, 4000) };
    }
  };
  R.real_cli_proposed_adr = {
    plan: runCli(['plan', '--adr', 'ADR-0048', '--backup-dir', backupDirCli]),
    apply: runCli(['apply', '--adr', 'ADR-0048', '--backup-dir', backupDirCli]),
    apply_without_adr: runCli(['apply', '--backup-dir', backupDirCli]),
  };
  R.real_cli_proposed_adr.copy_unchanged = sha(copy) === copySha;

  // 5. ADR de fixture Accepted em diretorio tmp
  const decisions = path.join(scratch, 'decisions');
  fs.mkdirSync(decisions);
  fs.writeFileSync(
    path.join(decisions, 'ADR-0048-governed-execution-activation-criterion.md'),
    '# ADR-0048 (FIXTURE K3, nao e o ADR real)\n\n## Status\n\nAccepted - 2026-10-22\n',
  );
  const internal = { decisionsDirectory: decisions };
  const backupDir = path.join(scratch, 'backups');

  // 6. lock: um processo (este) com a copia aberta recusa o plan
  const holder = new Database(copy, { readonly: true });
  holder.prepare('SELECT 1').get();
  const lockedPlan = lib.planExecutionLedgerActivation(copy, { adr: 'ADR-0048', backupDir, internal });
  holder.close();
  for (const s of [`${copy}-wal`, `${copy}-shm`]) fs.rmSync(s, { force: true });
  R.lock_refusal = { ready: lockedPlan.ready, blockers: lockedPlan.blockers, unscannable_processes: lockedPlan.unscannable_processes };

  // 7. plan limpo + dry-run + apply
  const plan = lib.planExecutionLedgerActivation(copy, { adr: 'ADR-0048', backupDir, internal });
  R.plan = plan;
  const dry = await lib.activateExecutionLedger(copy, { adr: 'ADR-0048', backupDir, internal, dryRun: true });
  R.dry_run = { dry_run: dry.dry_run, ready: dry.plan.ready, copy_unchanged: sha(copy) === copySha };
  const applied = await lib.activateExecutionLedger(copy, { adr: 'ADR-0048', backupDir, internal });
  R.apply = { receipt: applied.receipt, receipt_path: applied.receipt_path, backup_path: applied.backup_path };

  // 8. verificacao pos-ativacao
  const after = tableDigests(copy);
  R.post_activation = {
    user_version: after.user_version,
    application_id_hex: `0x${(after.application_id >>> 0).toString(16)}`,
    integrity_check: after.integrity_check,
    resolved_mode: lib.resolveGovernedExecutionMode(copy),
    tables_001_004_preserved: Object.entries(before.tables).every(
      ([t, f]) => after.tables[t] && after.tables[t].rows === f.rows && after.tables[t].sha256 === f.sha256,
    ),
    per_table: Object.fromEntries(
      Object.entries(before.tables).map(([t, f]) => [
        t,
        {
          before: f.rows,
          after: after.tables[t] ? after.tables[t].rows : null,
          same_digest: !!after.tables[t] && after.tables[t].sha256 === f.sha256,
        },
      ]),
    ),
    new_tables: Object.keys(after.tables).filter((t) => !before.tables[t]).length,
    receipt_on_disk: fs.existsSync(applied.receipt_path),
    backup_sha256_matches_before: sha(applied.backup_path) === copySha,
    receipt_original_sha256_matches: applied.receipt.original_sha256_before === copySha,
  };
  let legacy = 'no-error';
  try {
    const d = new Database(copy);
    d.close();
    lib.assertOperationalSchemaBoundary && (legacy = 'boundary-fn-present');
  } catch (error) {
    legacy = error.message;
  }
  let legacyOpen;
  try {
    lib.openOperationalStateDatabase(copy).close();
    legacyOpen = 'opened (unexpected)';
  } catch (error) {
    legacyOpen = `${error.code || error.name}: ${error.message}`.slice(0, 300);
  }
  R.post_activation.legacy_open_refused = legacyOpen;
  void legacy;

  // 9. rollback
  const rolled = await lib.restoreExecutionLedgerBackup(copy, {
    backupPath: applied.backup_path,
    expectedSha256: applied.receipt.original_sha256_before,
    internal,
  });
  const restored = tableDigests(copy);
  for (const s of [`${copy}-wal`, `${copy}-shm`]) fs.rmSync(s, { force: true });
  R.rollback = {
    restored_sha256: rolled.restored_sha256,
    sha256_equals_original_sha256_before: sha(copy) === applied.receipt.original_sha256_before && sha(copy) === copySha,
    user_version: restored.user_version,
    application_id: restored.application_id,
    integrity_check: restored.integrity_check,
    tables_identical_to_pre_activation: JSON.stringify(restored.tables) === JSON.stringify(before.tables),
    resolved_mode: lib.resolveGovernedExecutionMode(copy),
    preserved_activated_path: rolled.preserved_activated_path,
    preserved_activated_exists: fs.existsSync(rolled.preserved_activated_path),
    content_matches_original: rolled.content_matches_original,
  };

  // 9b. ensaio oficial do repositorio (agent-activation-rehearsal) sobre outra copia pre-ativacao (o backup verificado)
  const rehearsalDb = path.join(scratch, 'db2', 'project-rehearsal.db');
  fs.mkdirSync(path.dirname(rehearsalDb));
  fs.copyFileSync(applied.backup_path, rehearsalDb);
  try {
    const out = execFileSync(
      process.execPath,
      [cli, 'agent-activation-rehearsal', '--database', rehearsalDb, '--repository', repo, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 },
    );
    const rep = JSON.parse(out);
    R.official_rehearsal = { exit: 0, status: rep.status, remaining_gates: rep.remaining_gates, evidence: rep.evidence };
  } catch (error) {
    R.official_rehearsal = { exit: error.status, stdout: (error.stdout || '').slice(0, 6000), stderr: (error.stderr || '').slice(0, 3000) };
  }

  // 10. origem: fatos depois
  R.source.after = fileFacts(source);
  R.source.sidecars_after = Object.fromEntries(sidecars.map((s) => [path.basename(s), statNs(s)]));
  R.source.main_file_identical =
    R.source.before.sha256 === R.source.after.sha256 &&
    R.source.before.size === R.source.after.size &&
    R.source.before.mtime === R.source.after.mtime;
  R.source.sidecars_identical = JSON.stringify(R.source.sidecars_before) === JSON.stringify(R.source.sidecars_after);
  R.finished_at = new Date().toISOString();
  write(variant === 'normalized' ? 'rehearsal-result.json' : `rehearsal-result-${variant}.json`, R);
  console.log(
    redact(
      JSON.stringify(
        {
          main_file_identical: R.source.main_file_identical,
          sidecars_identical: R.source.sidecars_identical,
          post: R.post_activation.user_version,
          rollback_ok: R.rollback.sha256_equals_original_sha256_before,
        },
        null,
        1,
      ),
    ),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
