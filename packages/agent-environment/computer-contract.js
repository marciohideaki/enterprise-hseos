'use strict';

// environment.computer.v1: input validation and the shared vocabulary of the computer-use capability.
// Pure data and checks only, so the controller, the sandboxed host and the tests agree on one definition.
const { createHash } = require('node:crypto');

const CONTRACT = 'environment.computer.v1';
const ACTIONS = Object.freeze(['screenshot', 'move', 'click', 'double_click', 'type', 'key', 'scroll']);
// Every action except the read-only screenshot changes what the display shows or what the target receives.
const APPROVED_ACTIONS = Object.freeze(ACTIONS.filter((action) => action !== 'screenshot'));
const LIMITS = Object.freeze({
  min_width: 320,
  max_width: 800,
  min_height: 240,
  max_height: 600,
  min_timeout_ms: 5000,
  max_timeout_ms: 300_000,
  default_timeout_ms: 120_000,
  max_actions: 40,
  // The terminal broker caps the whole session's output at 64 KiB, and PNG bytes travel as base64 inside it.
  max_screenshots: 8,
  max_screenshot_bytes: 14_336,
  max_output_bytes: 65_536,
  max_text_length: 256,
  max_target_args: 8,
  max_target_arg_length: 256,
  max_scroll_amount: 10,
  min_approval_ttl_ms: 1000,
  max_approval_ttl_ms: 300_000,
  default_approval_ttl_ms: 60_000,
});
const DEFAULT_DISPLAY = Object.freeze({ width: 640, height: 400 });
const TARGET_COMMAND = /^\/usr\/bin\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const KEY = /^[A-Za-z0-9_+]{1,48}$/u;
const FIELDS = {
  screenshot: [],
  move: ['x', 'y'],
  click: ['x', 'y', 'button'],
  double_click: ['x', 'y'],
  type: ['text'],
  key: ['key'],
  scroll: ['direction', 'amount'],
};

class ComputerError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ComputerError';
    this.code = code;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const issue = (code, message) => ({ success: false, error: { hseos_code: code, issues: [{ message }] } });
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
const inRange = (value, low, high) => Number.isSafeInteger(value) && value >= low && value <= high;

/** Session start: the display size, the GUI target and the lifetime. Shape only; the sandbox is the controller's business. */
function parseStart(input) {
  const bad = (message) => issue('ENV_COMPUTER_INPUT_INVALID', message);
  if (!isRecord(input)) return bad('input must be an object');
  if (Object.keys(input).some((key) => !['target', 'display', 'timeout_ms'].includes(key))) return bad('input has an unknown field');
  const { target } = input;
  if (!isRecord(target) || Object.keys(target).some((key) => !['command', 'args'].includes(key))) return bad('target must hold a command');
  if (typeof target.command !== 'string' || !TARGET_COMMAND.test(target.command))
    return bad('target command must be an absolute /usr/bin path');
  const args = target.args ?? [];
  if (
    !Array.isArray(args) ||
    args.length > LIMITS.max_target_args ||
    args.some((arg) => typeof arg !== 'string' || arg.length > LIMITS.max_target_arg_length || arg.includes('\0'))
  ) {
    return bad('target args must be a short list of bounded strings');
  }
  const display = input.display ?? DEFAULT_DISPLAY;
  if (!isRecord(display) || Object.keys(display).some((key) => !['width', 'height'].includes(key)))
    return bad('display is outside the supported size');
  if (!inRange(display.width, LIMITS.min_width, LIMITS.max_width) || !inRange(display.height, LIMITS.min_height, LIMITS.max_height)) {
    return bad('display is outside the supported size');
  }
  const timeout = input.timeout_ms ?? LIMITS.default_timeout_ms;
  if (!inRange(timeout, LIMITS.min_timeout_ms, LIMITS.max_timeout_ms)) return bad('timeout_ms is outside the supported range');
  return {
    success: true,
    data: { target: { command: target.command, args }, display: { width: display.width, height: display.height }, timeout_ms: timeout },
  };
}

function actionIssue(action, args, display) {
  const point = () => inRange(args.x, 0, display.width - 1) && inRange(args.y, 0, display.height - 1);
  switch (action) {
    case 'move':
    case 'double_click': {
      return point() ? null : `${action} needs a point inside the display`;
    }
    case 'click': {
      if (!point()) return 'click needs a point inside the display';
      return inRange(args.button, 1, 3) ? null : 'click button must be 1, 2 or 3';
    }
    case 'type': {
      return isText(args.text, LIMITS.max_text_length) ? null : 'type needs bounded text';
    }
    case 'key': {
      return typeof args.key === 'string' && KEY.test(args.key) ? null : 'key needs a key name';
    }
    case 'scroll': {
      if (!['up', 'down'].includes(args.direction)) return 'scroll direction must be up or down';
      return inRange(args.amount, 1, LIMITS.max_scroll_amount) ? null : 'scroll amount is outside the supported range';
    }
    default: {
      return null;
    }
  }
}

/** One action per call. Defaults are filled so that the approval binding digests a single canonical form. */
function parseAction(input, display = DEFAULT_DISPLAY) {
  const bad = (message) => issue('ENV_COMPUTER_INPUT_INVALID', message);
  if (!isRecord(input)) return bad('action must be an object');
  if (!ACTIONS.includes(input.action)) return bad('action is not supported');
  const { action, ...rest } = input;
  if (Object.keys(rest).some((key) => !FIELDS[action].includes(key))) return bad(`${action} has an unknown field`);
  const args = { ...rest };
  if (action === 'click' && args.button === undefined) args.button = 1;
  if (action === 'scroll' && args.amount === undefined) args.amount = 3;
  const problem = actionIssue(action, args, display);
  return problem ? bad(problem) : { success: true, data: { action, args } };
}

const COMPUTER_INPUT_SCHEMA = Object.freeze({ version: 1, safeParse: parseStart });
const HEX64 = /^[0-9a-f]{64}$/u;
const COMPUTER_OUTPUT_SCHEMA = Object.freeze({
  version: 1,
  safeParse: (value) => {
    const media = value?.media ?? [];
    const captures = value?.captures ?? [];
    const known = new Set(captures.map((item) => item.source_ref));
    const untrusted =
      value?.contract === CONTRACT &&
      media.every((item) => item.origin === 'display' && item.authority === 'data' && item.trust === 'untrusted');
    // Every screenshot is tied to a capture that carries the session, the sequence, the UTC time and the digest.
    const traced =
      captures.every(
        (item) =>
          typeof item.source_ref === 'string' &&
          typeof item.session_id === 'string' &&
          Number.isSafeInteger(item.seq) &&
          typeof item.retrieved_at === 'string' &&
          HEX64.test(item.digest) &&
          Array.isArray(item.transform),
      ) && media.every((item) => known.has(item.source_ref));
    return untrusted && traced
      ? { success: true, data: value }
      : {
          success: false,
          error: { hseos_code: 'ENV_COMPUTER_OUTPUT_INVALID', issues: [{ message: 'output is not untrusted display data' }] },
        };
  },
});

module.exports = {
  ACTIONS,
  APPROVED_ACTIONS,
  COMPUTER_INPUT_SCHEMA,
  COMPUTER_OUTPUT_SCHEMA,
  CONTRACT,
  ComputerError,
  DEFAULT_DISPLAY,
  LIMITS,
  canonical,
  parseAction,
  parseStart,
  sha256,
};
