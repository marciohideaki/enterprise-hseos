'use strict';
// Pure check of the context window a binding declares against what the backend actually serves.
// A missing or invalid measurement (effective context, model window, largest request) is `unknown`, never approved.
// The adapter estimates a request in bytes, so the admission check compares the largest request in bytes plus the output cap
// with the declared window.
const isCount = (value) => Number.isInteger(value) && value >= 0;
const isPositive = (value) => Number.isInteger(value) && value > 0;

function evaluateWindow({ declaredContextTokens, maxOutputTokens, modelWindow, effectiveContext, largestRequestBytes }) {
  const failures = [];
  const declaredValid = isPositive(declaredContextTokens);
  const outputValid = isCount(maxOutputTokens);
  const effectiveKnown = isPositive(effectiveContext);
  const modelWindowKnown = isPositive(modelWindow);
  const requestKnown = isPositive(largestRequestBytes);
  if (!declaredValid) failures.push('declared-context-invalid');
  if (!outputValid) failures.push('max-output-invalid');
  if (declaredValid && effectiveKnown && declaredContextTokens > effectiveContext) failures.push('declaration-exceeds-backend');
  if (declaredValid && modelWindowKnown && declaredContextTokens > modelWindow) failures.push('declaration-exceeds-model-window');
  if (declaredValid && outputValid && requestKnown && largestRequestBytes + maxOutputTokens > declaredContextTokens)
    failures.push('admission-exceeded');
  const unknown = [];
  if (!effectiveKnown) unknown.push('effective-context');
  if (!modelWindowKnown) unknown.push('model-window');
  if (!requestKnown) unknown.push('largest-request-bytes');
  const verdict = failures.length > 0 ? 'fail' : unknown.length > 0 ? 'unknown' : 'pass';
  return {
    verdict,
    failures,
    unknown,
    declared_context_tokens: declaredContextTokens ?? null,
    max_output_tokens: maxOutputTokens ?? null,
    model_window: modelWindowKnown ? modelWindow : null,
    effective_context: effectiveKnown ? effectiveContext : null,
    largest_request_bytes: requestKnown ? largestRequestBytes : null,
  };
}

module.exports = { evaluateWindow };
