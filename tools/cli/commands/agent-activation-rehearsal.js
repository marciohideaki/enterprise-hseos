'use strict';

const path = require('node:path');

const { runActivationRehearsal } = require('../../lib/agentic-activation-rehearsal');
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

module.exports = {
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
