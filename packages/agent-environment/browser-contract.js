'use strict';

// environment.browser.v1: input validation and the shared vocabulary of the browser capability.
// Pure data and checks only, so the controller, the sandboxed host and the tests agree on one definition.
const { createHash } = require('node:crypto');

const CONTRACT = 'environment.browser.v1';
const OPS = Object.freeze(['goto', 'click', 'type', 'press', 'wait_for', 'screenshot', 'dom_snapshot']);
const LOAD_STATES = Object.freeze(['load', 'domcontentloaded', 'networkidle']);
const LIMITS = Object.freeze({
  max_steps: 20,
  max_screenshots: 4,
  max_dom_snapshots: 4,
  min_timeout_ms: 1000,
  max_timeout_ms: 60_000,
  default_timeout_ms: 30_000,
  min_width: 320,
  max_width: 1920,
  min_height: 240,
  max_height: 1080,
  max_url_length: 2048,
  max_selector_length: 512,
  max_text_length: 4096,
  max_dom_chars: 24_000,
});
const DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 720 });
const KEY = /^[A-Za-z0-9+]{1,32}$/u;
const FIELDS = {
  goto: ['op', 'url'],
  click: ['op', 'selector'],
  type: ['op', 'selector', 'text'],
  press: ['op', 'key'],
  wait_for: ['op', 'selector', 'load_state'],
  screenshot: ['op'],
  dom_snapshot: ['op'],
};

class BrowserError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'BrowserError';
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

/** Navigation target: http(s) only, no credentials in the URL, bounded. Returns the parsed URL or null. */
function parseNavigationUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.max_url_length) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && url.hostname !== '' ? url : null;
  } catch {
    return null;
  }
}

/** `host:port` of a navigation URL, the unit the egress allowlist is written in. */
function urlAuthority(url) {
  const port = url.port || (url.protocol === 'https:' ? '443' : '80');
  return `${url.hostname.toLowerCase()}:${port}`;
}

const isText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');

function validateStep(step) {
  if (!step || typeof step !== 'object' || Array.isArray(step)) return 'step must be an object';
  if (!OPS.includes(step.op)) return 'step op is not supported';
  if (Object.keys(step).some((key) => !FIELDS[step.op].includes(key))) return `${step.op} step has an unknown field`;
  switch (step.op) {
    case 'goto': {
      return parseNavigationUrl(step.url) ? null : 'goto needs an http(s) URL without credentials';
    }
    case 'click': {
      return isText(step.selector, LIMITS.max_selector_length) ? null : 'click needs a selector';
    }
    case 'type': {
      if (!isText(step.selector, LIMITS.max_selector_length)) return 'type needs a selector';
      return typeof step.text === 'string' && step.text.length <= LIMITS.max_text_length ? null : 'type needs bounded text';
    }
    case 'press': {
      return typeof step.key === 'string' && KEY.test(step.key) ? null : 'press needs a key name';
    }
    case 'wait_for': {
      const given = ['selector', 'load_state'].filter((key) => step[key] !== undefined);
      if (given.length !== 1) return 'wait_for needs exactly one of selector or load_state';
      if (step.selector !== undefined) return isText(step.selector, LIMITS.max_selector_length) ? null : 'wait_for needs a selector';
      return LOAD_STATES.includes(step.load_state) ? null : 'wait_for load_state is not supported';
    }
    default: {
      return null;
    }
  }
}

/** Shape check only; the allowlist and the sandbox are the controller's business. */
function parseInput(input) {
  const issue = (message) => ({ success: false, error: { hseos_code: 'ENV_BROWSER_INPUT_INVALID', issues: [{ message }] } });
  if (!input || typeof input !== 'object' || Array.isArray(input)) return issue('input must be an object');
  if (Object.keys(input).some((key) => !['steps', 'viewport', 'timeout_ms'].includes(key))) return issue('input has an unknown field');
  if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > LIMITS.max_steps) {
    return issue(`steps must hold 1-${LIMITS.max_steps} entries`);
  }
  for (const step of input.steps) {
    const problem = validateStep(step);
    if (problem) return issue(problem);
  }
  if (input.steps[0].op !== 'goto') return issue('the first step must be a goto');
  if (input.steps.filter((step) => step.op === 'screenshot').length > LIMITS.max_screenshots) return issue('too many screenshot steps');
  if (input.steps.filter((step) => step.op === 'dom_snapshot').length > LIMITS.max_dom_snapshots)
    return issue('too many dom_snapshot steps');
  const viewport = input.viewport === undefined ? DEFAULT_VIEWPORT : input.viewport;
  if (
    !viewport ||
    typeof viewport !== 'object' ||
    Array.isArray(viewport) ||
    Object.keys(viewport).some((key) => !['width', 'height'].includes(key))
  ) {
    return issue('viewport is outside the supported size');
  }
  const { width, height } = viewport;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < LIMITS.min_width ||
    width > LIMITS.max_width ||
    height < LIMITS.min_height ||
    height > LIMITS.max_height
  ) {
    return issue('viewport is outside the supported size');
  }
  const timeout = input.timeout_ms ?? LIMITS.default_timeout_ms;
  if (!Number.isSafeInteger(timeout) || timeout < LIMITS.min_timeout_ms || timeout > LIMITS.max_timeout_ms)
    return issue('timeout_ms is outside the supported range');
  return { success: true, data: { steps: input.steps, viewport: { width, height }, timeout_ms: timeout } };
}

const BROWSER_INPUT_SCHEMA = Object.freeze({ version: 1, safeParse: parseInput });
const HEX64 = /^[0-9a-f]{64}$/u;
const BROWSER_OUTPUT_SCHEMA = Object.freeze({
  version: 1,
  safeParse: (value) => {
    const media = value?.media ?? [];
    const context = value?.context ?? [];
    const captures = value?.captures ?? [];
    const known = new Set(captures.map((item) => item.source_ref));
    const untrusted =
      value?.contract === CONTRACT &&
      media.every((item) => item.origin === 'browser' && item.authority === 'data' && item.trust === 'untrusted') &&
      context.every((item) => item.authority === 'data' && item.provenance?.origin === 'browser' && item.provenance?.trust === 'untrusted');
    // Every part is tied to a capture that carries the final URL, the UTC time and the digest.
    const traced =
      captures.every(
        (item) =>
          typeof item.source_ref === 'string' &&
          typeof item.url === 'string' &&
          typeof item.retrieved_at === 'string' &&
          HEX64.test(item.digest) &&
          Array.isArray(item.transform),
      ) && [...media, ...context].every((item) => known.has(item.source_ref));
    return untrusted && traced
      ? { success: true, data: value }
      : { success: false, error: { hseos_code: 'ENV_BROWSER_OUTPUT_INVALID', issues: [{ message: 'output is not untrusted data' }] } };
  },
});

module.exports = {
  BROWSER_INPUT_SCHEMA,
  BROWSER_OUTPUT_SCHEMA,
  BrowserError,
  CONTRACT,
  DEFAULT_VIEWPORT,
  LIMITS,
  LOAD_STATES,
  OPS,
  canonical,
  parseInput,
  parseNavigationUrl,
  sha256,
  urlAuthority,
};
