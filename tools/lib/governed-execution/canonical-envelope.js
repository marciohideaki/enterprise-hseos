'use strict';

class CanonicalEnvelopeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanonicalEnvelopeError';
    this.code = 'EXECUTION_ENVELOPE_INVALID';
  }
}

function executionEnvelope({ ok, data = null, error = null, evidence = [], warnings = [] }) {
  return {
    schema_version: 1,
    ok,
    data,
    error,
    evidence: [...new Set(evidence)],
    warnings: [...new Set(warnings)],
  };
}

function failureEnvelope(error, operationId = null, evidence = [], warnings = []) {
  const candidate = error && typeof error === 'object' ? error : {};
  const fallbackMessage = error === undefined || error === null ? 'Execution failed' : String(error);
  return executionEnvelope({
    ok: false,
    error: {
      code: typeof candidate.code === 'string' && candidate.code ? candidate.code : 'EXECUTION_FAILED',
      message:
        typeof candidate.message === 'string' && candidate.message ? candidate.message : fallbackMessage,
      operation_id: operationId,
      retryable: Boolean(candidate.retryable),
    },
    evidence,
    warnings,
  });
}

function assertCanonicalEnvelope(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    throw new CanonicalEnvelopeError('Execution port returned an invalid envelope');
  }
  const expectedKeys = ['data', 'error', 'evidence', 'ok', 'schema_version', 'warnings'];
  if (Object.keys(outcome).sort().join('\0') !== expectedKeys.join('\0')) {
    throw new CanonicalEnvelopeError('Execution port returned a non-canonical envelope');
  }
  if (
    outcome.schema_version !== 1 ||
    typeof outcome.ok !== 'boolean' ||
    !Array.isArray(outcome.evidence) ||
    !outcome.evidence.every((item) => typeof item === 'string') ||
    new Set(outcome.evidence).size !== outcome.evidence.length ||
    !Array.isArray(outcome.warnings) ||
    !outcome.warnings.every((item) => typeof item === 'string') ||
    new Set(outcome.warnings).size !== outcome.warnings.length
  ) {
    throw new CanonicalEnvelopeError('Execution port returned an invalid envelope');
  }
  if (outcome.ok) {
    if (
      !outcome.data ||
      typeof outcome.data !== 'object' ||
      Array.isArray(outcome.data) ||
      Object.keys(outcome.data).sort().join('\0') !== ['operation_id', 'replayed', 'result'].join('\0') ||
      typeof outcome.data.operation_id !== 'string' ||
      outcome.data.operation_id.length === 0 ||
      typeof outcome.data.replayed !== 'boolean' ||
      outcome.error !== null
    ) {
      throw new CanonicalEnvelopeError('Execution port returned an invalid success envelope');
    }
  } else if (
    outcome.data !== null ||
    !outcome.error ||
    typeof outcome.error !== 'object' ||
    Array.isArray(outcome.error) ||
    typeof outcome.error.code !== 'string' ||
    outcome.error.code.length === 0 ||
    typeof outcome.error.message !== 'string' ||
    outcome.error.message.length === 0 ||
    typeof outcome.error.retryable !== 'boolean' ||
    Object.keys(outcome.error).sort().join('\0') !== ['code', 'message', 'operation_id', 'retryable'].join('\0') ||
    !(
      outcome.error.operation_id === null ||
      (typeof outcome.error.operation_id === 'string' && outcome.error.operation_id.length > 0)
    )
  ) {
    throw new CanonicalEnvelopeError('Execution port returned an invalid failure envelope');
  }
  return outcome;
}

module.exports = { assertCanonicalEnvelope, CanonicalEnvelopeError, executionEnvelope, failureEnvelope };
