'use strict';

const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { z } = require('zod');

/** A single-use capability, confined to one already-admitted parent and child binding. */
async function startCampaignModelBridge({ binding_id, runSubordinate, signal }) {
  z.string().min(1).max(160).parse(binding_id);
  if (typeof runSubordinate !== 'function' || !(signal instanceof AbortSignal) || signal.aborted)
    throw new Error('CONTROL_CAMPAIGN_BRIDGE_INVALID');
  const credential = randomBytes(32).toString('hex');
  const fingerprint = (value) => createHash('sha256').update(value).digest();
  const expected = fingerprint(`Bearer ${credential}`);
  let used = false;
  let closed = false;
  let completed = false;
  const pending = new Set();
  const server = http.createServer({ maxHeaderSize: 4096 }, (request, response) => {
    const reply = (status, value) => {
      if (!response.destroyed) {
        response.writeHead(status, { 'content-type': 'application/json', connection: 'close' });
        response.end(JSON.stringify(value));
      }
    };
    if (!timingSafeEqual(expected, fingerprint(request.headers.authorization || ''))) {
      request.resume();
      return reply(401, { error: 'CONTROL_UNAUTHENTICATED' });
    }
    if (request.method !== 'POST' || request.url !== '/run' || closed || signal.aborted || used) {
      request.resume();
      return reply(409, { error: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
    }
    let body = '';
    request.on('data', (chunk) => {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 16) request.destroy();
    });
    request.once('end', () => {
      if (body !== '{}' || closed || signal.aborted || used) return reply(409, { error: 'CONTROL_CAMPAIGN_SCOPE_DENIED' });
      used = true;
      const operation = (async () => {
        try {
          const result = await runSubordinate({ binding_id });
          const digest = z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .parse(result?.receipt?.evidence_sha256);
          if (result.receipt.status !== 'completed') throw new Error('incomplete');
          completed = true;
          reply(200, { schema_version: 1, evidence_sha256: digest, status: 'completed' });
        } catch {
          reply(409, { error: 'CONTROL_OUTCOME_UNCERTAIN' });
        }
      })();
      pending.add(operation);
      operation.finally(() => pending.delete(operation));
    });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.maxConnections = 8;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  let closing;
  const close = () => {
    if (closing) return closing;
    closed = true;
    closing = (async () => {
      const stopped = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await Promise.all(pending);
      await stopped;
      signal.removeEventListener('abort', onAbort);
    })();
    return closing;
  };
  const onAbort = () => {
    close().catch(() => {});
  };
  signal.addEventListener('abort', onAbort, { once: true });
  if (signal.aborted) {
    await close();
    throw new Error('CONTROL_CAMPAIGN_CANCELLED');
  }
  return { url: `http://127.0.0.1:${server.address().port}`, credential, close, report: () => ({ used, completed }) };
}

module.exports = { startCampaignModelBridge };
