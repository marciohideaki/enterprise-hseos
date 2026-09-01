'use strict';

const { canonicalize } = require('../../../../packages/managed-governance-contracts');
const { errorEnvelope, successEnvelope } = require('../../../managed-governance-control-plane/lib/interfaces/http/envelope');

function renderHuman(envelope) {
  if (!envelope.ok) return `ERROR ${envelope.error.code}: ${envelope.error.message}`;
  const lines = ['Managed governance: OK'];
  if (envelope.data !== null) lines.push(JSON.stringify(envelope.data, null, 2));
  for (const warning of envelope.warnings) lines.push(`WARNING: ${typeof warning === 'string' ? warning : JSON.stringify(warning)}`);
  return lines.join('\n');
}

function renderEnvelope(envelope, options = {}) {
  return options.json ? canonicalize(envelope) : renderHuman(envelope);
}

function commandSuccess(data, descriptor = {}) {
  return successEnvelope(data, descriptor);
}

function commandError(code, message) {
  return errorEnvelope(code, message);
}

module.exports = { commandError, commandSuccess, renderEnvelope, renderHuman };
