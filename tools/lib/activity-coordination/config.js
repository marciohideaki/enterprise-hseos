'use strict';
/**
 * W5-CO1 — activity-coordination contract: schema, validator and loader.
 * Absent file or `enabled: false` means no effect. The file is re-read on every call (no cache); when it is
 * invalid the last valid configuration (persisted next to the project state) is used with a warning.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const yaml = require('yaml');

const CONFIG_RELATIVE_PATH = path.join('.hseos', 'config', 'activity-coordination.yaml');
const LAST_VALID_RELATIVE_PATH = path.join('.hseos', 'state', 'activity-coordination.last-valid.json');
const KINDS = ['path', 'version', 'name'];
const BACKENDS = new Set(['machine', 'project-aggregate']);

const DEFAULTS = Object.freeze({
  enabled: false,
  store: { backend: 'machine', path: '~/.local/state/hseos/activity.db', adapters: [], project_dirs: [] },
  hot_files: [],
  reservations: { kinds: [...KINDS], ttl_s: 86_400 },
  enforce: { publish_guard: false },
  overlap: { include_git_diff: true },
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isStringArray = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0);

function expandHome(target) {
  if (typeof target !== 'string') return target;
  if (target === '~') return os.homedir();
  return target.startsWith('~/') ? path.join(os.homedir(), target.slice(2)) : target;
}

/** Validates a parsed contract; returns the list of problems (empty when valid). */
function validate(raw) {
  const errors = [];
  if (!isObject(raw)) return ['contract must be a mapping'];
  const known = new Set(['enabled', 'store', 'hot_files', 'reservations', 'enforce', 'overlap']);
  for (const key of Object.keys(raw)) if (!known.has(key)) errors.push(`unknown key: ${key}`);
  if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') errors.push('enabled must be boolean');
  if (raw.store !== undefined) {
    if (isObject(raw.store)) {
      const { backend, path: storePath, adapters, project_dirs: dirs } = raw.store;
      if (backend !== undefined && !(BACKENDS.has(backend) || /^adapter:[a-z][a-z0-9-]*$/.test(String(backend)))) {
        errors.push('store.backend must be machine, project-aggregate or adapter:<name>');
      }
      if (storePath !== undefined && (typeof storePath !== 'string' || !storePath)) errors.push('store.path must be a non-empty string');
      if (adapters !== undefined && !isStringArray(adapters)) errors.push('store.adapters must be a list of names');
      if (dirs !== undefined && !isStringArray(dirs)) errors.push('store.project_dirs must be a list of paths');
    } else {
      errors.push('store must be a mapping');
    }
  }
  if (raw.hot_files !== undefined && !isStringArray(raw.hot_files)) errors.push('hot_files must be a list of globs');
  if (raw.reservations !== undefined) {
    if (isObject(raw.reservations)) {
      const { kinds, ttl_s: ttl } = raw.reservations;
      if (kinds !== undefined && !(isStringArray(kinds) && kinds.every((kind) => KINDS.includes(kind)))) {
        errors.push(`reservations.kinds must be a subset of ${KINDS.join(', ')}`);
      }
      if (ttl !== undefined && !(Number.isInteger(ttl) && ttl > 0)) errors.push('reservations.ttl_s must be a positive integer');
    } else {
      errors.push('reservations must be a mapping');
    }
  }
  for (const [section, field] of [
    ['enforce', 'publish_guard'],
    ['overlap', 'include_git_diff'],
  ]) {
    if (raw[section] === undefined) continue;
    if (!isObject(raw[section])) errors.push(`${section} must be a mapping`);
    else if (raw[section][field] !== undefined && typeof raw[section][field] !== 'boolean')
      errors.push(`${section}.${field} must be boolean`);
  }
  return errors;
}

function normalize(raw) {
  const store = { ...DEFAULTS.store, ...raw.store };
  store.path = path.resolve(expandHome(store.path));
  return {
    enabled: raw.enabled === true,
    store,
    hot_files: raw.hot_files || [],
    reservations: { ...DEFAULTS.reservations, ...raw.reservations },
    enforce: { ...DEFAULTS.enforce, ...raw.enforce },
    overlap: { ...DEFAULTS.overlap, ...raw.overlap },
  };
}

function readLastValid(directory) {
  try {
    return JSON.parse(fs.readFileSync(path.join(directory, LAST_VALID_RELATIVE_PATH), 'utf8'));
  } catch {
    return null;
  }
}

function writeLastValid(directory, raw) {
  try {
    const target = path.join(directory, LAST_VALID_RELATIVE_PATH);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(raw));
  } catch {
    /* best effort: the last-valid copy is a convenience */
  }
}

function removeLastValid(directory) {
  try {
    fs.rmSync(path.join(directory, LAST_VALID_RELATIVE_PATH), { force: true });
  } catch {
    /* nothing to remove */
  }
}

/**
 * Loads the contract of `directory`. Never throws.
 * @returns {{enabled: boolean, config: object|null, warnings: string[], source: 'absent'|'file'|'last-valid'|'disabled'}}
 */
function loadConfig(directory) {
  const file = path.join(directory, CONFIG_RELATIVE_PATH);
  const warnings = [];
  if (!fs.existsSync(file)) return { enabled: false, config: null, warnings, source: 'absent' };
  let raw;
  let problems;
  try {
    raw = yaml.parse(fs.readFileSync(file, 'utf8')) ?? {};
    problems = validate(raw);
  } catch (error) {
    problems = [`unparseable: ${error.message.split('\n')[0]}`];
  }
  if (problems.length > 0) {
    const previous = readLastValid(directory);
    warnings.push(
      `activity-coordination.yaml invalid (${problems.join('; ')}); ${previous ? 'using last valid configuration' : 'coordination disabled'}`,
    );
    if (!previous || validate(previous).length > 0) return { enabled: false, config: null, warnings, source: 'absent' };
    raw = previous;
    const config = normalize(raw);
    return { enabled: config.enabled, config, warnings, source: 'last-valid' };
  }
  const config = normalize(raw);
  // A disabled contract has no effect at all: nothing is written and a stale snapshot is removed.
  if (config.enabled) writeLastValid(directory, raw);
  else removeLastValid(directory);
  return { enabled: config.enabled, config, warnings, source: config.enabled ? 'file' : 'disabled' };
}

module.exports = { CONFIG_RELATIVE_PATH, DEFAULTS, KINDS, validate, normalize, loadConfig, expandHome };
