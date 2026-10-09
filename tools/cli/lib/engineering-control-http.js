'use strict';

const http = require('node:http');
const { createHash, timingSafeEqual } = require('node:crypto');

const NOT_FOUND_CODES = new Set(['CONTROL_TASK_NOT_FOUND', 'JOB_NOT_FOUND', 'CONTROL_TERMINAL_NOT_FOUND', 'CONTROL_CAMPAIGN_NOT_FOUND']);

async function startControlServer({ control, credential, port = 0 }) {
  if (typeof credential !== 'string' || credential.length < 32 || !Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error('A local control credential and valid port are required');
  const expected = createHash('sha256').update(`Bearer ${credential}`).digest();
  const server = http.createServer(async (request, response) => {
    const send = (status, body) => {
      if (response.destroyed) return;
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(JSON.stringify(body));
    };
    try {
      const received = createHash('sha256')
        .update(request.headers.authorization || '')
        .digest();
      if (!timingSafeEqual(expected, received)) return send(401, { error: 'CONTROL_UNAUTHENTICATED' });
      if (request.headers.origin || !/^127\.0\.0\.1:\d+$/.test(request.headers.host || ''))
        return send(403, { error: 'CONTROL_ORIGIN_DENIED' });
      const url = new URL(request.url, 'http://127.0.0.1');
      if (
        request.method === 'POST' &&
        ['/v1/commands', '/v1/prepare', '/v1/terminals/commands', '/v1/provider-campaigns/commands', '/v1/jobs/commands'].includes(
          url.pathname,
        ) &&
        url.search === ''
      ) {
        if (request.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: 'CONTROL_JSON_REQUIRED' });
        const parts = [];
        let bytes = 0;
        for await (const part of request) {
          bytes += part.length;
          if (bytes > 2_097_152) return send(413, { error: 'CONTROL_REQUEST_LIMIT' });
          parts.push(part);
        }
        const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
        if (url.pathname === '/v1/jobs/commands' && ['create', 'retry'].includes(body?.action)) {
          const kind = body.input?.kind;
          const parsed = require('./engineering-control').parseCreationInput(
            kind === 'task' ? 'create' : 'create_workflow',
            body.input?.definition,
          );
          const contracts = kind === 'task' ? [parsed.contract] : parsed.definition.tasks.map((task) => task.contract);
          if (contracts.some((contract) => contract.initial_files.length > 0)) {
            const error = new Error('JOB_INLINE_CODE_DENIED');
            error.code = 'JOB_INLINE_CODE_DENIED';
            throw error;
          }
        }
        return send(
          200,
          url.pathname === '/v1/prepare'
            ? control.prepare(body)
            : url.pathname === '/v1/terminals/commands'
              ? await control.terminals.execute(body)
              : url.pathname === '/v1/provider-campaigns/commands'
                ? await control.providerCampaigns.execute(body)
                : url.pathname === '/v1/jobs/commands'
                  ? await control.jobs.execute(body)
                  : await control.execute(body),
        );
      }
      if (request.method === 'GET' && url.pathname === '/v1/provider-bindings') {
        if ([...url.searchParams.keys()].some((name) => name !== 'binding_id') || url.searchParams.getAll('binding_id').length !== 1)
          return send(400, { error: 'CONTROL_QUERY_INVALID' });
        try {
          return send(200, control.providerCampaigns.inspect(url.searchParams.get('binding_id')));
        } catch (error) {
          if (error.code === 'CONTROL_PROVIDER_BINDING_UNKNOWN') return send(404, { error: error.code });
          throw error;
        }
      }
      const campaign = /^\/v1\/provider-campaigns\/([a-f0-9-]{36})(?:\/(events|evidence))?$/.exec(url.pathname);
      if (request.method === 'GET' && campaign) {
        if (campaign[2] === 'evidence') {
          if ([...url.searchParams.keys()].some((name) => name !== 'command_id') || url.searchParams.getAll('command_id').length !== 1)
            return send(400, { error: 'CONTROL_QUERY_INVALID' });
          return send(200, control.providerCampaigns.evidence(campaign[1], url.searchParams.get('command_id')));
        }
        if (campaign[2]) {
          if ([...url.searchParams.keys()].some((name) => !['after', 'limit'].includes(name)))
            return send(400, { error: 'CONTROL_QUERY_INVALID' });
          return send(
            200,
            control.providerCampaigns.events(campaign[1], {
              after: Number(url.searchParams.get('after') || 0),
              limit: Number(url.searchParams.get('limit') || 100),
            }),
          );
        }
        if (url.search) return send(400, { error: 'CONTROL_QUERY_INVALID' });
        return send(200, control.providerCampaigns.query(campaign[1]));
      }
      const job = /^\/v1\/jobs\/([a-f0-9-]{36})(?:\/(events))?$/.exec(url.pathname);
      if (request.method === 'GET' && job) {
        if (job[2]) {
          if ([...url.searchParams.keys()].some((name) => !['after', 'limit'].includes(name)))
            return send(400, { error: 'CONTROL_QUERY_INVALID' });
          return send(
            200,
            control.jobs.events(job[1], {
              after: Number(url.searchParams.get('after') || 0),
              limit: Number(url.searchParams.get('limit') || 100),
            }),
          );
        }
        if (url.search) return send(400, { error: 'CONTROL_QUERY_INVALID' });
        return send(200, control.jobs.query(job[1]));
      }
      const terminal = /^\/v1\/terminals\/([a-f0-9-]{36})(?:\/(events))?$/.exec(url.pathname);
      if (request.method === 'GET' && terminal) {
        if (terminal[2]) {
          if ([...url.searchParams.keys()].some((name) => !['after', 'limit'].includes(name)))
            return send(400, { error: 'CONTROL_QUERY_INVALID' });
          return send(
            200,
            control.terminals.events(terminal[1], {
              after: Number(url.searchParams.get('after') || 0),
              limit: Number(url.searchParams.get('limit') || 100),
            }),
          );
        }
        if (url.search) return send(400, { error: 'CONTROL_QUERY_INVALID' });
        return send(200, control.terminals.query(terminal[1]));
      }
      const match = /^\/v1\/tasks\/([a-f0-9-]{36})(?:\/(evidence|review|events|session))?$/.exec(url.pathname);
      if (request.method === 'GET' && match) {
        if (match[2] === 'events') {
          if ([...url.searchParams.keys()].some((name) => !['after', 'limit'].includes(name)))
            return send(400, { error: 'CONTROL_QUERY_INVALID' });
          const after = Number(url.searchParams.get('after') || 0),
            limit = Number(url.searchParams.get('limit') || 100);
          return send(200, control.events(match[1], { after, limit }));
        }
        if (url.search) return send(400, { error: 'CONTROL_QUERY_INVALID' });
        return send(200, await control.query(match[1], match[2] || 'status'));
      }
      return send(404, { error: 'CONTROL_ROUTE_UNKNOWN' });
    } catch (error) {
      const code = typeof error.code === 'string' && /^(?:CONTROL|JOB)_[A-Z_]+$/.test(error.code) ? error.code : 'CONTROL_REQUEST_REJECTED';
      // Unknown resource -> 404, malformed query -> 400, any other rejection -> 409 (docs/engineering-control-api.md).
      return send(NOT_FOUND_CODES.has(code) ? 404 : code === 'CONTROL_QUERY_INVALID' ? 400 : 409, { error: code });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      }),
  };
}

module.exports = { startControlServer };
