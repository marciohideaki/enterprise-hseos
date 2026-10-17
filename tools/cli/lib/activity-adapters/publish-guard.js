'use strict';

/**
 * Publish/bump guard for the cross-tool activity coordination track (W5-CO2).
 *
 * `hseos activity guard-publish <pkg>@<version>` is meant for CI or release
 * scripts. The decision is advisory unless the project turned
 * `enforce.publish_guard` on in `.hseos/config/activity-coordination.yaml`.
 * Collaborators are injected so the guard never needs the network or the
 * store in tests. With enforcement on, a store failure is fail-closed (deny);
 * a registry (network) failure degrades to a warning.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const semver = require('semver');
const yaml = require('yaml');

const CONTRACT_RELATIVE_PATH = path.join('.hseos', 'config', 'activity-coordination.yaml');
const LAST_VALID_RELATIVE_PATH = path.join('.hseos', 'state', 'activity-coordination.last-valid.json');
const NPM_TIMEOUT_MS = 8000;
const PACKAGE_NAME = /^(@[\da-z][\w.~-]*\/)?[\da-z][\w.~-]*$/;

/** npm names are lowercase only, so an uppercase name is an invalid spec, never a bypass. Build metadata is dropped. */
function parseSpec(spec) {
  const text = String(spec || '').trim();
  const at = text.lastIndexOf('@');
  if (at <= 0 || at === text.length - 1) return null;
  const pkg = text.slice(0, at);
  if (!PACKAGE_NAME.test(pkg) || pkg.length > 214) return null;
  const version = semver.valid(text.slice(at + 1));
  return version ? { pkg, version } : null;
}

const isBoolean = (value) => typeof value === 'boolean';

/** Same validity rules as the core loader for the fields the guard reads. */
function readableSettings(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const enforce = raw.enforce === undefined ? {} : raw.enforce;
  if (enforce === null || typeof enforce !== 'object' || Array.isArray(enforce)) return null;
  if (raw.enabled !== undefined && !isBoolean(raw.enabled)) return null;
  if (enforce.publish_guard !== undefined && !isBoolean(enforce.publish_guard)) return null;
  return { enabled: raw.enabled === true, enforce: enforce.publish_guard === true };
}

function lastValid(root) {
  try {
    return readableSettings(JSON.parse(fs.readFileSync(path.join(root, LAST_VALID_RELATIVE_PATH), 'utf8')));
  } catch {
    return null;
  }
}

function readContract(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, CONTRACT_RELATIVE_PATH), 'utf8');
  } catch {
    return { present: false, enabled: false, enforce: false, warnings: [] };
  }
  let settings = null;
  let problem = 'invalid contract';
  try {
    settings = readableSettings(yaml.parse(text) ?? {});
  } catch (error) {
    problem = `contract unreadable: ${error.message.split('\n')[0]}`;
  }
  if (settings) return { present: true, ...settings, warnings: [] };
  const previous = lastValid(root);
  if (previous) return { present: true, ...previous, warnings: [`${problem}; applying the last valid configuration`] };
  return { present: true, enabled: false, enforce: false, warnings: [`${problem}; no valid configuration, guard inactive`] };
}

function npmPublishedVersions(pkg) {
  const result = spawnSync('npm', ['view', pkg, 'versions', '--json'], {
    encoding: 'utf8',
    timeout: NPM_TIMEOUT_MS,
  });
  if (result.error || result.status !== 0) {
    const text = `${result.stdout || ''}${result.stderr || ''}`;
    if (/E404|404 Not Found/.test(text)) return [];
    throw new Error(result.error ? result.error.message : `npm view exited ${result.status}`);
  }
  const parsed = JSON.parse(result.stdout || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
}

const sameVersion = (left, right) => semver.valid(left) !== null && semver.valid(right) !== null && semver.eq(left, right);

/**
 * @param {string} spec `<pkg>@<version>`
 * @param {object} deps
 * @param {string} deps.root repository root holding the contract
 * @param {string} [deps.session] session that owns the bump; its own reservation never conflicts
 * @param {(pkg:string)=>string[]} [deps.fetchPublished] published versions lookup
 * @param {(pkg:string, version:string)=>Array<{session:string, tool?:string}>} deps.listReservations
 * @returns {{decision:'skip'|'allow'|'warn'|'refuse', exitCode:number, conflicts:object[], warnings:string[], reasons:string[]}}
 */
function guardPublish(spec, deps = {}) {
  const parsed = parseSpec(spec);
  if (!parsed) {
    return {
      decision: 'refuse',
      exitCode: 2,
      conflicts: [],
      reasons: ['invalid_spec'],
      warnings: [`invalid spec "${spec}"; expected <lowercase-pkg>@<semver>`],
    };
  }
  const contract = readContract(deps.root || process.cwd());
  const warnings = [...contract.warnings];
  const reasons = [];
  if (!contract.enabled) return { decision: 'skip', exitCode: 0, conflicts: [], reasons, warnings, ...parsed };

  const conflicts = [];
  let storeFailed = false;
  try {
    const reservations = deps.listReservations ? deps.listReservations(parsed.pkg, parsed.version) : [];
    for (const item of reservations) {
      if (item.session && item.session === deps.session) continue;
      conflicts.push({ source: 'claim', session: item.session || null, tool: item.tool || null });
    }
  } catch (error) {
    storeFailed = true;
    warnings.push(`reservation lookup failed: ${error.message}`);
  }
  try {
    const published = (deps.fetchPublished || npmPublishedVersions)(parsed.pkg);
    if (published.some((version) => sameVersion(version, parsed.version))) conflicts.push({ source: 'published' });
  } catch (error) {
    warnings.push(`published versions lookup failed: ${error.message}`);
  }

  if (storeFailed && contract.enforce) {
    reasons.push('store_unavailable');
    return { decision: 'refuse', exitCode: 1, conflicts, reasons, warnings, ...parsed };
  }
  if (conflicts.length === 0) return { decision: 'allow', exitCode: 0, conflicts, reasons, warnings, ...parsed };
  reasons.push(...new Set(conflicts.map((conflict) => `${conflict.source}_conflict`)));
  const refuse = contract.enforce;
  return { decision: refuse ? 'refuse' : 'warn', exitCode: refuse ? 1 : 0, conflicts, reasons, warnings, ...parsed };
}

module.exports = { guardPublish, parseSpec, readContract, CONTRACT_RELATIVE_PATH };
