'use strict';

const { randomUUID } = require('node:crypto');

const lsp = require('./lsp');

// Pins are loaded on first use so requiring this package never touches the toolchain cache.
function loadPins() {
  return require('../../tools/lib/environment-toolchain-pins');
}

/** Wire the controller to the real isolated executor and the artifact channel. */
function createDefaultLspService({ policy, toolchain, ledger }) {
  const { executeIsolatedCommand } = require('../agent-isolation-attestation/executor');
  const { createArtifactChannel } = require('../agent-isolation-attestation/artifact-channel');
  return lsp.createLspService({
    policy,
    toolchain,
    ledger,
    execute: executeIsolatedCommand,
    createChannel: () => createArtifactChannel({ media_types: ['application/json'] }),
  });
}

// The debug capability is loaded on first use, so the LSP pack (which does not carry dap.js) still loads this entry.
const loadDap = () => require('./dap');

/** Same wiring for the scripted debug capability. */
function createDefaultDapService({ policy, toolchain, ledger }) {
  const { executeIsolatedCommand } = require('../agent-isolation-attestation/executor');
  const { createArtifactChannel } = require('../agent-isolation-attestation/artifact-channel');
  return loadDap().createDapService({
    policy,
    toolchain,
    ledger,
    execute: executeIsolatedCommand,
    createChannel: () => createArtifactChannel({ media_types: ['application/json'] }),
  });
}

// The browser capability is loaded on first use as well; its pin set and the isolation package stay out of the entry.
const loadBrowser = () => require('./browser');

/** Same wiring for the browser: P2 policy, the mediated egress broker, and a store for screenshots. */
function createDefaultBrowserService({ policy, toolchain, broker, mediaStore, ledger }) {
  const { executeIsolatedCommand } = require('../agent-isolation-attestation/executor');
  const { createArtifactChannel } = require('../agent-isolation-attestation/artifact-channel');
  const { prepareIsolatedExecution } = require('../agent-isolation-attestation');
  const { chromiumSandboxFlags } = require('../agent-isolation-attestation/profiles');
  const { containsCredential } = require('../../tools/cli/lib/campaign-evidence-store');
  return loadBrowser().createBrowserService({
    policy,
    toolchain,
    broker,
    mediaStore,
    ledger,
    containsCredential,
    execute: executeIsolatedCommand,
    createChannel: () => createArtifactChannel({ media_types: ['application/json', 'image/png'] }),
    // The flag is granted only for a genuine supervisor bwrap launch of this policy.
    sandboxFlags: () => [
      ...chromiumSandboxFlags(prepareIsolatedExecution(policy, ['/usr/bin/node', '/opt/hseos/toolchain/host/browser-host.js'], true)),
    ],
  });
}

// Computer-use is loaded on first use too: it brings the approval gate and the terminal executor only when a session starts.
const loadComputer = () => require('./computer');

/**
 * Same wiring for computer-use: the job-mode terminal executor, a media store for screenshots and the per-action
 * approval gate. The operator's display (and the usual defaults) are handed to the host so it can prove it cannot reach them.
 */
function createDefaultComputerService({ policy, toolchain, approvals, mediaStore, ledger, operatorDisplay = process.env.DISPLAY }) {
  const { startIsolatedTerminal } = require('../agent-isolation-attestation/terminal-executor');
  const { containsCredential } = require('../../tools/cli/lib/campaign-evidence-store');
  return loadComputer().createComputerService({
    policy,
    toolchain,
    approvals,
    mediaStore,
    ledger,
    containsCredential,
    startTerminal: startIsolatedTerminal,
    denyDisplays: [
      ...new Set([operatorDisplay, ':0', ':1'].filter((name) => typeof name === 'string' && /^:[0-9]{1,3}(?:\.[0-9]{1,2})?$/u.test(name))),
    ],
  });
}

const SINK_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const REDACTED = '[redacted]';

function sinkFail(message, code = 'ENV_LEDGER_SINK_INVALID') {
  return Object.assign(new Error(message), { code });
}

function redactCredentials(value, containsCredential) {
  if (typeof value === 'string') return containsCredential(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((item) => redactCredentials(item, containsCredential));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, redactCredentials(nested, containsCredential)]));
  }
  return value;
}

/**
 * The `ledger` callback of the environment services, bound to the execution ledger. Each loose `{ type, ...}` event is
 * appended to the `environment_session` stream of one session with its actor and correlation; string values that look
 * like credentials are redacted before they reach the ledger. An append failure (version conflict, unregistered type,
 * sensitive field) is thrown, never swallowed, so the service decides: a mutating action fails closed on it.
 */
function createEnvironmentLedgerSink({
  ledger,
  project_id,
  actor,
  session_id,
  correlation_id = session_id,
  operation_id = null,
  containsCredential,
  now = () => new Date(),
} = {}) {
  if (!ledger || typeof ledger.append !== 'function' || typeof ledger.getVersion !== 'function') {
    throw sinkFail('environment ledger sink requires the execution ledger');
  }
  for (const [name, value] of Object.entries({ project_id, session_id, correlation_id })) {
    if (typeof value !== 'string' || value.length === 0) throw sinkFail(`environment ledger sink requires a non-empty ${name}`);
  }
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) throw sinkFail('environment ledger sink requires an actor object');
  if (operation_id !== null && (typeof operation_id !== 'string' || operation_id.length === 0)) {
    throw sinkFail('environment ledger sink operation_id must be a non-empty string or null');
  }
  if (containsCredential !== undefined && typeof containsCredential !== 'function') {
    throw sinkFail('environment ledger sink containsCredential must be a function');
  }
  if (typeof now !== 'function') throw sinkFail('environment ledger sink now must be a function');
  const scan = containsCredential ?? require('../../tools/cli/lib/campaign-evidence-store').containsCredential;
  let causation = correlation_id;
  return (event) => {
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' || event.type.length === 0) {
      throw sinkFail('environment event requires a type', 'ENV_LEDGER_SINK_EVENT_INVALID');
    }
    const { type, at, ...rest } = event;
    const eventId = randomUUID();
    const result = ledger.append({
      aggregate_type: 'environment_session',
      aggregate_id: session_id,
      expected_version: ledger.getVersion('environment_session', session_id),
      events: [
        {
          event_id: eventId,
          event_type: type,
          schema_version: 1,
          occurred_at: typeof at === 'string' && SINK_ISO.test(at) ? at : now().toISOString(),
          correlation_id,
          causation_id: causation,
          actor,
          operation_id,
          payload: { project_id, ...redactCredentials(rest, scan) },
        },
      ],
    });
    causation = eventId;
    return result;
  };
}

const api = {
  ...lsp,
  createEnvironmentLedgerSink,
  createDefaultLspService,
  createDefaultDapService,
  createDefaultBrowserService,
  createDefaultComputerService,
  loadPins,
};
const dapExports = {
  DAP_CONTRACT: 'CONTRACT',
  parseDapInput: 'parseInput',
  DAP_INPUT_SCHEMA: 'DAP_INPUT_SCHEMA',
  DAP_OUTPUT_SCHEMA: 'DAP_OUTPUT_SCHEMA',
  DapError: 'DapError',
  createDapService: 'createDapService',
  prepareDapToolchain: 'prepareDapToolchain',
};
for (const [name, source] of Object.entries(dapExports))
  Object.defineProperty(api, name, { enumerable: true, get: () => loadDap()[source] });

const browserExports = {
  BROWSER_CONTRACT: ['./browser-contract', 'CONTRACT'],
  BROWSER_INPUT_SCHEMA: ['./browser-contract', 'BROWSER_INPUT_SCHEMA'],
  BROWSER_OUTPUT_SCHEMA: ['./browser-contract', 'BROWSER_OUTPUT_SCHEMA'],
  parseBrowserInput: ['./browser-contract', 'parseInput'],
  BrowserError: ['./browser-contract', 'BrowserError'],
  createBrowserService: ['./browser', 'createBrowserService'],
  prepareBrowserToolchain: ['./browser', 'prepareBrowserToolchain'],
};
for (const [name, [file, source]] of Object.entries(browserExports))
  Object.defineProperty(api, name, { enumerable: true, get: () => require(file)[source] });

const computerExports = {
  COMPUTER_CONTRACT: ['./computer-contract', 'CONTRACT'],
  COMPUTER_INPUT_SCHEMA: ['./computer-contract', 'COMPUTER_INPUT_SCHEMA'],
  COMPUTER_OUTPUT_SCHEMA: ['./computer-contract', 'COMPUTER_OUTPUT_SCHEMA'],
  parseComputerStart: ['./computer-contract', 'parseStart'],
  parseComputerAction: ['./computer-contract', 'parseAction'],
  ComputerError: ['./computer-contract', 'ComputerError'],
  createComputerService: ['./computer', 'createComputerService'],
  prepareComputerToolchain: ['./computer', 'prepareComputerToolchain'],
};
for (const [name, [file, source]] of Object.entries(computerExports))
  Object.defineProperty(api, name, { enumerable: true, get: () => require(file)[source] });

module.exports = api;
