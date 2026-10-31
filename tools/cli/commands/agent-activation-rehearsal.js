'use strict';

const path = require('node:path');

const { runActivationRehearsal } = require('../../lib/agentic-activation-rehearsal');
const {
  activateExecutionLedger,
  planExecutionLedgerActivation,
  restoreExecutionLedgerBackup,
} = require('../../mcp-project-state/lib/operational-state-db');
const { findProjectRoot } = require('../lib/project-root');

function render(report) {
  const { migration, operational_source: source, profile, rollback, sandbox } = report.evidence;
  return [
    `Agentic activation rehearsal: ${report.status}`,
    '  operational activation: no',
    `  private-copy migration v${migration.source_version} -> v${migration.target_version}: ${migration.ready ? 'ready' : 'failed'}`,
    `  rollback to v${rollback.restored_version}: ${rollback.ready ? 'ready' : 'failed'}`,
    `  source unchanged: ${source.unchanged ? 'yes' : 'no'}`,
    `  candidate profile contract: ${profile.ready ? 'ready' : 'failed'}`,
    `  required sandbox runtime: ${sandbox.ready ? 'ready' : 'blocked'}`,
    `  remaining gates: ${report.remaining_gates.join(', ') || 'none'}`,
  ].join('\n');
}

const ACTIVATION_ACTIONS = Object.freeze(['plan', 'apply', 'rollback']);

function renderActivation(report) {
  if (report.action === 'plan') {
    const { plan } = report;
    return [
      `Execution ledger activation plan: ${plan.ready ? 'ready' : 'blocked'}`,
      `  database: ${plan.database_path} (user_version ${plan.user_version})`,
      `  ADR: ${plan.adr || 'none'} (${plan.adr_status || 'unresolved'})`,
      `  migrations to apply: ${plan.migrations_to_apply.length} -> user_version ${plan.target_user_version}`,
      `  backup: ${plan.backup_path || 'not planned (--backup-dir missing)'}`,
      ...plan.blockers.map((blocker) => `  blocker ${blocker.code}: ${blocker.message}`),
    ].join('\n');
  }
  if (report.action === 'apply') {
    const { receipt } = report;
    return [
      'Execution ledger activated',
      `  user_version ${receipt.user_version_before} -> ${receipt.user_version_after}`,
      `  backup: ${report.backup_path}`,
      `  backup sha256: ${receipt.backup_sha256}`,
      `  receipt: ${report.receipt_path}`,
    ].join('\n');
  }
  return [
    'Execution ledger rolled back to the verified backup',
    `  user_version ${report.user_version}`,
    `  restored sha256: ${report.restored_sha256}`,
    `  receipt verified: ${report.receipt_verified}`,
    `  writes made after the activation are preserved in ${report.preserved_activated_path}, not in the restored database`,
  ].join('\n');
}

/**
 * `hseos execution-activation plan|apply|rollback`: governed entry to the execution-ledger activation
 * mechanism. Registered as a companion command of this module so no new CLI file is needed.
 */
async function executionActivationAction(actionName, options) {
  if (!ACTIVATION_ACTIONS.includes(actionName)) {
    throw new TypeError(`execution-activation action must be one of: ${ACTIVATION_ACTIONS.join(', ')}`);
  }
  if (!options.db) throw new TypeError('--db <path> is required');
  const databasePath = path.resolve(options.db);
  let report;
  if (actionName === 'plan') {
    report = { action: 'plan', plan: planExecutionLedgerActivation(databasePath, { adr: options.adr, backupDir: options.backupDir }) };
    if (!report.plan.ready) process.exitCode = 2;
  } else if (actionName === 'apply') {
    report = {
      action: 'apply',
      ...(await activateExecutionLedger(databasePath, { adr: options.adr, backupDir: options.backupDir, windowPath: options.window })),
    };
  } else {
    report = {
      action: 'rollback',
      ...(await restoreExecutionLedgerBackup(databasePath, {
        backupPath: options.backup,
        expectedSha256: options.expectedSha256,
        receiptPath: options.receipt,
        allowMissingReceipt: options.allowMissingReceipt === true,
      })),
    };
  }
  console.log(options.json ? JSON.stringify(report, null, 2) : renderActivation(report));
  return report;
}

module.exports = {
  companions: [
    {
      command: 'execution-activation <action>',
      description:
        'Plan, apply or roll back activation of the governed execution ledger on one existing state database (apply requires an Accepted ADR and a backup directory).',
      options: [
        ['--db <path>', 'State database to activate or restore (a regular schema-v4 file; never a link)'],
        ['--adr <id>', 'ADR identifier whose status must be Accepted (for example ADR-0048)'],
        ['--backup-dir <dir>', 'Directory that receives the verified pre-activation backup and receipt'],
        [
          '--window <path>',
          'Supervised-window record (operator, stopped_consumers, original_sha256_before, recorded_at) validated and bound in the receipt (apply)',
        ],
        ['--backup <path>', 'Backup file to restore (rollback)'],
        ['--expected-sha256 <hex>', 'Expected sha256 of the backup file (rollback)'],
        ['--receipt <path>', 'Activation receipt to cross-check the backup against (rollback; default: <backup>.receipt.json)'],
        ['--allow-missing-receipt', 'Restore without a verifiable receipt; the output records receipt_verified: false (rollback)'],
        ['--json', 'Output machine-readable JSON'],
      ],
      action: executionActivationAction,
      render: renderActivation,
    },
  ],
  command: 'agent-activation-rehearsal',
  description: 'Rehearse agentic schema activation and rollback on private copies without authorizing operational cutover.',
  options: [
    ['--directory <path>', 'Project containing .hseos/state/project.db (default: current directory)'],
    ['--database <path>', 'Stable schema-v4 source database (overrides --directory)'],
    ['--repository <path>', 'HSEOS repository root (default: auto-detected)'],
    ['--live-snapshot', 'Allow a verified private snapshot when the source has active SQLite WAL sidecars'],
    ['--json', 'Output machine-readable JSON'],
    ['--require-rehearsal-ready', 'Exit non-zero unless migration, rollback, profile and source immutability pass'],
  ],
  async action(options) {
    const repositoryRoot = path.resolve(options.repository || findProjectRoot(__dirname));
    const projectDirectory = path.resolve(options.directory || process.cwd());
    const databasePath = path.resolve(options.database || path.join(projectDirectory, '.hseos', 'state', 'project.db'));
    const report = await runActivationRehearsal({ databasePath, repositoryRoot, allowLiveSnapshot: options.liveSnapshot === true });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireRehearsalReady && report.status !== 'rehearsal-passed') process.exitCode = 2;
    return report;
  },
  render,
};
