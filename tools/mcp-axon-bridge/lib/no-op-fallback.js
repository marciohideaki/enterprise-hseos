'use strict';

function noOpResponse(toolName) {
  return {
    results: [],
    fallback: true,
    reason: 'axon binary not found — install axon or set AXON_BIN env var',
    tool: toolName,
  };
}

module.exports = { noOpResponse };
