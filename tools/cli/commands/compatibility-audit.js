'use strict';

const path = require('node:path');

const { auditCompatibility } = require('../../lib/compatibility-audit');
const { findProjectRoot } = require('../lib/project-root');

function render(report) {
  const { callers, migration, telemetry } = report.evidence;
  return [
    `Compatibility retirement: ${report.status}`,
    `  activation authorized: no (explicit human gate required)`,
    `  ready for human gate: ${report.ready_for_human_gate ? 'yes' : 'no'}`,
    `  MCP zero-use telemetry: ${telemetry.ready ? 'ready' : 'blocked'}${telemetry.gap_count === undefined ? '' : ` (${telemetry.gap_count} hourly gaps)`}`,
    `  migration dry-run: ${migration.ready ? 'ready' : 'blocked'}`,
    `  operational DB unchanged: ${migration.operational_unchanged === true ? 'yes' : 'unproven'}`,
    `  active legacy MCP references: ${callers.active_legacy_mcp_entrypoints.length}`,
    `  active legacy state-write references: ${callers.active_legacy_state_writes.length}`,
    `  retired internal symbol callers: ${callers.retired_internal_symbols.length}`,
    `  activation deadline: ${report.deadlines.activation_no_later_than}`,
    `  compatibility removal deadline: ${report.deadlines.compatibility_removal_by}`,
  ].join('\n');
}

module.exports = {
  command: 'compatibility-audit',
  description: 'Audit compatibility retirement evidence without mutating operational state.',
  options: [
    ['--directory <path>', 'Project containing .hseos/state (default: current directory)'],
    ['--repository <path>', 'HSEOS repository root (default: auto-detected)'],
    ['--as-of <timestamp>', 'UTC evidence cutoff (default: now)'],
    ['--json', 'Output machine-readable JSON'],
    ['--require-ready', 'Exit non-zero unless all evidence is ready for the human gate'],
  ],
  async action(options) {
    const repositoryRoot = path.resolve(options.repository || findProjectRoot(__dirname));
    const projectDirectory = path.resolve(options.directory || process.cwd());
    const asOf = options.asOf ? new Date(options.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new TypeError('--as-of must be a valid timestamp');
    const report = await auditCompatibility({ repositoryRoot, projectDirectory, asOf });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireReady && !report.ready_for_human_gate) process.exitCode = 2;
    return report;
  },
  render,
};
