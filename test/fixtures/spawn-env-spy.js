'use strict';

// Records the environment every child process is launched with, then runs the real launch unchanged. It must be
// required BEFORE the module under test: those modules destructure spawn/spawnSync/execFileSync at load time.
// A scrubbed-environment launch point is covered by a test only if reverting it to `env: {}` changes what is recorded.
const childProcess = require('node:child_process');

const TOKEN_VAR = 'HSEOS_SUITE_ORPHAN_TOKEN';
const VALID_TOKEN = 'ab12cd34ef56ab12cd34ef56';
const calls = [];

// The environment is copied when the launch is recorded: Node itself adds NODE_V8_COVERAGE to the options object
// afterwards while c8 measures, and that is not something the code under test passed.
function snapshot(env) {
  if (!env) return env;
  const { NODE_V8_COVERAGE: _coverage, ...rest } = env;
  return rest;
}

for (const name of ['spawn', 'spawnSync', 'execFileSync']) {
  const real = childProcess[name];
  childProcess[name] = function recorded(file, ...rest) {
    const options = rest.find((item) => item && typeof item === 'object' && !Array.isArray(item));
    calls.push({ name, file, env: snapshot(options?.env) });
    return real.call(this, file, ...rest);
  };
}

/** Runs `action` with a well-formed supervisor token in the parent and returns the launches it caused. */
function withToken(action, token = VALID_TOKEN) {
  const previous = process.env[TOKEN_VAR];
  process.env[TOKEN_VAR] = token;
  const start = calls.length;
  try {
    const result = action();
    return { result, launches: calls.slice(start) };
  } finally {
    if (previous === undefined) delete process.env[TOKEN_VAR];
    else process.env[TOKEN_VAR] = previous;
  }
}

/** Async variant of withToken: the token stays set while the promise settles. */
async function withTokenAsync(action, token = VALID_TOKEN) {
  const previous = process.env[TOKEN_VAR];
  process.env[TOKEN_VAR] = token;
  const start = calls.length;
  try {
    const result = await action();
    return { result, launches: calls.slice(start) };
  } finally {
    if (previous === undefined) delete process.env[TOKEN_VAR];
    else process.env[TOKEN_VAR] = previous;
  }
}

module.exports = { TOKEN_VAR, VALID_TOKEN, calls, withToken, withTokenAsync };
