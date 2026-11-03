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

const MEMORY_ACTIONS = Object.freeze(['promote']);
const HEX64 = /^[0-9a-f]{64}$/;

function confirmOnTerminal(question) {
  return new Promise((resolve) => {
    const readline = require('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^(y|yes|s|sim)$/i.test(answer.trim()));
    });
  });
}

/**
 * `hseos memory promote`: the operator lifts one agent-written memory to trusted, one memory at a time. Without `--yes` it
 * shows the content and digest and asks on the terminal; with `--yes` the operator declares the digest they reviewed.
 * Not an MCP tool and not reachable by a model or a task contract.
 */
async function memoryAction(actionName, options, confirm = confirmOnTerminal, interactive = Boolean(process.stdin.isTTY)) {
  if (!MEMORY_ACTIONS.includes(actionName)) throw new TypeError(`memory action must be one of: ${MEMORY_ACTIONS.join(', ')}`);
  for (const [flag, value] of [
    ['--db', options.db],
    ['--project', options.project],
    ['--memory', options.memory],
    ['--reason', options.reason],
    ['--operator', options.operator],
  ]) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${flag} is required`);
  }
  if (options.yes === true && !HEX64.test(options.contentSha256 ?? '')) {
    throw new TypeError('--yes needs --content-sha256 <hex> of the content you reviewed');
  }
  // Promotion is a human act: it needs the operator's own terminal. A process without one (an agent, a pipe, CI) is refused.
  if (interactive !== true) throw new TypeError('memory promote needs an interactive terminal (stdin is not a TTY)');
  const { openOperatorMemory } = require('../lib/memory-context-source');
  const operatorMemory = openOperatorMemory({
    databasePath: path.resolve(options.db),
    operator: { kind: 'operator', id: options.operator },
  });
  try {
    const shown = operatorMemory.inspect(options.project, options.memory);
    let digest = options.contentSha256;
    if (options.yes !== true) {
      console.log(
        `memory ${shown.memory_id} (${shown.origin}, ${shown.trust}, ${shown.status})\ncontent sha256: ${shown.content_sha256}\n${shown.content}`,
      );
      if (!(await confirm(`Promote ${shown.memory_id} to trusted as ${options.operator}? [y/N] `)))
        throw new TypeError('promotion declined');
      digest = shown.content_sha256;
    }
    const receipt = operatorMemory.promote({
      project_id: options.project,
      memory_id: options.memory,
      content_sha256: digest,
      reason: options.reason,
    });
    const report = { action: 'promote', project_id: options.project, operator: options.operator, ...receipt };
    console.log(
      options.json
        ? JSON.stringify(report, null, 2)
        : `Memory ${receipt.promoted_from} promoted to trusted as ${receipt.memory_id}\n  content sha256: ${receipt.content_sha256}`,
    );
    return report;
  } finally {
    operatorMemory.close();
  }
}

module.exports = {
  companions: [
    {
      command: 'memory <action>',
      description:
        'Operator memory commands over an activated state database (promote: lift one agent note to trusted with a single-use approval).',
      options: [
        ['--db <path>', 'Activated state database'],
        ['--project <id>', 'Project of the memory'],
        ['--memory <id>', 'Memory entry to promote'],
        ['--reason <text>', 'Why the operator trusts this memory'],
        ['--operator <id>', 'Identity of the operator who confirms'],
        ['--yes', 'Confirm without a prompt; needs --content-sha256'],
        ['--content-sha256 <hex>', 'Digest of the content the operator reviewed (with --yes)'],
        ['--json', 'Output machine-readable JSON'],
      ],
      // The CLI parser calls an action as (arguments, options, command): forward only the first two, so that the confirmation and
      // terminal parameters of memoryAction keep their defaults instead of receiving the parser's command object.
      action: (actionName, options) => memoryAction(actionName, options),
    },
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
  _internal: { memoryAction },
};
