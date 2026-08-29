'use strict';

const { createHash } = require('node:crypto');

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;
}

function stableId(prefix, ...parts) {
  const value = createHash('sha256').update(parts.map(canonicalJson).join('\0')).digest('hex').slice(0, 32);
  return `${prefix}:${value}`;
}

function eventRef(eventId) {
  return `session-event://${eventId}`;
}

module.exports = { canonicalJson, digest, eventRef, stableId };
