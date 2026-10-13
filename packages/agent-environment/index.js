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

module.exports = { ...lsp, createDefaultLspService, loadPins };
