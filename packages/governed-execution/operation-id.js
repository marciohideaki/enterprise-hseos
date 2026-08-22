'use strict';

const { createHash } = require('node:crypto');

function deterministicOperationId(tool, idempotencyKey) {
  const hex = createHash('sha256').update(`${tool}\0${idempotencyKey}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

module.exports = { deterministicOperationId };
