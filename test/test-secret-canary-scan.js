'use strict';

// Exhaustive byte scan: a synthetic canary injected through the legitimate credential path
// may appear only in the Authorization header the provider receives, nowhere else.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const yaml = require('yaml');

const { runSupervisedBoundKernel } = require('../tools/cli/lib/bound-kernel-supervisor');
const { openExecutionLedgerFileFixture } = require('../tools/mcp-project-state/lib/execution-ledger-schema');
const { toWireToolName } = require('../packages/model-providers/openai-compatible-provider');

const ROOT = path.join(__dirname, '..');
const EXAMPLE = path.join(ROOT, '.agents', 'activation', 'provider-bindings', 'openai-compatible.example.yaml');
const CANARY = 'hseos-canary-3f9a1c7e5b2d48a09e6c1d7b4a85f032';
const NEEDLES = [
  ['raw', Buffer.from(CANARY, 'utf8')],
  ['base64', Buffer.from(Buffer.from(CANARY, 'utf8').toString('base64'), 'utf8')],
  ['hex', Buffer.from(Buffer.from(CANARY, 'utf8').toString('hex'), 'utf8')],
];

function fixture(t, endpoint) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-canary-'));
  fs.chmodSync(directory, 0o700);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const binary = path.join(directory, 'ai-jail-fixture');
  fs.writeFileSync(
    binary,
    ['#!/bin/sh', 'while [ "$#" -gt 0 ]; do', '  if [ "$1" = "--" ]; then shift; exec "$@"; fi', '  shift', 'done', 'exit 64', ''].join(
      '\n',
    ),
    { encoding: 'utf8', mode: 0o700 },
  );
  const configDirectory = path.join(directory, '.hseos', 'config');
  fs.mkdirSync(configDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(configDirectory, 'hseos.config.yaml'),
    yaml.stringify({
      sandbox: {
        provider: 'ai-jail',
        binary,
        required: true,
        default_profile: 'lockdown',
        profiles: {
          lockdown: {
            flags: ['--lockdown', '--no-save-config', '--exec'],
            masks: ['.env', '.env.local', 'credentials.json', 'secrets.yml'],
            ro_maps: [],
            rw_maps: [],
            allow_tcp_ports: [],
          },
        },
      },
    }),
    { encoding: 'utf8', mode: 0o600 },
  );
  const binding = yaml.parse(fs.readFileSync(EXAMPLE, 'utf8'));
  binding.binding_id = 'provider-binding:canary-fixture';
  binding.provider.base_url = endpoint;
  binding.provider.model = 'fixture/canary';
  binding.transport.max_attempts = 1;
  binding.transport.retry_delay_ms = 0;
  const bindingPath = path.join(directory, 'binding.yaml');
  fs.writeFileSync(bindingPath, yaml.stringify(binding), { encoding: 'utf8', mode: 0o600 });
  return { bindingPath, directory };
}

function readiness() {
  return async () => ({
    ok: true,
    provider: 'ai-jail',
    required: true,
    configured: true,
    checks: [{ id: 'fixture', ok: true, required: true }],
    warnings: [],
    errors: [],
  });
}

function sendSse(response, frames) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'canary-fixture' });
  for (const frame of frames) response.write(`data: ${JSON.stringify(frame)}\n\n`);
  response.end('data: [DONE]\n\n');
}

async function providerServer(t, observed, { echo = false } = {}) {
  const server = http.createServer((request, response) => {
    let raw = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      raw += chunk;
    });
    request.on('end', () => {
      const body = JSON.parse(raw);
      observed.push({ authorization: request.headers.authorization, body, url: request.url });
      if (echo) {
        const header = request.headers.authorization || '';
        sendSse(response, [{ choices: [{ delta: { content: `echo ${header.replace(/^Bearer /, '')}` }, finish_reason: 'stop' }] }]);
        return;
      }
      if (body.messages.at(-1).role === 'tool') {
        sendSse(response, [
          { choices: [{ delta: { content: 'supervised state persisted' }, finish_reason: 'stop' }] },
          { choices: [], usage: { prompt_tokens: 8, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } } },
        ]);
        return;
      }
      sendSse(response, [
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call:canary-state',
                    function: { name: toWireToolName('temporary.set-state'), arguments: '{"value":"durable"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        },
      ]);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

function bufferHits(label, buffer) {
  return NEEDLES.filter(([, needle]) => buffer.includes(needle)).map(([kind]) => `${label}:${kind}`);
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

// Scans file names and contents (includes *.db, -wal, -shm) of every file below each root.
function scanTree(roots) {
  const hits = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root)) {
      hits.push(...bufferHits(file, Buffer.from(file, 'utf8')), ...bufferHits(file, fs.readFileSync(file)));
    }
  }
  return hits;
}

async function supervise(t, { echo }) {
  const observed = [];
  const port = await providerServer(t, observed, { echo });
  const project = fixture(t, `http://127.0.0.1:${port}/v1`);
  const captured = { stdout: [], stderr: [], childEnvironment: null };
  let result;
  let thrown = null;
  try {
    result = await runSupervisedBoundKernel(
      'run',
      {
        bindingPath: project.bindingPath,
        projectDir: project.directory,
        value: 'durable',
        environment: { PATH: process.env.PATH, HSEOS_MODEL_PROVIDER_API_KEY: CANARY },
      },
      {
        readinessCheck: readiness(),
        spawnImpl(binary, args, options) {
          captured.childEnvironment = { ...options.env };
          const child = spawn(binary, args, options);
          child.stdout?.on('data', (chunk) => captured.stdout.push(Buffer.from(chunk)));
          child.stderr?.on('data', (chunk) => captured.stderr.push(Buffer.from(chunk)));
          return child;
        },
      },
    );
  } catch (error) {
    thrown = error;
  }
  if (result?.state) t.after(() => openExecutionLedgerFileFixture(result.state).cleanup());
  return { observed, project, captured, result, thrown };
}

function fullScan({ observed, project, captured, result, thrown }) {
  const roots = result?.state ? [project.directory, result.state] : [project.directory];
  const thrownText = `${thrown?.message ?? ''}\n${thrown?.stack ?? ''}\n${JSON.stringify(thrown ?? null)}`;
  const samples = [
    ['result', JSON.stringify(result ?? null)],
    ['thrown', thrownText],
    ['childEnvironment', JSON.stringify(captured.childEnvironment)],
    ['stdout', Buffer.concat(captured.stdout)],
    ['stderr', Buffer.concat(captured.stderr)],
    ...observed.flatMap((request, index) => [
      [`observed[${index}].body`, JSON.stringify(request.body)],
      [`observed[${index}].url`, String(request.url)],
    ]),
  ];
  return [...scanTree(roots), ...samples.flatMap(([label, value]) => bufferHits(label, Buffer.from(value)))];
}

test('scanner is not blind: a planted canary in the scanned tree is found in every encoding', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-canary-scanner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  assert.deepEqual(scanTree([directory]), []);
  fs.mkdirSync(path.join(directory, 'nested'));
  fs.writeFileSync(path.join(directory, 'nested', 'a.txt'), `x ${CANARY} y`);
  fs.writeFileSync(path.join(directory, 'nested', 'b.db-wal'), Buffer.from(CANARY).toString('base64'));
  fs.writeFileSync(path.join(directory, 'c.db'), Buffer.from(CANARY).toString('hex'));
  const hits = scanTree([directory]);
  assert.equal(hits.length, 3);
  assert.ok(hits.some((hit) => hit.endsWith('a.txt:raw')));
  assert.ok(hits.some((hit) => hit.endsWith('b.db-wal:base64')));
  assert.ok(hits.some((hit) => hit.endsWith('c.db:hex')));
  assert.deepEqual(bufferHits('x', Buffer.from('nothing here')), []);
});

test('scenario A: canary reaches the provider only through the Authorization header', async (t) => {
  const run = await supervise(t, { echo: false });
  assert.equal(run.thrown, null);
  assert.equal(run.result.status, 'completed');
  assert.ok(run.observed.length >= 2);
  // Proof the scan is not empty by construction: the canary did arrive, via the legitimate path.
  assert.ok(run.observed.every((request) => request.authorization === `Bearer ${CANARY}`));
  assert.ok(run.captured.childEnvironment);
  assert.deepEqual(fullScan(run), []);
  const files = [...walk(run.result.state)].map((file) => path.basename(file));
  assert.ok(files.length > 0, 'state directory must not be empty');
});

test('scenario B: a provider echoing the canary in the SSE content is withheld and leaves no trace', async (t) => {
  const run = await supervise(t, { echo: true });
  // The provider received the canary legitimately and echoed it back.
  assert.ok(run.observed.length > 0);
  assert.equal(run.observed[0].authorization, `Bearer ${CANARY}`);
  // The broker refuses the response (PROVIDER_EGRESS_SECRET_EXPOSURE -> 502): no completed run.
  assert.equal(run.result?.status, 'failed');
  assert.deepEqual(fullScan(run), []);
});
