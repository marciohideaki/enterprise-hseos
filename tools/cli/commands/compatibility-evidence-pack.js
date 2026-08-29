'use strict';

const path = require('node:path');

const { packCompatibilityEvidence } = require('../../lib/compatibility-evidence-pack');

function render(report) {
  return [
    `Downstream evidence bundle: ${report.status}`,
    `  output: ${report.output_directory}`,
    `  artifacts: ${report.artifact_count}`,
    `  available for human verification: ${report.ready_for_human_verification ? 'yes' : 'no'}`,
    '  activation authorized: no',
  ].join('\n');
}

module.exports = {
  command: 'compatibility-evidence-pack',
  description: 'Re-collect Git-pinned downstream evidence and package it without touching operational state.',
  options: [
    ['--manifest <absolute-path>', 'Canonical packaging manifest referencing the Git-pinned collector manifest'],
    ['--directory <absolute-path>', 'Project containing the canonical G9 observation manifest'],
    ['--output-directory <absolute-path>', 'New private directory for the immutable evidence bundle'],
    ['--as-of <timestamp>', 'UTC packaging cutoff (default: now)'],
    ['--json', 'Output the machine-readable packaging result'],
    ['--require-ready', 'Exit non-zero when legacy consumers remain'],
  ],
  async action(options = {}) {
    for (const [option, value] of [
      ['--manifest', options.manifest],
      ['--directory', options.directory],
      ['--output-directory', options.outputDirectory],
    ]) {
      if (!value) throw new TypeError(`${option} is required`);
      if (!path.isAbsolute(value)) throw new TypeError(`${option} must be absolute`);
    }
    const asOf = options.asOf ? new Date(options.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new TypeError('--as-of must be a valid timestamp');
    const report = packCompatibilityEvidence({
      collectionManifestPath: options.manifest,
      projectDirectory: options.directory,
      outputDirectory: options.outputDirectory,
      asOf,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireReady && !report.ready_for_human_verification) process.exitCode = 2;
    return report;
  },
  render,
};
