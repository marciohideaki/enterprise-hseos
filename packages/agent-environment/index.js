'use strict';

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

const api = { ...lsp, createDefaultLspService, createDefaultDapService, createDefaultBrowserService, loadPins };
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

module.exports = api;
