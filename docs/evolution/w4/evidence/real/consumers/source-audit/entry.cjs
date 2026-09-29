'use strict';

const { createHash } = require('node:crypto');

function audit(input) {
  if (typeof input?.text !== 'string' || Buffer.byteLength(input.text, 'utf8') > 32_768)
    throw new Error('source text must be a UTF-8 string of at most 32 KiB');
  const text = input.text.replaceAll('\r\n', '\n');
  const lines = text.split('\n');
  return {
    sha256: createHash('sha256').update(text).digest('hex'),
    lines: lines.length,
    nonempty_lines: lines.filter((line) => line.trim().length > 0).length,
    review_markers: lines.filter((line) => /\b(?:TODO|FIXME)\b/.test(line)).length,
  };
}

function execute({ method, input }) {
  if (method === 'conformance') {
    const sample = audit({ text: 'alpha\nTODO: beta' });
    return { passed: sample.lines === 2 && sample.nonempty_lines === 2 && sample.review_markers === 1 };
  }
  return audit(input);
}

module.exports = execute;
