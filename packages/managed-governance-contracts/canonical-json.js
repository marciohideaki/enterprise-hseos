'use strict';

const crypto = require('node:crypto');

class CanonicalJsonError extends TypeError {
  constructor(message, path = '$') {
    super(`${message} at ${path}`);
    this.name = 'CanonicalJsonError';
    this.code = 'MANAGED_GOVERNANCE_CANONICAL_JSON_INVALID';
    this.path = path;
  }
}

function assertWellFormedString(value, path) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalJsonError('string contains an unpaired high surrogate', path);
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalJsonError('string contains an unpaired low surrogate', path);
    }
  }
}

function encode(value, path, ancestors) {
  if (value === null) return 'null';

  if (typeof value === 'string') {
    assertWellFormedString(value, path);
    return JSON.stringify(value);
  }

  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new CanonicalJsonError('number must be finite', path);
    if (Object.is(value, -0)) throw new CanonicalJsonError('negative zero is not supported', path);
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new CanonicalJsonError('integer exceeds the lossless JavaScript range', path);
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw new CanonicalJsonError(`unsupported value type ${typeof value}`, path);
  }

  if (ancestors.has(value)) throw new CanonicalJsonError('cyclic value is not supported', path);
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const propertyNames = Object.getOwnPropertyNames(value);
      const hasUnexpectedProperty = propertyNames.some((name) => {
        if (name === 'length') return false;
        if (!/^(?:0|[1-9]\d*)$/.test(name)) return true;
        const index = Number(name);
        return !Number.isSafeInteger(index) || index < 0 || index >= value.length || String(index) !== name;
      });
      if (hasUnexpectedProperty || propertyNames.length !== value.length + 1) {
        throw new CanonicalJsonError('arrays cannot contain extra properties', path);
      }
      const encoded = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) {
          throw new CanonicalJsonError('sparse arrays are not supported', `${path}[${index}]`);
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
          throw new CanonicalJsonError('array accessors are not supported', `${path}[${index}]`);
        }
        encoded.push(encode(descriptor.value, `${path}[${index}]`, ancestors));
      }
      return `[${encoded.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalJsonError('only plain JSON objects are supported', path);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new CanonicalJsonError('symbol keys are not supported', path);
    }

    const propertyNames = Object.getOwnPropertyNames(value);
    const keys = Object.keys(value).sort();
    if (propertyNames.length !== keys.length) {
      throw new CanonicalJsonError('non-enumerable properties are not supported', path);
    }
    const encoded = keys.map((key) => {
      assertWellFormedString(key, `${path}.[key]`);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
        throw new CanonicalJsonError('object accessors are not supported', `${path}.${key}`);
      }
      return `${JSON.stringify(key)}:${encode(descriptor.value, `${path}.${key}`, ancestors)}`;
    });
    return `{${encoded.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalize(value) {
  return encode(value, '$', new Set());
}

function digestCanonical(value) {
  return `sha256:${crypto.createHash('sha256').update(canonicalize(value), 'utf8').digest('hex')}`;
}

module.exports = {
  CanonicalJsonError,
  canonicalize,
  digestCanonical,
};
