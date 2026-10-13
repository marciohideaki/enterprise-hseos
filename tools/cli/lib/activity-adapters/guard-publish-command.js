'use strict';

/**
 * Entry for `hseos activity guard-publish <pkg>@<version>`. The `activity`
 * command (W5-CO1) dispatches here with the parsed options. Reservations
 * come from the store through `hseos activity list --json` (`claims`).
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const semver = require('semver');
const { guardPublish } = require('./publish-guard');

const HSEOS_CLI = path.join(__dirname, '..', '..', 'hseos-cli.js');

/** `version:<pkg>@<semver>` claim for the same package and an equal version (build metadata ignored). */
function claimMatches(key, pkg, version) {
  const match = /^version:(.+)@([^@]+)$/.exec(String(key));
  return match !== null && match[1].toLowerCase() === pkg && semver.valid(match[2]) !== null && semver.eq(match[2], version);
}

function storeReservations(root, cli = HSEOS_CLI) {
  return (pkg, version) => {
    const result = spawnSync(process.execPath, [cli, 'activity', 'list', '--json', '--directory', root], {
      encoding: 'utf8',
      timeout: 8000,
    });
    if (result.error || result.status !== 0) throw new Error(result.error ? result.error.message : `activity list exited ${result.status}`);
    const parsed = JSON.parse((result.stdout || '').trim() || '{}');
    return (parsed.claims || [])
      .filter((item) => !item.released && claimMatches(item.key, pkg, version))
      .map((item) => ({ session: item.owner, key: item.key }));
  };
}

/**
 * Always returns an object `{exitCode, decision, reason, ...result}`: exitCode 0 for allow, warn or skip,
 * 1 for refuse and 2 for an invalid spec. The caller propagates `exitCode` to the process.
 */
function runGuardPublish(spec, options = {}, deps = {}) {
  const root = path.resolve(options.directory || process.cwd());
  const result = guardPublish(spec, {
    root,
    session: options.session || process.env.HSEOS_SESSION_ID,
    listReservations: deps.listReservations || storeReservations(root, options.cli),
    fetchPublished: deps.fetchPublished,
  });
  const out = deps.stdout || ((text) => process.stdout.write(`${text}\n`));
  if (options.json) out(JSON.stringify(result));
  else {
    out(`[guard-publish] ${result.decision}${result.pkg ? ` ${result.pkg}@${result.version}` : ''}`);
    for (const conflict of result.conflicts)
      out(`  conflict (${conflict.source})${conflict.session ? ` session ${conflict.session}` : ''}`);
    for (const reason of result.reasons) out(`  reason: ${reason}`);
    for (const warning of result.warnings) out(`  warning: ${warning}`);
  }
  return { ...result, reason: result.reasons[0] || null };
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  const value = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const spec = argv.find((arg, index) => !arg.startsWith('--') && !['--session', '--directory', '--cli'].includes(argv[index - 1]));
  const outcome = runGuardPublish(spec, {
    session: value('--session'),
    directory: value('--directory'),
    cli: value('--cli'),
    json: argv.includes('--json'),
  });
  process.exitCode = outcome.exitCode;
}

module.exports = { runGuardPublish, storeReservations };
