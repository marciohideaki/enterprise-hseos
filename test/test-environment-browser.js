'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { before, after, test } = require('node:test');

const environment = require('../packages/agent-environment');
const contract = require('../packages/agent-environment/browser-contract');
const browser = require('../packages/agent-environment/browser');
const host = require('../packages/agent-environment/browser-host');
const { ContextMediaStore } = require('../packages/agent-context/media-store');
const { MediaSourceSchema } = require('../packages/agent-runtime-contracts/content-parts');
const { ContextSourceSchema } = require('../packages/agent-context/schemas');
const { executeIsolatedCommand } = require('../packages/agent-isolation-attestation/executor');
const { createIsolationPolicy } = require('../packages/agent-isolation-attestation');
const { chromiumSandboxFlags } = require('../packages/agent-isolation-attestation/profiles');
const { containsCredential } = require('../tools/cli/lib/campaign-evidence-store');
const broker = require('../tools/cli/lib/environment-egress-broker');
const pins = require('../tools/lib/environment-toolchain-pins');

const CACHE = process.env.HSEOS_TOOLCHAIN_CACHE || '/build/cache/hseos-toolchain';
const FIXTURES = path.join(__dirname, 'fixtures', 'browser');
const scratch = [];
const servers = [];
let toolchain;
let origin;
let other;
let egress;
let mediaStore;

function temp(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

const fixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

function listen(handler) {
  const server = http.createServer(handler);
  servers.push(server);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

/** Real HTTP servers: the project's dev server (allowlisted) and a second one that must never be reached. */
async function startServers() {
  const seen = { cookies: [], other: 0 };
  const second = await listen((request, response) => {
    seen.other += 1;
    response.writeHead(200, { 'content-type': 'image/png' }).end();
  });
  const first = await listen((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/cookies' || url.pathname === '/set-cookie') seen.cookies.push(request.headers.cookie ?? null);
    const html = (body, headers = {}) => response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', ...headers }).end(body);
    if (url.pathname === '/') return html(fixture('index.html'));
    if (url.pathname === '/subresource') return html(fixture('subresource.html').replace('{{OTHER_PORT}}', String(second.port)));
    if (url.pathname === '/secret') return html(fixture('secret.html'));
    if (url.pathname === '/cookies') return html(fixture('cookies.html'));
    if (url.pathname === '/set-cookie') return html(fixture('cookies.html'), { 'set-cookie': 'session=abc123; Path=/' });
    if (url.pathname === '/big') return html(`<!doctype html><title>big</title><p>${'word '.repeat(12_000)}</p>`);
    if (url.pathname === '/redirect-out') return response.writeHead(302, { location: `http://denied.example.test:${first.port}/` }).end();
    if (url.pathname === '/slow') return; // never answered: the call must time out
    return response.writeHead(404, { 'content-type': 'text/plain' }).end('missing');
  });
  return { first, second, seen };
}

let fixtureServers;

before(async () => {
  fixtureServers = await startServers();
  origin = `http://localhost:${fixtureServers.first.port}`;
  other = `http://127.0.0.1:${fixtureServers.second.port}`;
  egress = await broker.startEnvironmentEgressBroker({ allow: broker.localhostAllowlist(fixtureServers.first.port) });
  mediaStore = new ContextMediaStore({ root: temp('hseos-browser-media-') });
  toolchain = browser.prepareBrowserToolchain({
    install: environment.loadPins().installToolchain,
    cacheDirectory: CACHE,
    destination: temp('hseos-browser-toolchain-'),
  });
  assert.equal(toolchain.status, 'ready', `BLOCKED: the pinned browser toolchain is not available (${toolchain.code}: ${toolchain.cause})`);
});

after(async () => {
  // A browser that outlived its call must fail the assertions, not hang the runner: reap whatever is left.
  if (toolchain?.root) for (const pid of processesMentioning(toolchain.root)) process.kill(pid, 'SIGKILL');
  await egress?.close();
  for (const server of servers) server.closeAllConnections?.();
  await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))));
  for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true });
});

function policy(profile = 'P2') {
  const main = temp('hseos-browser-main-');
  const root = path.join(main, 'workspace');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(main, 'protected'), 'protected');
  return createIsolationPolicy({
    backend: 'bwrap',
    host_workspace: root,
    main_checkout: main,
    protected_paths: [path.join(main, 'protected')],
    profile,
    toolchain_roots: [toolchain.root],
    ...(profile === 'P2' ? { broker_socket: egress.socketPath } : {}),
  });
}

function realService(extra = {}) {
  const events = [];
  const service = environment.createDefaultBrowserService({
    policy: policy(),
    toolchain,
    broker: egress,
    mediaStore,
    ledger: (event) => events.push(event),
    ...extra,
  });
  return { service, events };
}

/** Every process whose command line mentions the marker, read from /proc (the kernel's view, not the executor's). */
function processesMentioning(marker) {
  const found = [];
  for (const entry of fs.readdirSync('/proc').filter((name) => /^[0-9]+$/.test(name))) {
    try {
      if (fs.readFileSync(`/proc/${entry}/cmdline`, 'latin1').includes(marker)) found.push(Number(entry));
    } catch {
      // The process ended while it was being read.
    }
  }
  return found.filter((pid) => pid !== process.pid);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------------------------------------------------------
// Real browser (chrome-headless-shell 149 in the P2 sandbox) against a real local HTTP server.
// ---------------------------------------------------------------------------------------------------------------

test('real browser in the P2 sandbox: goto, click, type, press, wait, screenshot and DOM become untrusted data parts', async () => {
  const { service, events } = realService();
  const output = await service.run({
    steps: [
      { op: 'goto', url: `${origin}/` },
      { op: 'wait_for', selector: '#late' },
      { op: 'click', selector: '#go' },
      { op: 'type', selector: '#name', text: 'hseos' },
      { op: 'press', key: 'Enter' },
      { op: 'wait_for', load_state: 'load' },
      { op: 'screenshot' },
      { op: 'dom_snapshot' },
    ],
    viewport: { width: 800, height: 600 },
    timeout_ms: 30_000,
  });
  assert.equal(output.status, 'ok', JSON.stringify(output));
  assert.equal(output.contract, 'environment.browser.v1');
  assert.deepEqual(
    output.steps.map((step) => step.op),
    ['goto', 'wait_for', 'click', 'type', 'press', 'wait_for', 'screenshot', 'dom_snapshot'],
  );
  assert.equal(output.steps[0].status, 200);

  const [shot] = output.media;
  assert.equal(MediaSourceSchema.safeParse(shot).success, true, 'the screenshot descriptor is a valid media-source');
  assert.deepEqual([shot.origin, shot.authority, shot.trust, shot.media_type], ['browser', 'data', 'untrusted', 'image/png']);
  assert.deepEqual([shot.width, shot.height], [800, 600]);
  assert.equal(shot.transform[0].id, 'browser-viewport');
  const png = mediaStore.load(shot);
  assert.equal(sha256(png), shot.digest, 'the stored screenshot matches its digest');

  const [dom] = output.context;
  assert.equal(ContextSourceSchema.safeParse(dom).success, true, 'the DOM part is a valid context-source');
  assert.deepEqual([dom.authority, dom.provenance.origin, dom.provenance.trust], ['data', 'browser', 'untrusted']);
  assert.match(dom.content, /HSEOS Browser Fixture/);
  assert.match(dom.content, /submitted:hseos/, 'the typed value reached the page and the DOM shows the result');
  assert.match(dom.content, /late content/);
  assert.match(dom.content, /accessibility tree/);
  assert.equal(dom.provenance.digest, sha256(dom.content));

  for (const capture of output.captures) {
    assert.match(capture.url, new RegExp(`^${origin}/`));
    assert.match(capture.retrieved_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(capture.digest, /^[0-9a-f]{64}$/);
    assert.ok(capture.transform.length > 0);
  }
  assert.equal(output.egress.denied.length, 0);
  assert.ok(output.egress.requests >= 1, 'the page was fetched through the broker');
  assert.equal(output.execution.profile, 'P2');
  assert.equal(output.execution.workspace_access, 'read_only');
  assert.equal(output.execution.descendants_terminated, true);
  assert.ok(
    output.execution.pids_peak >= 2 && output.execution.pids_peak < output.execution.limits.processes,
    `pids_peak ${output.execution.pids_peak}`,
  );
  assert.equal(output.execution.limits.memory_bytes, 2_147_483_648);
  assert.deepEqual(processesMentioning(toolchain.root), [], 'no browser process survived the call');
  assert.equal(events.at(-1).type, 'environment.browser.completed');
  assert.ok(!JSON.stringify(output).includes('cookie'), 'no cookie or header reaches the output');
});

test('cookies and storage do not persist across calls: each call gets a fresh context', async () => {
  const { service } = realService();
  fixtureServers.seen.cookies.length = 0;
  const first = await service.run({ steps: [{ op: 'goto', url: `${origin}/set-cookie` }, { op: 'dom_snapshot' }] });
  assert.equal(first.status, 'ok');
  assert.match(first.context[0].content, /cookies:session=abc123/, 'within one call the cookie works');
  const second = await service.run({ steps: [{ op: 'goto', url: `${origin}/cookies` }, { op: 'dom_snapshot' }] });
  assert.equal(second.status, 'ok');
  assert.match(second.context[0].content, /cookies:\s*none/, 'the cookie set by the first call is gone');
  assert.deepEqual(fixtureServers.seen.cookies, [null, null], 'the server never saw a cookie header');
});

test('a host outside the allowlist is blocked and recorded: navigation, subresource and redirect', async () => {
  const { service, events } = realService();
  fixtureServers.seen.other = 0;

  const direct = await service.run({ steps: [{ op: 'goto', url: other }] });
  assert.equal(direct.status, 'refused');
  assert.equal(direct.code, 'ENV_BROWSER_EGRESS_DENIED');
  assert.equal(direct.egress.denied[0].reason, 'host_not_allowed');
  assert.ok(events.some((event) => event.type === 'environment.browser.refused' && event.code === 'ENV_BROWSER_EGRESS_DENIED'));

  const subresource = await service.run({ steps: [{ op: 'goto', url: `${origin}/subresource` }, { op: 'dom_snapshot' }] });
  assert.equal(subresource.status, 'ok', 'a blocked subresource does not fail the page');
  const denied = subresource.egress.denied.find((entry) => entry.port === fixtureServers.second.port);
  assert.ok(denied, `the broker recorded the denied subresource ${JSON.stringify(subresource.egress)}`);
  assert.equal(denied.reason, 'host_not_allowed');
  assert.equal(fixtureServers.seen.other, 0, 'the denied server received no request at all');

  const redirected = await service.run({ steps: [{ op: 'goto', url: `${origin}/redirect-out` }] });
  assert.equal(redirected.status, 'refused');
  assert.equal(redirected.code, 'ENV_BROWSER_EGRESS_DENIED');
  assert.ok(redirected.egress.denied.some((entry) => entry.host === 'denied.example.test'));
});

test('page text with a credential pattern is withheld, and a slow page times out with zero descendants', async () => {
  const { service } = realService();
  const secret = await service.run({ steps: [{ op: 'goto', url: `${origin}/secret` }, { op: 'dom_snapshot' }] });
  assert.equal(secret.status, 'refused');
  assert.equal(secret.code, 'ENV_BROWSER_CREDENTIAL_DETECTED');
  assert.ok(!JSON.stringify(secret).includes('sk-fixture'));

  const slow = await service.run({ steps: [{ op: 'goto', url: `${origin}/slow` }], timeout_ms: 1500 });
  assert.equal(slow.status, 'refused');
  assert.equal(slow.code, 'ENV_BROWSER_TIMEOUT');
  assert.deepEqual(processesMentioning(toolchain.root), []);

  const missing = await service.run({
    steps: [
      { op: 'goto', url: `${origin}/` },
      { op: 'click', selector: '#absent' },
    ],
    timeout_ms: 1200,
  });
  assert.equal(missing.status, 'refused');
  assert.equal(missing.code, 'ENV_BROWSER_TIMEOUT');
});

test('long page text is cut and says so', async () => {
  const { service } = realService();
  const output = await service.run({ steps: [{ op: 'goto', url: `${origin}/big` }, { op: 'dom_snapshot' }] });
  assert.equal(output.status, 'ok');
  assert.equal(output.captures[0].truncated, true);
  assert.match(output.context[0].content, /\[truncated\]/);
});

test('the sandbox flag exists only for a genuine bwrap launch; calls are serialised to one browser at a time', async () => {
  assert.throws(() => chromiumSandboxFlags({ args: ['--unshare-all'], profile: 'P2' }), /only valid inside a supervisor bwrap launch/);
  let active = 0;
  let peak = 0;
  const fake = browser.createBrowserService({
    policy: { profile: 'P2' },
    toolchain,
    broker: stubBroker(),
    mediaStore,
    containsCredential,
    sandboxFlags: () => ['--no-sandbox'],
    createChannel: () => ({ verify: () => [], dispose() {} }),
    execute: async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 30));
      active -= 1;
      return hostResult({ ok: true, steps: [{ index: 0, op: 'goto', ok: true, url: 'http://localhost/' }], captures: [] });
    },
  });
  const request = { steps: [{ op: 'goto', url: 'http://localhost:80/' }] };
  const results = await Promise.all([fake.run(request), fake.run(request), fake.run(request)]);
  assert.deepEqual(
    results.map((item) => item.status),
    ['ok', 'ok', 'ok'],
  );
  assert.equal(peak, 1, 'never more than one browser call in flight');
});

test('profile, toolchain and installation gaps are BLOCKED with their cause, never ok', async () => {
  const stub = (overrides) =>
    browser.createBrowserService({
      policy: { profile: 'P2' },
      toolchain,
      broker: stubBroker(),
      mediaStore,
      containsCredential,
      sandboxFlags: () => [],
      createChannel: () => ({ verify: () => [], dispose() {} }),
      execute: async () => hostResult({ ok: true, steps: [], captures: [] }),
      ...overrides,
    });
  const request = { steps: [{ op: 'goto', url: 'http://localhost:80/' }] };
  const p1 = await stub({ policy: { profile: 'P1' } }).run(request);
  assert.deepEqual([p1.status, p1.code], ['blocked', 'ENV_BROWSER_PROFILE_INSUFFICIENT']);
  const absent = await stub({ toolchain: { status: 'blocked', code: 'ENV_TOOLCHAIN_CACHE_UNSET', cause: 'cache missing' } }).run(request);
  assert.deepEqual([absent.status, absent.code], ['blocked', 'ENV_TOOLCHAIN_CACHE_UNSET']);
  const empty = await stub({ toolchain: { status: 'ready', root: temp('hseos-browser-empty-') } }).run(request);
  assert.deepEqual([empty.status, empty.code], ['blocked', 'ENV_BROWSER_UNAVAILABLE']);
  const unavailable = await stub({ execute: async () => hostResult({ ok: false, code: 'ENV_BROWSER_UNAVAILABLE' }) }).run(request);
  assert.deepEqual([unavailable.status, unavailable.code], ['blocked', 'ENV_BROWSER_UNAVAILABLE']);

  const missingCache = browser.prepareBrowserToolchain({
    install: environment.loadPins().installToolchain,
    cacheDirectory: temp('hseos-browser-nocache-'),
    destination: temp('hseos-browser-nodest-'),
  });
  assert.equal(missingCache.status, 'blocked');
  assert.equal(missingCache.code, 'ENV_TOOLCHAIN_MANIFEST_MISSING');
  const failing = browser.prepareBrowserToolchain({
    install: () => {
      throw new Error('no code');
    },
    cacheDirectory: CACHE,
    destination: temp('hseos-browser-nodest-'),
  });
  assert.deepEqual([failing.status, failing.code], ['blocked', 'ENV_TOOLCHAIN_BLOCKED']);
});

// ---------------------------------------------------------------------------------------------------------------
// Controller branches driven by a stand-in executor (the real path is covered above).
// ---------------------------------------------------------------------------------------------------------------

function stubBroker(events = []) {
  return { allow: ['localhost:80', 'localhost:443'], drain: () => events.splice(0), dropped: () => ({ allowed: 0, denied: 0 }) };
}

function hostResult(host, extra = {}) {
  return {
    status: 'succeeded',
    stdout: JSON.stringify(host),
    descendants_terminated: true,
    pids_peak: 5,
    profile: 'P2',
    limits: {},
    ...extra,
  };
}

function standIn(execute, extra = {}) {
  const ledger = [];
  const events = [];
  const service = browser.createBrowserService({
    policy: { profile: 'P2' },
    toolchain,
    broker: stubBroker(events),
    mediaStore,
    containsCredential,
    sandboxFlags: () => ['--no-sandbox'],
    createChannel: () => ({ verify: () => [], dispose() {} }),
    execute,
    ledger: (event) => ledger.push(event),
    now: () => new Date('2026-10-14T12:00:00.000Z'),
    ...extra,
  });
  return { service, ledger, events };
}

const GOTO = { steps: [{ op: 'goto', url: 'http://localhost:80/' }] };

test('controller: host failures map to refusals; denied egress wins over a generic failure', async () => {
  const fail = (host, extra) => standIn(async () => hostResult(host, extra)).service.run(GOTO);
  assert.equal((await fail({ ok: false, code: 'ENV_BROWSER_HOST_FAILURE' })).code, 'ENV_BROWSER_HOST_FAILURE');
  assert.equal(
    (await fail({ ok: true, steps: [{ index: 0, op: 'goto', ok: true }], captures: [] }, { status: 'timed_out' })).code,
    'ENV_BROWSER_TIMED_OUT',
  );
  assert.equal((await fail({ ok: true })).code, 'ENV_BROWSER_RESULT_INVALID');
  assert.equal(
    (await standIn(async () => ({ status: 'succeeded', stdout: 'not json', descendants_terminated: true })).service.run(GOTO)).code,
    'ENV_BROWSER_OUTPUT_INVALID',
  );
  assert.equal(
    (await fail({ ok: true, steps: [{ index: 0, op: 'goto', ok: false, error: 'ENV_BROWSER_STEP_FAILED' }], captures: [] })).code,
    'ENV_BROWSER_STEP_FAILED',
  );
  assert.equal(
    (await fail({ ok: true, steps: [{ index: 0, op: 'goto', ok: false, error: 'ENV_BROWSER_TIMEOUT' }], captures: [] })).code,
    'ENV_BROWSER_TIMEOUT',
  );
  const record = { decision: 'denied', method: 'GET', host: 'evil.test', port: 80, reason: 'host_not_allowed' };
  const carrier = standIn(async () => {
    carrier.events.push(record);
    return hostResult({ ok: true, steps: [{ index: 0, op: 'goto', ok: false }], captures: [] });
  });
  const refused = await carrier.service.run(GOTO);
  assert.equal(refused.code, 'ENV_BROWSER_EGRESS_DENIED');
  assert.equal(refused.egress.denied[0].host, 'evil.test');
  const byHost = await fail({ ok: true, steps: [{ index: 0, op: 'goto', ok: false, error: 'ENV_BROWSER_EGRESS_DENIED' }], captures: [] });
  assert.equal(byHost.code, 'ENV_BROWSER_EGRESS_DENIED');
  const generic = standIn(async () => {
    generic.events.push(record);
    return hostResult({ ok: false, code: 'ENV_BROWSER_HOST_FAILURE' });
  });
  assert.equal((await generic.service.run(GOTO)).code, 'ENV_BROWSER_EGRESS_DENIED');
});

test('controller: malformed captures are refused, never passed on', async () => {
  const withCaptures = (captures, artifacts = []) =>
    standIn(async () => hostResult({ ok: true, steps: [{ index: 0, op: 'goto', ok: true, url: 'http://localhost/' }], captures }), {
      createChannel: () => ({ verify: () => artifacts, dispose() {} }),
    }).service.run(GOTO);
  const missingShot = await withCaptures([{ kind: 'screenshot', file: 'shot-0.png', url: 'http://localhost/' }]);
  assert.equal(missingShot.code, 'ENV_BROWSER_RESULT_INVALID');
  const notPng = await withCaptures(
    [{ kind: 'screenshot', file: 'shot-0.png', url: 'http://localhost/' }],
    [{ name: 'shot-0.png', content: Buffer.from('not a png at all, just text padding here') }],
  );
  assert.equal(notPng.code, 'ENV_BROWSER_RESULT_INVALID');
  const malformedDom = await withCaptures([{ kind: 'dom', url: 'http://localhost/' }]);
  assert.equal(malformedDom.code, 'ENV_BROWSER_RESULT_INVALID');
  const credential = await withCaptures([
    {
      kind: 'dom',
      url: 'http://localhost/',
      title: 'x',
      text: { text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789', truncated: false },
      accessibility: { text: '', truncated: false },
    },
  ]);
  assert.equal(credential.code, 'ENV_BROWSER_CREDENTIAL_DETECTED');
  const clean = await withCaptures([
    {
      kind: 'dom',
      url: 'http://localhost/',
      title: 't\u0007',
      text: { text: 'plain', truncated: false },
      accessibility: { text: '- heading', truncated: true },
    },
  ]);
  assert.equal(clean.status, 'ok');
  assert.equal(clean.context[0].content.includes('\u0007'), false, 'control characters never reach a context source');
  assert.equal(clean.captures[0].truncated, true);
  const withQuery = await standIn(async () =>
    hostResult({
      ok: true,
      steps: [{ index: 0, op: 'goto', ok: true, url: 'http://localhost/' }],
      captures: [
        {
          kind: 'dom',
          url: 'http://localhost/a/b?token=1#frag',
          title: 't',
          text: { text: 'plain', truncated: false },
          accessibility: { text: '', truncated: false },
        },
        {
          kind: 'dom',
          url: 'not a url',
          title: 't',
          text: { text: 'plain', truncated: false },
          accessibility: { text: '', truncated: false },
        },
      ],
    }),
  ).service.run(GOTO);
  assert.equal(withQuery.status, 'ok');
  assert.equal(
    withQuery.context[0].source_ref,
    'environment.browser.dom.0@http://localhost/a/b',
    'query and fragment stay out of the reference',
  );
  assert.equal(withQuery.context[1].source_ref, 'environment.browser.dom.1@invalid-url');
  assert.equal(withQuery.captures[0].url, 'http://localhost/a/b?token=1#frag', 'the capture keeps the URL it was taken at');
});

test('controller: invalid input is refused before anything runs', async () => {
  const { service } = standIn(async () => assert.fail('must not run'));
  for (const input of [null, [], {}, { steps: [] }, { steps: [{ op: 'click', selector: 'a' }] }, { steps: GOTO.steps, extra: 1 }]) {
    const output = await service.run(input);
    assert.deepEqual([output.status, output.code], ['refused', 'ENV_BROWSER_INPUT_INVALID']);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Contract validation.
// ---------------------------------------------------------------------------------------------------------------

test('contract: every step shape and limit is validated', () => {
  const ok = (input) => assert.equal(contract.parseInput(input).success, true, JSON.stringify(input));
  const bad = (input, pattern) => {
    const parsed = contract.parseInput(input);
    assert.equal(parsed.success, false, JSON.stringify(input));
    assert.match(parsed.error.issues[0].message, pattern);
  };
  const goto = { op: 'goto', url: 'http://localhost:3000/' };
  ok({ steps: [goto] });
  ok({
    steps: [
      goto,
      { op: 'click', selector: 'button' },
      { op: 'type', selector: '#a', text: '' },
      { op: 'press', key: 'Control+A' },
      { op: 'wait_for', selector: '#a' },
      { op: 'wait_for', load_state: 'networkidle' },
      { op: 'screenshot' },
      { op: 'dom_snapshot' },
    ],
    viewport: { width: 320, height: 240 },
    timeout_ms: 1000,
  });
  assert.deepEqual(contract.parseInput({ steps: [goto] }).data.viewport, contract.DEFAULT_VIEWPORT);
  bad('x', /object/);
  bad({ steps: [goto], other: 1 }, /unknown field/);
  bad({ steps: 'x' }, /steps must hold/);
  bad({ steps: Array.from({ length: 21 }, () => goto) }, /steps must hold/);
  bad({ steps: [null] }, /step must be an object/);
  bad({ steps: [{ op: 'eval', code: '1' }] }, /not supported/);
  bad({ steps: [{ ...goto, extra: 1 }] }, /unknown field/);
  bad({ steps: [{ op: 'goto', url: 'file:///etc/passwd' }] }, /http\(s\)/);
  bad({ steps: [{ op: 'goto', url: 'http://user:pw@localhost/' }] }, /http\(s\)/);
  bad({ steps: [{ op: 'goto', url: 'not a url' }] }, /http\(s\)/);
  bad({ steps: [{ op: 'goto', url: `http://localhost/${'a'.repeat(2100)}` }] }, /http\(s\)/);
  bad({ steps: [{ op: 'press', key: 'a b' }, goto] }, /key name/);
  bad({ steps: [goto, { op: 'click', selector: '' }] }, /selector/);
  bad({ steps: [goto, { op: 'type', selector: 'a' }] }, /bounded text/);
  bad({ steps: [goto, { op: 'type', selector: '', text: 'x' }] }, /selector/);
  bad({ steps: [goto, { op: 'wait_for' }] }, /exactly one/);
  bad({ steps: [goto, { op: 'wait_for', selector: 'a', load_state: 'load' }] }, /exactly one/);
  bad({ steps: [goto, { op: 'wait_for', selector: '' }] }, /selector/);
  bad({ steps: [goto, { op: 'wait_for', load_state: 'idle' }] }, /load_state/);
  bad({ steps: [{ op: 'screenshot' }] }, /first step must be a goto/);
  bad({ steps: [goto, ...Array.from({ length: 5 }, () => ({ op: 'screenshot' }))] }, /screenshot/);
  bad({ steps: [goto, ...Array.from({ length: 5 }, () => ({ op: 'dom_snapshot' }))] }, /dom_snapshot/);
  bad({ steps: [goto], viewport: { width: 100, height: 600 } }, /viewport/);
  bad({ steps: [goto], viewport: { width: 800, height: 600, extra: 1 } }, /viewport/);
  bad({ steps: [goto], viewport: null }, /viewport/);
  bad({ steps: [goto], timeout_ms: 5 }, /timeout_ms/);
  bad({ steps: [goto], timeout_ms: 120_000 }, /timeout_ms/);
  assert.equal(contract.urlAuthority(new URL('https://Example.com/x')), 'example.com:443');
  assert.equal(contract.urlAuthority(new URL('http://localhost:8080')), 'localhost:8080');
  assert.equal(contract.BROWSER_INPUT_SCHEMA.safeParse({ steps: [goto] }).success, true);
  const capture = {
    source_ref: 'r',
    url: 'http://localhost/',
    retrieved_at: '2026-10-14T12:00:00.000Z',
    digest: 'a'.repeat(64),
    transform: [],
  };
  const output = (extra) =>
    contract.BROWSER_OUTPUT_SCHEMA.safeParse({ contract: contract.CONTRACT, media: [], context: [], captures: [], ...extra });
  const context = { source_ref: 'r', authority: 'data', provenance: { origin: 'browser', trust: 'untrusted' } };
  assert.equal(output({}).success, true);
  assert.equal(
    output({ media: [{ source_ref: 'r', origin: 'browser', authority: 'data', trust: 'trusted' }], captures: [capture] }).success,
    false,
  );
  assert.equal(output({ context: [context], captures: [capture] }).success, true);
  assert.equal(output({ context: [{ ...context, authority: 'directive' }], captures: [capture] }).success, false);
  assert.equal(output({ context: [context] }).success, false, 'a part without a capture carrying its URL is refused');
  assert.equal(output({ context: [context], captures: [{ ...capture, url: undefined }] }).success, false);
  assert.equal(output({ context: [context], captures: [{ ...capture, digest: 'short' }] }).success, false);
  assert.equal(contract.BROWSER_OUTPUT_SCHEMA.safeParse(null).success, false);
});

// ---------------------------------------------------------------------------------------------------------------
// Pins: licences are checked inside the pinned artifacts, nothing is downloaded, the core gains no dependency.
// ---------------------------------------------------------------------------------------------------------------

test('pins: playwright-core and chrome-headless-shell match the cache manifest field by field and their licences are in the artifact', () => {
  const manifest = pins.readManifest(CACHE);
  assert.equal(manifest.runtime_download, false);
  for (const name of ['playwright-core', 'chrome-headless-shell']) {
    const entry = manifest.pins.find((item) => item.name === name);
    const want = pins.PINS[name];
    assert.deepEqual(
      [entry.version, entry.artifact, entry.sha256, entry.license],
      [want.version, want.artifact, want.sha256, want.license],
      name,
    );
    const verified = pins.verifyPin(CACHE, name, manifest);
    assert.equal(verified.sha256, want.sha256);
  }
  assert.equal(pins.PINS['playwright-core'].license, 'Apache-2.0');
  assert.equal(pins.PINS['chrome-headless-shell'].license, 'BSD-3-Clause');
  assert.equal(pins.PINS['chrome-headless-shell'].version, '149.0.7827.55');
  const zip = fs.readFileSync(path.join(CACHE, pins.PINS['chrome-headless-shell'].artifact));
  assert.throws(
    () => pins.listZip(zip),
    (error) => error.code === 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE',
    'the default zip ceilings refuse this archive',
  );
  const entries = pins.listZip(zip, pins.PINS['chrome-headless-shell'].zip_limits);
  assert.ok(
    entries.find((entry) => entry.name.endsWith('/chrome-headless-shell')).executable,
    'the browser binary keeps its executable bit',
  );
  const root = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(
    Object.keys(root.dependencies ?? {}).some((name) => name.includes('playwright')),
    false,
    'the core declares no playwright dependency',
  );
  const installed = fs.statSync(path.join(toolchain.root, 'chrome-headless-shell/chrome-headless-shell-linux64/chrome-headless-shell'));
  assert.ok((installed.mode & 0o100) !== 0, 'the extracted browser is executable');
});

test('lazy loading: requiring the package loads neither the browser nor playwright-core', () => {
  const { execFileSync } = require('node:child_process');
  const probe = `const environment = require(${JSON.stringify(path.join(__dirname, '../packages/agent-environment'))});
const loaded = () => Object.keys(require.cache).filter((file) => /browser|playwright/.test(file)).length;
const before = loaded();
environment.parseBrowserInput({ steps: [] });
console.log(JSON.stringify({ before, afterContract: loaded() > 0, playwright: Object.keys(require.cache).some((file) => file.includes('playwright-core')) }));`;
  const seen = JSON.parse(execFileSync(process.execPath, ['-e', probe]).toString());
  assert.deepEqual(seen, { before: 0, afterContract: true, playwright: false });
  const source = fs.readFileSync(path.join(__dirname, '../packages/agent-environment/browser-host.js'), 'utf8');
  assert.ok(!/^const .*require\(['"]playwright/m.test(source), 'no top-level require of playwright-core');
  assert.match(source, /require\(path\.join\(toolchain, 'playwright-core\/package'\)\)/);
});

// ---------------------------------------------------------------------------------------------------------------
// The host in-process (coverage runs here; the sandboxed call above proves the same code under bwrap).
// ---------------------------------------------------------------------------------------------------------------

test('host in-process: runs the steps, writes artifacts and reports step failures without throwing', async () => {
  const artifacts = temp('hseos-browser-artifacts-');
  const result = await host.runBrowser({
    steps: [
      { op: 'goto', url: `${origin}/` },
      { op: 'wait_for', selector: '#late' },
      { op: 'screenshot' },
      { op: 'dom_snapshot' },
      { op: 'click', selector: '#absent' },
      { op: 'dom_snapshot' },
    ],
    viewport: { width: 640, height: 480 },
    timeout_ms: 1500,
    toolchain: toolchain.root,
    flags: ['--no-sandbox'],
    scratch: temp('hseos-browser-scratch-'),
    broker_socket: egress.socketPath,
    artifacts,
  });
  assert.deepEqual(
    result.steps.map((step) => step.ok),
    [true, true, true, true, false],
  );
  assert.equal(result.steps[4].error, 'ENV_BROWSER_TIMEOUT');
  assert.equal(result.captures.length, 2, 'the loop stops at the first failed step');
  assert.deepEqual(processesMentioning(toolchain.root), [], 'the browser is closed when the call ends, failed step or not');
  assert.equal(result.files[0].media_type, 'image/png');
  assert.equal(sha256(fs.readFileSync(path.join(artifacts, 'shot-0.png'))), result.files[0].sha256);

  const failed = await host.runBrowser({
    steps: [
      { op: 'goto', url: `${origin}/` },
      { op: 'type', selector: '#name', text: 'x' },
      { op: 'press', key: 'NoSuchKeyName' },
    ],
    viewport: { width: 640, height: 480 },
    timeout_ms: 5000,
    toolchain: toolchain.root,
    flags: ['--no-sandbox'],
    scratch: temp('hseos-browser-scratch-'),
    broker_socket: egress.socketPath,
    artifacts,
  });
  assert.equal(failed.steps[2].error, 'ENV_BROWSER_STEP_FAILED');
});

test('host in-process: launch failure, deadline and output handling', async () => {
  await assert.rejects(
    host.runBrowser({
      steps: [],
      viewport: {},
      timeout_ms: 2000,
      toolchain: temp('hseos-browser-bad-'),
      flags: [],
      broker_socket: egress.socketPath,
    }),
    (error) => error.code === 'ENV_BROWSER_UNAVAILABLE' || error.code === 'MODULE_NOT_FOUND',
  );
  const lines = [];
  const artifacts = temp('hseos-browser-out-');
  assert.equal(await host.main(['{"bad json'], (line) => lines.push(line), artifacts), 1);
  assert.equal(JSON.parse(lines[0]).ok, false);
  const bare = [];
  host.emit({ steps: [], captures: [], files: [] }, (line) => bare.push(line), null);
  assert.deepEqual(JSON.parse(bare[0]), { steps: [], captures: [] });
  const manifest = [];
  host.emit({ steps: [], captures: [], files: [] }, (line) => manifest.push(line), artifacts);
  assert.equal(JSON.parse(manifest[0])[0].path, '/artifacts/result.json');
  const files = Array.from({ length: 2000 }, (_, index) => ({
    path: `/artifacts/shot-${index}.png`,
    media_type: 'image/png',
    bytes: 1,
    sha256: 'a'.repeat(64),
  }));
  assert.throws(
    () => host.emit({ steps: [], captures: [], files }, () => {}, artifacts),
    (error) => error.code === 'ENV_BROWSER_RESULT_TOO_LARGE',
  );
  const ok = await host.main(
    [
      JSON.stringify({
        steps: [{ op: 'goto', url: `${origin}/` }],
        viewport: { width: 400, height: 300 },
        timeout_ms: 5000,
        toolchain: toolchain.root,
        flags: ['--no-sandbox'],
        scratch: temp('hseos-browser-scratch-'),
        broker_socket: egress.socketPath,
      }),
    ],
    (line) => lines.push(line),
    null,
  );
  assert.equal(ok, 0);
  assert.equal(JSON.parse(lines.at(-1)).steps[0].ok, true);
  assert.deepEqual(processesMentioning(toolchain.root), []);
});

// ---------------------------------------------------------------------------------------------------------------
// The egress broker over its Unix socket.
// ---------------------------------------------------------------------------------------------------------------

function viaBroker(target, { socketPath, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, method, path: target, headers: { host: new URL(target).host } }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.once('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
      response.once('error', reject);
    });
    request.once('error', reject);
    request.end(body);
  });
}

function connectVia(socketPath, authority) {
  return new Promise((resolve, reject) => {
    const request = http.request({ socketPath, method: 'CONNECT', path: authority });
    request.once('connect', (response, socket) => resolve({ status: response.statusCode, socket }));
    request.once('error', reject);
    request.end();
  });
}

test('egress broker: allowlist parsing is strict', () => {
  assert.deepEqual(broker.parseAllowlist(['b.test:80', 'a.test:443', 'a.test:443']), ['a.test:443', 'b.test:80']);
  assert.deepEqual(broker.localhostAllowlist(3000), ['localhost:3000', '127.0.0.1:3000']);
  for (const bad of [
    undefined,
    [],
    'a:1',
    ['a'],
    ['*.test:80'],
    ['http://a.test:80'],
    ['a.test:0'],
    ['a.test:65536'],
    ['a.test:80/x'],
    [1],
    Array.from({ length: 33 }, (_, index) => `h${index}.test:80`),
  ]) {
    assert.throws(
      () => broker.parseAllowlist(bad),
      (error) => error.name === 'EnvironmentEgressBrokerError',
      JSON.stringify(bad),
    );
  }
});

test('egress broker: forwards allowed requests, refuses and records everything else', async () => {
  const body = await listen((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.once('end', () =>
      response
        .writeHead(200, { 'content-type': 'text/plain', connection: 'keep-alive', 'x-up': '1' })
        .end(`echo:${Buffer.concat(chunks).toString()}`),
    );
  });
  const big = await listen((request, response) => response.writeHead(200).end('x'.repeat(5000)));
  const echo = net.createServer((socket) => socket.pipe(socket));
  servers.push(echo);
  await new Promise((resolve) => echo.listen(0, '127.0.0.1', resolve));
  const echoPort = echo.address().port;
  const local = await broker.startEnvironmentEgressBroker({
    allow: [...broker.localhostAllowlist(body.port), ...broker.localhostAllowlist(big.port), `127.0.0.1:${echoPort}`, '127.0.0.1:9'],
    maxRequestBytes: 64,
    maxResponseBytes: 1000,
    idleTimeoutMs: 400,
    now: () => new Date('2026-10-14T12:00:00.000Z'),
  });
  try {
    assert.ok(fs.statSync(local.socketPath).isSocket());
    const post = await viaBroker(`http://127.0.0.1:${body.port}/x?y=1`, { socketPath: local.socketPath, method: 'POST', body: 'hello' });
    assert.deepEqual([post.status, post.body], [200, 'echo:hello']);
    const denied = await viaBroker('http://127.0.0.1:1/', { socketPath: local.socketPath });
    assert.equal(denied.status, 403);
    assert.equal((await viaBroker('http://user:pw@127.0.0.1:1/', { socketPath: local.socketPath })).status, 403);
    assert.equal((await viaBroker('https://127.0.0.1:1/', { socketPath: local.socketPath })).status, 403);
    const oversized = await viaBroker(`http://127.0.0.1:${body.port}/`, {
      socketPath: local.socketPath,
      method: 'POST',
      body: 'z'.repeat(200),
    });
    assert.equal(oversized.status, 413);
    const dead = await viaBroker('http://127.0.0.1:9/', { socketPath: local.socketPath });
    assert.equal(dead.status, 502, 'an allowed target that refuses the connection is a 502');
    await assert.rejects(
      viaBroker(`http://127.0.0.1:${big.port}/`, { socketPath: local.socketPath }),
      'a response over the ceiling is cut',
    );

    const tunnel = await connectVia(local.socketPath, `127.0.0.1:${echoPort}`);
    assert.equal(tunnel.status, 200);
    const echoed = await new Promise((resolve) => {
      tunnel.socket.once('data', (chunk) => resolve(chunk.toString()));
      tunnel.socket.write('ping');
    });
    assert.equal(echoed, 'ping');
    await new Promise((resolve) => {
      tunnel.socket.once('close', resolve);
    });
    const refused = await connectVia(local.socketPath, '127.0.0.1:1');
    assert.equal(refused.status, 403);
    refused.socket.destroy();
    const malformed = await connectVia(local.socketPath, 'a%b');
    assert.equal(malformed.status, 403);
    malformed.socket.destroy();

    const events = local.drain();
    assert.ok(events.every((event) => event.at === '2026-10-14T12:00:00.000Z'));
    const reasons = events.filter((event) => event.decision === 'denied').map((event) => event.reason);
    assert.deepEqual([...new Set(reasons)].sort(), ['host_not_allowed', 'malformed_target', 'request_too_large']);
    assert.ok(events.some((event) => event.decision === 'allowed' && event.method === 'CONNECT'));
    assert.ok(events.some((event) => event.reason === 'upstream_failed'));
    assert.ok(events.some((event) => event.reason === 'response_cut'));
    assert.deepEqual(local.drain(), [], 'draining empties the log');
  } finally {
    await local.close();
    await local.close();
  }
  assert.equal(fs.existsSync(local.directory), false, 'the broker removes the directory it created');
});

test('egress broker: an idle tunnel is closed, connections are capped, and an existing directory is kept', async () => {
  const quiet = net.createServer(() => {});
  servers.push(quiet);
  await new Promise((resolve) => quiet.listen(0, '127.0.0.1', resolve));
  const directory = temp('hseos-browser-egress-dir-');
  const local = await broker.startEnvironmentEgressBroker({
    allow: [`127.0.0.1:${quiet.address().port}`],
    directory,
    idleTimeoutMs: 200,
    maxConnections: 8,
  });
  try {
    const tunnel = await connectVia(local.socketPath, `127.0.0.1:${quiet.address().port}`);
    assert.equal(tunnel.status, 200);
    await new Promise((resolve) => tunnel.socket.once('close', resolve));
    const cut = await connectVia(local.socketPath, `127.0.0.1:${quiet.address().port}`);
    cut.socket.write(Buffer.alloc(100, 1));
    cut.socket.destroy();
  } finally {
    await local.close();
  }
  assert.equal(fs.existsSync(directory), true, 'a directory the caller supplied is not removed');
  await assert.rejects(
    broker.startEnvironmentEgressBroker({ allow: ['a.test:80'], directory: path.join(directory, 'missing') }),
    (error) => error.code === 'ENV_BROWSER_EGRESS_START_FAILED' || error.code === 'ENOENT',
  );
  await assert.rejects(broker.startEnvironmentEgressBroker({ allow: [] }), (error) => error.code === 'ENV_BROWSER_EGRESS_INVALID');
});

test('host in-process: every step kind, a refused navigation, the relay and the command-line entry', async () => {
  const base = () => ({
    viewport: { width: 500, height: 400 },
    timeout_ms: 10_000,
    toolchain: toolchain.root,
    flags: ['--no-sandbox'],
    scratch: temp('hseos-browser-scratch-'),
    broker_socket: egress.socketPath,
    artifacts: temp('hseos-browser-artifacts-'),
  });
  const all = await host.runBrowser({
    ...base(),
    steps: [
      { op: 'goto', url: `${origin}/` },
      { op: 'click', selector: '#go' },
      { op: 'type', selector: '#name', text: 'abc' },
      { op: 'press', key: 'Enter' },
      { op: 'wait_for', load_state: 'domcontentloaded' },
      { op: 'wait_for', selector: '#late' },
      { op: 'goto', url: 'about:blank' },
    ],
  });
  assert.deepEqual(
    all.steps.map((step) => step.ok),
    [true, true, true, true, true, true, true],
  );
  assert.equal(all.steps[6].status, null, 'a navigation without a network response reports no status');

  const refused = await host.runBrowser({ ...base(), steps: [{ op: 'goto', url: `${origin}/redirect-out` }] });
  assert.equal(refused.steps[0].ok, false);
  assert.equal(refused.steps[0].error, 'ENV_BROWSER_EGRESS_DENIED');

  // The relay closes both ends when the broker side is gone.
  const relay = await host.startRelay(path.join(temp('hseos-browser-norelay-'), 'absent.sock'));
  try {
    assert.equal(relay.address().address, '127.0.0.1', 'the relay listens on loopback only');
    const client = net.connect(relay.address().port, '127.0.0.1');
    client.on('error', () => {});
    await new Promise((resolve) => client.once('close', resolve));
    const second = net.connect(relay.address().port, '127.0.0.1');
    second.on('error', () => {});
    second.destroy();
  } finally {
    relay.close();
  }

  const { execFile } = require('node:child_process');
  const run = (args) =>
    new Promise((resolve) => execFile(process.execPath, args, (error, out) => resolve({ status: error ? error.code : 0, stdout: out })));
  const entry = path.join(__dirname, '../packages/agent-environment/browser-host.js');
  const request = { ...base(), steps: [{ op: 'goto', url: `${origin}/` }], artifacts: undefined };
  // Asynchronous on purpose: the fixture server lives in this process and must keep answering.
  const good = await run([entry, JSON.stringify(request)]);
  assert.equal(good.status, 0);
  assert.equal(JSON.parse(good.stdout).steps[0].ok, true, good.stdout);
  const bad = await run([entry, '{"bad']);
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stdout).ok, false);
});

// ---------------------------------------------------------------------------------------------------------------
// Review round 1: provenance, registration under flood, host header, descendants, DNS, and test-gap mutants.
// ---------------------------------------------------------------------------------------------------------------

test('parts carry the final URL and descendants are proved gone', async () => {
  const { service } = realService();
  const output = await service.run({
    steps: [{ op: 'goto', url: `${origin}/` }, { op: 'wait_for', selector: '#late' }, { op: 'screenshot' }, { op: 'dom_snapshot' }],
  });
  assert.equal(output.status, 'ok', JSON.stringify(output));
  for (const part of [output.media[0], output.context[0]]) {
    assert.ok(part.source_ref.includes(`${origin}/`), part.source_ref);
    assert.ok(output.captures.some((capture) => capture.source_ref === part.source_ref && capture.url.startsWith(`${origin}/`)));
  }
  assert.equal(output.execution.descendants_terminated, true);
  assert.equal(contract.BROWSER_OUTPUT_SCHEMA.safeParse(output).success, true);
});

test('every call gets a fresh, locked-down context: no downloads, service workers blocked, no permissions', () => {
  const options = host.contextOptions({ width: 640, height: 480 });
  assert.deepEqual(options, { viewport: { width: 640, height: 480 }, acceptDownloads: false, serviceWorkers: 'block', permissions: [] });
  assert.equal(options.storageState, undefined, 'no stored state is ever loaded into a context');
});

test('the sandbox cannot resolve names or reach an external address; only the broker socket leads out', async () => {
  const script = `const dns = require('node:dns');
const net = require('node:net');
const fs = require('node:fs');
const out = { socket: fs.statSync('/run/broker.sock').isSocket() };
dns.lookup('example.com', (error, address) => {
  out.dns = error ? error.code : 'resolved:' + address;
  const socket = net.connect({ host: '1.1.1.1', port: 80, timeout: 2000 });
  socket.once('connect', () => { out.tcp = 'connected'; socket.destroy(); });
  socket.once('error', (failure) => { out.tcp = failure.code; });
  socket.once('timeout', () => { out.tcp = 'timeout'; socket.destroy(); });
  socket.once('close', () => console.log(JSON.stringify(out)));
});`;
  const channel = require('../packages/agent-isolation-attestation/artifact-channel').createArtifactChannel({
    media_types: ['application/json'],
  });
  try {
    const result = await executeIsolatedCommand({
      policy: policy(),
      command: ['/usr/bin/node', '-e', script],
      host_node: true,
      timeout_ms: 30_000,
      max_output_bytes: 65_536,
      artifact_channel: channel,
    });
    assert.equal(result.status, 'succeeded', result.stderr);
    const seen = JSON.parse(result.stdout);
    assert.equal(seen.socket, true, 'the broker socket is the one thing mounted');
    assert.doesNotMatch(seen.dns, /^resolved/, `name resolution inside the sandbox: ${seen.dns}`);
    assert.notEqual(seen.tcp, 'connected', 'an external address is unreachable');
  } finally {
    channel.dispose();
  }
});

test('egress broker: refusals are never lost to a flood of allowed requests, and every cut is counted', async () => {
  const target = await listen((request, response) => response.writeHead(200).end('ok'));
  const flood = await broker.startEnvironmentEgressBroker({ allow: [`127.0.0.1:${target.port}`] });
  try {
    for (let index = 0; index < 1100; index += 1) {
      const answer = await viaBroker(`http://127.0.0.1:${target.port}/${index}`, { socketPath: flood.socketPath });
      assert.equal(answer.status, 200);
    }
    assert.equal((await viaBroker('http://evil.test:80/', { socketPath: flood.socketPath })).status, 403);
    const events = flood.drain();
    const denied = events.filter((event) => event.decision === 'denied');
    assert.equal(denied.length, 1, 'the refusal after 1100 allowed requests is recorded');
    assert.equal(denied[0].host, 'evil.test');
    assert.equal(events.filter((event) => event.decision === 'allowed').length, 1000);
    assert.deepEqual(flood.dropped(), { allowed: 100, denied: 0 }, 'the allowed events beyond the ceiling are counted');
    assert.deepEqual(flood.dropped(), { allowed: 0, denied: 0 }, 'reading the counters resets them');
    for (let index = 0; index < 1003; index += 1) await viaBroker(`http://evil.test:80/${index}`, { socketPath: flood.socketPath });
    assert.equal(flood.drain().length, 1000);
    assert.deepEqual(flood.dropped(), { allowed: 0, denied: 3 }, 'refusals beyond their own ceiling are counted too');
  } finally {
    await flood.close();
  }
});

test('egress broker: the Host header is rewritten from the validated target and userinfo is refused', async () => {
  const seenHosts = [];
  const target = await listen((request, response) => {
    seenHosts.push(request.headers.host);
    response.writeHead(200).end('ok');
  });
  const local = await broker.startEnvironmentEgressBroker({ allow: [`127.0.0.1:${target.port}`, 'localhost:80'] });
  try {
    const answer = await new Promise((resolve, reject) => {
      const request = http.request(
        { socketPath: local.socketPath, method: 'GET', path: `http://127.0.0.1:${target.port}/hh`, headers: { host: 'evil.example' } },
        (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        },
      );
      request.once('error', reject);
      request.end();
    });
    assert.equal(answer, 200);
    assert.deepEqual(seenHosts, [`127.0.0.1:${target.port}`], 'the upstream sees the validated authority, not the client Host');
    for (const userinfo of [`user:pw@127.0.0.1:${target.port}`, `user@127.0.0.1:${target.port}`]) {
      assert.equal((await viaBroker(`http://${userinfo}/`, { socketPath: local.socketPath })).status, 403, userinfo);
      const tunnel = await connectVia(local.socketPath, userinfo);
      assert.equal(tunnel.status, 403, `CONNECT ${userinfo}`);
      tunnel.socket.destroy();
    }
    assert.deepEqual(seenHosts.length, 1, 'no request with userinfo reached the server');
    const reasons = new Set(
      local
        .drain()
        .filter((event) => event.decision === 'denied')
        .map((event) => event.reason),
    );
    assert.deepEqual([...reasons], ['malformed_target']);
    const defaultPort = await viaBroker('http://localhost/', { socketPath: local.socketPath });
    assert.equal(defaultPort.status, 502, 'an allowlisted default-port target is forwarded (nothing listens there)');
  } finally {
    await local.close();
  }
});

test('controller: descendants must be proved terminated, sandbox-supplied strings are validated, services share one queue', async () => {
  const survived = await standIn(async () =>
    hostResult({ ok: true, steps: [{ index: 0, op: 'goto', ok: true }], captures: [] }, { descendants_terminated: false }),
  ).service.run(GOTO);
  assert.deepEqual([survived.status, survived.code], ['refused', 'ENV_BROWSER_DESCENDANTS_SURVIVED']);
  const absent = await standIn(async () =>
    hostResult({ ok: true, steps: [{ index: 0, op: 'goto', ok: true }], captures: [] }, { descendants_terminated: undefined }),
  ).service.run(GOTO);
  assert.equal(absent.code, 'ENV_BROWSER_DESCENDANTS_SURVIVED');

  const code = async (host) => (await standIn(async () => hostResult(host)).service.run(GOTO)).code;
  assert.equal(await code({ ok: false, code: 'ENV_BROWSER_TIMEOUT' }), 'ENV_BROWSER_TIMEOUT');
  assert.equal(await code({ ok: false, code: 'rm -rf /' }), 'ENV_BROWSER_HOST_FAILURE');
  assert.equal(await code({ ok: false, code: 'ENV_BROWSER_lowercase' }), 'ENV_BROWSER_HOST_FAILURE');
  const step = (extra) => ({ ok: true, steps: [{ index: 0, op: 'goto', ok: true, ...extra }], captures: [] });
  for (const extra of [
    { op: 'eval' },
    { url: 'x'.repeat(3000) },
    { status: 'ok' },
    { index: 'zero' },
    { ok: 'yes' },
    { error: 'ENV_BROWSER_MADE_UP' },
  ]) {
    assert.equal(await code(step(extra)), 'ENV_BROWSER_RESULT_INVALID', JSON.stringify(extra));
  }
  assert.equal(
    await code({ ok: true, steps: [{ index: 0, op: 'goto', ok: true }], captures: [{ kind: 'dom', url: 5 }] }),
    'ENV_BROWSER_RESULT_INVALID',
  );

  let active = 0;
  let peak = 0;
  const slow = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return hostResult(step({}));
  };
  const first = standIn(slow).service;
  const second = standIn(slow).service;
  await Promise.all([first.run(GOTO), second.run(GOTO), first.run(GOTO)]);
  assert.equal(peak, 1, 'two services in one process never run two browsers at once');

  const dropped = browser.createBrowserService({
    policy: { profile: 'P2' },
    toolchain,
    broker: { ...stubBroker(), dropped: () => ({ allowed: 7, denied: 2 }) },
    mediaStore,
    containsCredential,
    sandboxFlags: () => [],
    createChannel: () => ({ verify: () => [], dispose() {} }),
    execute: async () => hostResult(step({})),
  });
  const counted = await dropped.run(GOTO);
  assert.equal(counted.egress.requests, 9);
  assert.deepEqual(counted.egress.dropped, { allowed: 7, denied: 2 });
});

test('pins: a tampered artifact fails its SHA-256 and the zip ceilings are tight to the real archive', () => {
  const cache = temp('hseos-browser-tamper-');
  fs.mkdirSync(path.join(cache, 'npm'));
  const source = path.join(CACHE, pins.PINS['playwright-core'].artifact);
  fs.copyFileSync(path.join(CACHE, 'toolchain-manifest.json'), path.join(cache, 'toolchain-manifest.json'));
  fs.writeFileSync(path.join(cache, pins.PINS['playwright-core'].artifact), Buffer.concat([fs.readFileSync(source), Buffer.from([0])]));
  const manifest = pins.readManifest(cache);
  assert.throws(
    () => pins.verifyPin(cache, 'playwright-core', manifest),
    (error) => error.code === 'ENV_TOOLCHAIN_DIGEST_MISMATCH',
  );
  const diverged = {
    ...manifest,
    pins: manifest.pins.map((pin) => (pin.name === 'playwright-core' ? { ...pin, sha256: '0'.repeat(64) } : pin)),
  };
  fs.copyFileSync(source, path.join(cache, pins.PINS['playwright-core'].artifact));
  assert.throws(
    () => pins.verifyPin(cache, 'playwright-core', diverged),
    (error) => error.code === 'ENV_TOOLCHAIN_PIN_DIVERGED',
  );
  assert.equal(
    pins.verifyPin(cache, 'playwright-core', manifest).sha256,
    pins.PINS['playwright-core'].sha256,
    'the untouched artifact verifies',
  );

  const zip = fs.readFileSync(path.join(CACHE, pins.PINS['chrome-headless-shell'].artifact));
  const entries = pins.listZip(zip, { entry_bytes: 2 ** 31, total_bytes: 2 ** 32 });
  const largest = Math.max(...entries.map((entry) => entry.uncompressed));
  const total = entries.reduce((sum, entry) => sum + entry.uncompressed, 0);
  const limits = pins.PINS['chrome-headless-shell'].zip_limits;
  assert.ok(limits.entry_bytes >= largest && limits.entry_bytes <= largest * 1.25, `entry ceiling ${limits.entry_bytes} vs ${largest}`);
  assert.ok(limits.total_bytes >= total && limits.total_bytes <= total * 1.25, `total ceiling ${limits.total_bytes} vs ${total}`);
});

test('lazy loading: no top-level require outside node: builtins and sibling modules, and loading the host pulls no pin', () => {
  const { execFileSync } = require('node:child_process');
  for (const file of ['browser.js', 'browser-host.js', 'browser-contract.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../packages/agent-environment', file), 'utf8');
    for (const line of source.split('\n').filter((text) => /^\S.*\brequire\(/.test(text))) {
      assert.match(line, /require\('(?:node:[a-z/_]+|\.\/[a-z-]+)'\)/, `${file}: ${line}`);
    }
  }
  const entry = JSON.stringify(path.join(__dirname, '../packages/agent-environment/browser-host.js'));
  const probe = `process.env.HSEOS_TOOLCHAIN_CACHE = ${JSON.stringify(CACHE)};
require(${entry});
console.log(JSON.stringify(Object.keys(require.cache).filter((file) => !file.startsWith(${JSON.stringify(path.join(__dirname, '../packages/agent-environment'))}))));`;
  assert.deepEqual(JSON.parse(execFileSync(process.execPath, ['-e', probe]).toString()), [], 'only the capability files are loaded');
});
