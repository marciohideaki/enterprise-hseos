'use strict';

function verify(input) {
  if (typeof input?.instruction !== 'string' || Buffer.byteLength(input.instruction, 'utf8') > 32_768)
    throw new Error('instruction must be a UTF-8 string of at most 32 KiB');
  let request;
  try {
    request = JSON.parse(input.instruction);
  } catch {
    throw new Error('instruction must contain a JSON verification request');
  }
  if (
    !request ||
    typeof request !== 'object' ||
    Array.isArray(request) ||
    typeof request.artifact_sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(request.artifact_sha256) ||
    !Number.isSafeInteger(request.line_count) ||
    request.line_count < 0 ||
    !Number.isSafeInteger(request.max_lines) ||
    request.max_lines < 0
  )
    throw new Error('invalid verification request');
  const accepted = request.line_count <= request.max_lines;
  return {
    text: JSON.stringify({
      artifact_sha256: request.artifact_sha256,
      accepted,
      reason: accepted ? 'within_line_limit' : 'line_limit_exceeded',
    }),
  };
}

function execute({ method, input }) {
  if (method === 'conformance') {
    const sample = verify({ instruction: JSON.stringify({ artifact_sha256: 'a'.repeat(64), line_count: 2, max_lines: 2 }) });
    return { passed: JSON.parse(sample.text).accepted === true };
  }
  return verify(input);
}

module.exports = execute;
