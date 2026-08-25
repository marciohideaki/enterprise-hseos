'use strict';

const path = require('node:path');

const { collectCompatibilityInventory } = require('../../lib/compatibility-evidence-inventory');

function render(report) {
  return [
    `Downstream inventory: ${report.status}`,
    `  output: ${report.output_directory}`,
    ...report.surfaces.map(
      (surface) => `  ${surface.surface_id}: ${surface.legacy_consumers} legacy, ${surface.migrated_consumers} migrated`,
    ),
    '  final evidence ready: no (release artifacts still required)',
    '  activation authorized: no',
  ].join('\n');
}

module.exports = {
  command: 'compatibility-evidence-inventory',
  description: 'Collect Git-pinned downstream compatibility inventories without network or operational state writes.',
  options: [
    ['--manifest <absolute-path>', 'Canonical downstream Git inventory manifest'],
    ['--directory <absolute-path>', 'Project containing the canonical G9 observation manifest'],
    ['--output-directory <absolute-path>', 'New private directory for immutable inventory artifacts'],
    ['--as-of <timestamp>', 'UTC collection cutoff (default: now)'],
    ['--json', 'Output the machine-readable inventory result'],
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
    const report = collectCompatibilityInventory({
      manifestPath: options.manifest,
      projectDirectory: options.directory,
      outputDirectory: options.outputDirectory,
      asOf,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    return report;
  },
  render,
};
