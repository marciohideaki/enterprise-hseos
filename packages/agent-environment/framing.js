'use strict';

// Content-Length framing shared by the LSP client and the DAP client (same wire format).
const HEADER_END = Buffer.from('\r\n\r\n');
const DEFAULT_MAX_BODY_BYTES = 8_388_608;
const MAX_HEADER_BYTES = 1024;

class FramingError extends Error {
  constructor(message, code = 'ENV_FRAMING_INVALID') {
    super(message);
    this.name = 'FramingError';
    this.code = code;
  }
}

function encodeMessage(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

function contentLength(header) {
  let length = null;
  for (const line of header.split('\r\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) throw new FramingError('malformed header line');
    if (line.slice(0, separator).trim().toLowerCase() !== 'content-length') continue;
    const value = line.slice(separator + 1).trim();
    if (length !== null || !/^[0-9]{1,10}$/.test(value)) throw new FramingError('invalid Content-Length');
    length = Number(value);
  }
  if (length === null) throw new FramingError('missing Content-Length');
  return length;
}

/** Incremental parser: push(chunk) returns the complete messages decoded so far. Any violation throws. */
function createFrameParser({ maxBodyBytes = DEFAULT_MAX_BODY_BYTES } = {}) {
  let buffer = Buffer.alloc(0);
  return {
    push(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      const messages = [];
      while (buffer.length > 0) {
        const end = buffer.indexOf(HEADER_END);
        if (end === -1) {
          if (buffer.length > MAX_HEADER_BYTES) throw new FramingError('header is too large');
          break;
        }
        if (end > MAX_HEADER_BYTES) throw new FramingError('header is too large');
        const length = contentLength(buffer.subarray(0, end).toString('ascii'));
        if (length > maxBodyBytes) throw new FramingError('message body exceeds its limit', 'ENV_FRAMING_TOO_LARGE');
        const start = end + HEADER_END.length;
        if (buffer.length < start + length) break;
        try {
          messages.push(JSON.parse(buffer.subarray(start, start + length).toString('utf8')));
        } catch {
          throw new FramingError('message body is not JSON');
        }
        buffer = buffer.subarray(start + length);
      }
      return messages;
    },
  };
}

module.exports = { FramingError, createFrameParser, encodeMessage };
