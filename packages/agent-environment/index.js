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

const api = { ...lsp, createDefaultLspService, createDefaultDapService, loadPins };
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

module.exports = api;
