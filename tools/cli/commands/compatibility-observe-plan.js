'use strict';

const path = require('node:path');

const { buildCompatibilityObservationSchedulePlan } = require('../../lib/compatibility-observation-plan');

function render(plan) {
  return [
    'Compatibility observation schedule plan',
    '  mode: plan-only (never installs or enables units)',
    `  project: ${plan.project_directory}`,
    `  evidence: ${plan.evidence_directory}`,
    `  cadence: hourly at minute ${String(plan.schedule.minute_utc).padStart(2, '0')} UTC`,
    `  service: ${plan.systemd.service_name}`,
    `  timer: ${plan.systemd.timer_name}`,
    '  activation authorized: no',
    '',
    `--- ${plan.systemd.service_name} ---`,
    plan.systemd.service.trimEnd(),
    '',
    `--- ${plan.systemd.timer_name} ---`,
    plan.systemd.timer.trimEnd(),
  ].join('\n');
}

module.exports = {
  command: 'compatibility-observe-plan',
  description: 'Render a hardened recurring observation plan without installing or enabling it.',
  options: [
    ['--directory <absolute-path>', 'Project containing .hseos/state (default: current directory)'],
    ['--evidence-directory <absolute-path>', 'Dedicated private evidence directory'],
    ['--node <absolute-path>', 'Node.js executable (default: current executable)'],
    ['--cli <absolute-path>', 'HSEOS CLI script (default: this installation)'],
    ['--minute-utc <minute>', 'Hourly UTC minute from 0 through 59 (default: 20)', '20'],
    ['--json', 'Output the complete machine-readable plan'],
  ],
  async action(options = {}) {
    if (!options.evidenceDirectory) throw new TypeError('--evidence-directory is required');
    const minuteUtc = Number(options.minuteUtc);
    const plan = buildCompatibilityObservationSchedulePlan({
      projectDirectory: path.resolve(options.directory || process.cwd()),
      evidenceDirectory: options.evidenceDirectory,
      nodeExecutable: options.node || process.execPath,
      cliPath: options.cli || path.resolve(__dirname, '..', 'hseos-cli.js'),
      minuteUtc,
    });
    console.log(options.json ? JSON.stringify(plan, null, 2) : render(plan));
    return plan;
  },
  render,
};
