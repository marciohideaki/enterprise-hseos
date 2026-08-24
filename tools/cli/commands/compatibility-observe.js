'use strict';

const path = require('node:path');

const { monitorCompatibilityObservation } = require('../../lib/compatibility-observation');

function render(report) {
  const missing = report.current.servers.filter(({ present }) => !present).map(({ server_id }) => server_id);
  const stale = report.current.servers.filter(({ present, fresh }) => present && !fresh).map(({ server_id }) => server_id);
  const legacyUse = report.current.legacy_use_today.reduce((sum, row) => sum + row.count, 0);
  return [
    `Compatibility observation: ${report.status}`,
    '  mode: monitor-only (never authorizes cutover)',
    `  current UTC hour: ${report.current.usage_hour}`,
    `  required servers present: ${report.current.all_servers_present ? 'yes' : 'no'}`,
    `  required servers fresh: ${report.current.all_servers_fresh ? 'yes' : 'no'}`,
    `  missing servers: ${missing.length === 0 ? 'none' : missing.join(', ')}`,
    `  stale servers: ${stale.length === 0 ? 'none' : stale.join(', ')}`,
    `  legacy requests today: ${legacyUse}`,
    `  latest legacy request: ${report.current.latest_legacy_use_at || 'none recorded today'}`,
    `  quiet since latest legacy request: ${
      report.current.legacy_quiet_minutes === null ? 'not applicable' : `${report.current.legacy_quiet_minutes} minutes`
    } (informational; complete UTC days govern G9)`,
    `  consecutive complete zero-use days: ${report.progress.current_consecutive_days}/${report.progress.required_days}`,
    `  remaining complete days: ${report.progress.remaining_days}`,
    `  manifest consistent: ${report.manifest.valid ? 'yes' : 'no'}`,
    '  ready for cutover: no (final audit and explicit human gate remain required)',
  ].join('\n');
}

module.exports = {
  command: 'compatibility-observe',
  description: 'Monitor live compatibility telemetry read-only without claiming cutover readiness.',
  options: [
    ['--directory <path>', 'Project containing .hseos/state (default: current directory)'],
    ['--telemetry <path>', 'Explicit live telemetry database path'],
    ['--manifest <path>', 'Explicit observation release manifest path'],
    ['--as-of <timestamp>', 'UTC observation instant (default: now)'],
    ['--max-staleness-minutes <minutes>', 'Maximum heartbeat age (default: 75)', '75'],
    ['--json', 'Output machine-readable JSON'],
    ['--require-current-hour', 'Exit non-zero unless all required servers are present and fresh'],
  ],
  async action(options) {
    const asOf = options.asOf ? new Date(options.asOf) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new TypeError('--as-of must be a valid timestamp');
    const maxStalenessMinutes = Number(options.maxStalenessMinutes);
    if (!Number.isInteger(maxStalenessMinutes) || maxStalenessMinutes < 1) {
      throw new TypeError('--max-staleness-minutes must be a positive integer');
    }
    const report = monitorCompatibilityObservation({
      projectDirectory: path.resolve(options.directory || process.cwd()),
      telemetryDatabase: options.telemetry,
      manifestPath: options.manifest,
      asOf,
      maxStalenessMinutes,
    });
    console.log(options.json ? JSON.stringify(report, null, 2) : render(report));
    if (options.requireCurrentHour && !report.observation_healthy) process.exitCode = 2;
    return report;
  },
  render,
};
