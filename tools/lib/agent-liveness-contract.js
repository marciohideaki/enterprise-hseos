'use strict';

/**
 * Agent liveness contract ("no silent idle"): configuration schema and the
 * validator for the final `LIVENESS:` line every dispatched agent must emit.
 *
 * Spec: .specs/features/harness-w5/liveness.md. A missing or `enabled: false`
 * contract means the current behavior is kept unchanged (callers must check
 * `loadLivenessConfig(...).enabled` before acting).
 */

const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { z } = require('zod');

const CONFIG_RELATIVE_PATH = path.join('.hseos', 'config', 'agent-liveness.yaml');
const BASH_FOREGROUND_LIMIT_S = 600;
const LIVENESS_STATES = Object.freeze(['DONE', 'BLOCKED', 'FAILED', 'WAITING_ON']);
const REASON_CODES = Object.freeze([
  'declared',
  'no_state_at_stop',
  'invalid_liveness_line',
  'background_task_active',
  'foreground_cap_exceeded',
  'wait_deadline_exceeded',
  'wake_exhausted',
  'evidence_unverified',
  'blocked_pending',
  'guard_internal_error',
  'stall_no_activity',
  'heartbeat_lease_expired',
  'waiting_on_declared',
]);
// The reason_code a LIVENESS report may carry for each declared state.
const STATE_REASON_CODES = Object.freeze({
  DONE: 'declared',
  FAILED: 'declared',
  BLOCKED: 'blocked_pending',
  WAITING_ON: 'waiting_on_declared',
});
const WAKE_VIA = Object.freeze(['commander', 'human']);
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const DEFAULTS = Object.freeze({
  enabled: false,
  foreground_wait_max_s: 540,
  stall_timeout_s: 900,
  heartbeat_ttl_s: 300,
  watch_interval_s: 120,
  max_stop_refusals: 2,
  max_wake_attempts: 3,
  max_wakes_per_cycle: 3,
  max_wait_deadline_s: 14_400,
  max_notify_attempts: 10,
  escalate_to: 'human',
});

const configSchema = z
  .object({
    enabled: z.boolean(),
    foreground_wait_max_s: z
      .number()
      .int()
      .min(1)
      .max(BASH_FOREGROUND_LIMIT_S - 10),
    stall_timeout_s: z.number().int().min(60).max(86_400),
    heartbeat_ttl_s: z.number().int().min(30).max(86_400),
    watch_interval_s: z.number().int().min(5).max(3600),
    max_stop_refusals: z.number().int().min(0).max(10),
    max_wake_attempts: z.number().int().min(1).max(10),
    max_wakes_per_cycle: z.number().int().min(1).max(50),
    max_wait_deadline_s: z.number().int().min(60).max(604_800),
    max_notify_attempts: z.number().int().min(1).max(100),
    escalate_to: z.enum(['human']),
  })
  .partial()
  .strict();

function formatIssues(error) {
  return error.issues.map((issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`);
}

/**
 * Validate a parsed config document and merge it over the defaults.
 * @param {unknown} document
 * @returns {{ ok: boolean, config: object, errors: string[] }}
 */
function validateLivenessConfig(document) {
  const parsed = configSchema.safeParse(document ?? {});
  if (!parsed.success) return { ok: false, config: { ...DEFAULTS }, errors: formatIssues(parsed.error) };
  const config = { ...DEFAULTS, ...parsed.data };
  const errors = [];
  if (config.heartbeat_ttl_s > config.stall_timeout_s) errors.push('heartbeat_ttl_s must not exceed stall_timeout_s');
  if (config.watch_interval_s > config.stall_timeout_s) errors.push('watch_interval_s must not exceed stall_timeout_s');
  if (config.max_wait_deadline_s < config.stall_timeout_s) errors.push('max_wait_deadline_s must not be below stall_timeout_s');
  return errors.length > 0 ? { ok: false, config: { ...DEFAULTS }, errors } : { ok: true, config, errors };
}

/**
 * Load `<directory>/.hseos/config/agent-liveness.yaml`.
 * Absent file => disabled defaults (current behavior). Invalid file => `valid: false`
 * and `enabled: false`, so callers fail open and surface `errors`.
 * @param {string} directory
 * @returns {{ present: boolean, valid: boolean, enabled: boolean, path: string, config: object, errors: string[] }}
 */
function loadLivenessConfig(directory) {
  const file = path.join(directory, CONFIG_RELATIVE_PATH);
  if (!fs.existsSync(file)) {
    return { present: false, valid: true, enabled: false, path: file, config: { ...DEFAULTS }, errors: [] };
  }
  let document;
  try {
    document = yaml.load(fs.readFileSync(file, 'utf8'), { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    return { present: true, valid: false, enabled: false, path: file, config: { ...DEFAULTS }, errors: [`yaml: ${error.message}`] };
  }
  const result = validateLivenessConfig(document);
  return {
    present: true,
    valid: result.ok,
    enabled: result.ok && result.config.enabled === true,
    path: file,
    config: result.config,
    errors: result.errors,
  };
}

const LAST_VALID_RELATIVE_PATH = path.join('.hseos', 'state', 'liveness', 'last-valid-config.json');

/**
 * Load the contract fresh on every call (no cache). With `remember` (report and watch only,
 * never read-only commands) a valid config is remembered on disk;
 * when the file later becomes invalid the last valid one keeps governing and `warnings`
 * says so. A disabled contract with no remembered config creates no state at all.
 * @param {string} directory
 */
function loadLivenessConfigWithFallback(directory, { remember = false } = {}) {
  const loaded = loadLivenessConfig(directory);
  const remembered = path.join(directory, LAST_VALID_RELATIVE_PATH);
  loaded.warnings = [];
  if (loaded.valid) {
    if (remember && loaded.present && (loaded.enabled || fs.existsSync(remembered))) {
      fs.mkdirSync(path.dirname(remembered), { recursive: true, mode: 0o700 });
      fs.writeFileSync(remembered, `${JSON.stringify(loaded.config)}\n`, { mode: 0o600 });
    }
    return loaded;
  }
  let previous = null;
  try {
    previous = validateLivenessConfig(JSON.parse(fs.readFileSync(remembered, 'utf8')));
  } catch {
    /* nothing remembered or unreadable */
  }
  if (!previous?.ok) return loaded;
  loaded.warnings.push(`agent-liveness.yaml is invalid (${loaded.errors.join('; ')}); using the last valid configuration`);
  return { ...loaded, valid: true, fallback: true, enabled: previous.config.enabled === true, config: previous.config };
}

const isoString = z.string().refine((value) => ISO_8601.test(value) && !Number.isNaN(Date.parse(value)), 'must be an ISO-8601 timestamp');

const waitingOnSchema = z
  .object({
    condition: z.string().trim().min(1).max(1000),
    wake_via: z.enum(WAKE_VIA),
    deadline_at: isoString,
  })
  .strict();

const livenessSchema = z
  .object({
    state: z.enum(LIVENESS_STATES),
    reason: z.string().trim().min(1).max(2000),
    evidence: z.string().trim().min(1).max(2000).optional(),
    waiting_on: waitingOnSchema.optional(),
  })
  .strict();

/**
 * Pull the last `LIVENESS: {...}` line out of a free-form final message.
 * Returns null when there is none. The state is never inferred from prose.
 * @param {string} text
 * @returns {string|null} the JSON portion
 */
function extractLivenessLine(text) {
  if (typeof text !== 'string') return null;
  let found = null;
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*LIVENESS:\s*(\{.*\})\s*$/.exec(line);
    if (match) found = match[1];
  }
  return found;
}

/**
 * Validate a LIVENESS line against the contract.
 * @param {string|object} input JSON text (optionally prefixed with `LIVENESS:`), a multi-line message, or an object
 * @param {{ now?: number, stallTimeoutS?: number }} [options]
 * @returns {{ ok: boolean, value?: object, errors: string[] }}
 */
function parseLivenessLine(
  input,
  { now = Date.now(), stallTimeoutS = DEFAULTS.stall_timeout_s, maxWaitDeadlineS = DEFAULTS.max_wait_deadline_s } = {},
) {
  let raw = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    const json = extractLivenessLine(trimmed) ?? trimmed.replace(/^LIVENESS:\s*/, '');
    try {
      raw = JSON.parse(json);
    } catch (error) {
      return { ok: false, errors: [`invalid JSON: ${error.message}`] };
    }
  }
  const parsed = livenessSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };
  const value = parsed.data;
  const errors = [];
  if (value.state === 'WAITING_ON' && !value.waiting_on) errors.push('waiting_on is required when state is WAITING_ON');
  if (value.state !== 'WAITING_ON' && value.waiting_on) errors.push('waiting_on is forbidden unless state is WAITING_ON');
  if (value.state === 'DONE' && !value.evidence) errors.push('evidence is required when state is DONE');
  if (value.waiting_on) {
    const deadline = Date.parse(value.waiting_on.deadline_at);
    if (deadline <= now) errors.push('waiting_on.deadline_at must be in the future');
    else {
      // Waiting on the Commander or the human may take longer than silence is tolerated.
      const decisionWait = value.waiting_on.wake_via === 'commander' || value.waiting_on.wake_via === 'human';
      const limitS = decisionWait ? maxWaitDeadlineS : stallTimeoutS;
      if (deadline > now + limitS * 1000) {
        errors.push(`waiting_on.deadline_at exceeds ${decisionWait ? 'max_wait_deadline_s' : 'stall_timeout_s'} (${limitS}s) from now`);
      }
    }
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value, errors };
}

module.exports = {
  BASH_FOREGROUND_LIMIT_S,
  CONFIG_RELATIVE_PATH,
  DEFAULTS,
  LIVENESS_STATES,
  REASON_CODES,
  STATE_REASON_CODES,
  WAKE_VIA,
  extractLivenessLine,
  loadLivenessConfig,
  loadLivenessConfigWithFallback,
  parseLivenessLine,
  validateLivenessConfig,
};
