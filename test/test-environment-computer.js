'use strict';

/* eslint-disable unicorn/prefer-event-target -- the fakes stand in for ChildProcess and stdin, which are EventEmitters. */

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { after, before, describe, test } = require('node:test');

const environment = require('../packages/agent-environment');
const contract = require('../packages/agent-environment/computer-contract');
const computer = require('../packages/agent-environment/computer');
const host = require('../packages/agent-environment/computer-host');
const { createApprovalGate } = require('../tools/cli/lib/environment-approval');
const { ContextMediaStore } = require('../packages/agent-context/media-store');
const { MediaSourceSchema } = require('../packages/agent-runtime-contracts/content-parts');
const { createIsolationPolicy } = require('../packages/agent-isolation-attestation');
const pins = require('../tools/lib/environment-toolchain-pins');

const CACHE = process.env.HSEOS_TOOLCHAIN_CACHE || '/build/cache/hseos-toolchain';
// Test-only override of the installed package version (the CI-runner condition is proved on a host whose own variant
// differs). The default is the real dpkg-query. Production code has no such switch.
const INSTALLED_QUERY = process.env.HSEOS_TEST_XDOTOOL_VERSION ? () => process.env.HSEOS_TEST_XDOTOOL_VERSION : undefined;
const systemPin = (arguments_) => pins.verifySystemPin({ query: INSTALLED_QUERY, ...arguments_ });
const scratch = [];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function temp(prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(directory);
  return directory;
}

after(() => {
  for (const directory of scratch) fs.rmSync(directory, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------
// Fixtures: a synthetic XWD, a PNG decoder, a fake process table for the host and a fake terminal for the controller.
// ---------------------------------------------------------------------------------------------------------------

function xwd({
  width = 640,
  height = 400,
  depth = 24,
  bpp = 32,
  order = 0,
  version = 7,
  colors = 0,
  pixel = () => [0, 0, 0],
  drop = 0,
} = {}) {
  const headerSize = 104;
  const head = Buffer.alloc(headerSize + colors * 12);
  const set = (index, value) => head.writeUInt32BE(value, index * 4);
  set(0, headerSize);
  set(1, version);
  set(3, depth);
  set(4, width);
  set(5, height);
  set(7, order);
  set(11, bpp);
  set(12, width * 4);
  set(14, 0xff_00_00);
  set(15, 0xff_00);
  set(16, 0xff);
  set(18, colors);
  const body = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const value = ((r << 16) | (g << 8) | b) >>> 0;
      if (order === 0) body.writeUInt32LE(value, (y * width + x) * 4);
      else body.writeUInt32BE(value, (y * width + x) * 4);
    }
  }
  return Buffer.concat([head, body]).subarray(0, head.length + body.length - drop);
}

/** Minimal PNG reader for the encoder's own output: filter 0 only, 8-bit indexed or RGB. */
function decodePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunks = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.subarray(at + 4, at + 8).toString('latin1');
    const data = png.subarray(at + 8, at + 8 + length);
    assert.equal(png.readUInt32BE(at + 8 + length), host.crc32(Buffer.concat([png.subarray(at + 4, at + 8), data])), `${type} crc`);
    chunks.push({ type, data });
    at += 12 + length;
  }
  const header = chunks.find((item) => item.type === 'IHDR').data;
  const [width, height, colorType] = [header.readUInt32BE(0), header.readUInt32BE(4), header[9]];
  const palette = chunks.find((item) => item.type === 'PLTE')?.data;
  const raw = zlib.inflateSync(Buffer.concat(chunks.filter((item) => item.type === 'IDAT').map((item) => item.data)));
  const stride = colorType === 3 ? width : width * 3;
  assert.equal(raw.length, (stride + 1) * height);
  return {
    width,
    height,
    colorType,
    colors: palette ? palette.length / 3 : 0,
    pixel(x, y) {
      const at = y * (stride + 1) + 1;
      if (colorType === 3) return [...palette.subarray(raw[at + x] * 3, raw[at + x] * 3 + 3)];
      return [...raw.subarray(at + x * 3, at + x * 3 + 3)];
    },
  };
}

const FLAT = xwd();
const noisy = (x, y) => [(x * 7) % 256, (y * 13) % 256, (x + y) % 256];

function fakeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.pid = 4242;
  child.kill = () => {
    child.exitCode = 137;
    child.emit('exit', null, 'SIGKILL');
  };
  return child;
}

/** A process table: Xvfb, xdotool, xwd and the target as scripted data. Nothing here touches a real display. */
function fakeSystem(overrides = {}) {
  const state = {
    geometryFailures: 0,
    reachable: new Set(),
    socketReachable: new Set(),
    window: true,
    windowAfter: 0,
    failAction: null,
    xwd: FLAT,
    xwdStatus: 0,
    xvfbExits: false,
    sockets: null,
    spawned: [],
    calls: [],
    ...overrides,
  };
  const spawn = (binary, args) => {
    const child = fakeChild();
    state.spawned.push({ binary, args, child });
    if (binary === host.XVFB && state.xvfbExits) setImmediate(() => child.emit('exit', 1, null));
    return child;
  };
  const spawnSync = (binary, args, options) => {
    state.calls.push({ binary, args, display: options.env?.DISPLAY });
    if (binary === host.XDOTOOL && args[0] === 'getdisplaygeometry') {
      if (state.reachable.has(options.env.DISPLAY)) return { status: 0, stdout: Buffer.from('640 400') };
      if (state.geometryFailures > 0 && options.env.DISPLAY.startsWith(':99')) {
        state.geometryFailures -= 1;
        return { status: 1, stdout: Buffer.alloc(0) };
      }
      return options.env.DISPLAY === ':99' ? { status: 0, stdout: Buffer.from('640 400') } : { status: 1, stdout: Buffer.alloc(0) };
    }
    if (binary === host.XDOTOOL && args[0] === 'search') {
      if (state.windowAfter > 0) {
        state.windowAfter -= 1;
        return { status: 1, stdout: Buffer.alloc(0) };
      }
      return state.window ? { status: 0, stdout: Buffer.from('1\n') } : { status: 1, stdout: Buffer.alloc(0) };
    }
    if (binary === host.XWD) return { status: state.xwdStatus, stdout: state.xwd };
    return { status: state.failAction && args.includes(state.failAction) ? 1 : 0, stdout: Buffer.alloc(0) };
  };
  const connect = (name) => Promise.resolve(state.socketReachable.has(name));
  const fsApi = {
    existsSync: () => state.sockets !== null,
    readdirSync: () => state.sockets ?? [],
  };
  return { state, spawn, spawnSync, fsApi, connect };
}

function fakeHost(overrides = {}, limits = contract.LIMITS) {
  const system = fakeSystem(overrides);
  const lines = [];
  const session = host.createHost({
    spawn: system.spawn,
    spawnSync: system.spawnSync,
    fsApi: system.fsApi,
    connect: system.connect,
    emit: (line) => lines.push(JSON.parse(line)),
    sleep: () => Promise.resolve(),
    limits,
  });
  return { session, system, lines };
}

const START = { display: { width: 640, height: 400 }, target: { command: '/usr/bin/xmessage', args: ['hi'] }, deny_displays: [':0', ':1'] };

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
const sessionProcesses = () => [...processesMentioning('Xvfb\0:99\0'), ...processesMentioning('/usr/bin/xmessage\0-buttons\0')];

// ---------------------------------------------------------------------------------------------------------------
// environment.computer.v1: the contract.
// ---------------------------------------------------------------------------------------------------------------

test('start input: shape, defaults, ceilings and unknown fields', () => {
  const ok = contract.parseStart({ target: { command: '/usr/bin/xmessage' } });
  assert.equal(ok.success, true);
  assert.deepEqual(ok.data, {
    target: { command: '/usr/bin/xmessage', args: [] },
    display: contract.DEFAULT_DISPLAY,
    timeout_ms: contract.LIMITS.default_timeout_ms,
  });
  assert.equal(
    contract.COMPUTER_INPUT_SCHEMA.safeParse({
      target: { command: '/usr/bin/xeyes', args: ['-geometry', '100x100'] },
      display: { width: 800, height: 600 },
      timeout_ms: 5000,
    }).success,
    true,
  );
  const bad = [
    null,
    [],
    {},
    { target: { command: '/usr/bin/x' }, extra: 1 },
    { target: 'xmessage' },
    { target: { command: 'xmessage' } },
    { target: { command: '/opt/evil/xmessage' } },
    { target: { command: '/usr/bin/../bin/sh' } },
    { target: { command: '/usr/bin/xmessage', extra: 1 } },
    { target: { command: '/usr/bin/xmessage', args: 'hi' } },
    { target: { command: '/usr/bin/xmessage', args: Array.from({ length: 9 }, () => 'a') } },
    { target: { command: '/usr/bin/xmessage', args: [1] } },
    { target: { command: '/usr/bin/xmessage', args: ['a'.repeat(257)] } },
    { target: { command: '/usr/bin/xmessage', args: ['a\0b'] } },
    { target: { command: '/usr/bin/xmessage' }, display: 'big' },
    { target: { command: '/usr/bin/xmessage' }, display: { width: 640, height: 400, depth: 8 } },
    { target: { command: '/usr/bin/xmessage' }, display: { width: 319, height: 400 } },
    { target: { command: '/usr/bin/xmessage' }, display: { width: 801, height: 400 } },
    { target: { command: '/usr/bin/xmessage' }, display: { width: 640, height: 239 } },
    { target: { command: '/usr/bin/xmessage' }, display: { width: 640, height: 601 } },
    { target: { command: '/usr/bin/xmessage' }, display: { width: 640.5, height: 400 } },
    { target: { command: '/usr/bin/xmessage' }, timeout_ms: 4999 },
    { target: { command: '/usr/bin/xmessage' }, timeout_ms: 300_001 },
    { target: { command: '/usr/bin/xmessage' }, timeout_ms: '9000' },
  ];
  for (const input of bad) {
    const result = contract.parseStart(input);
    assert.equal(result.success, false, JSON.stringify(input));
    assert.equal(result.error.hseos_code, 'ENV_COMPUTER_INPUT_INVALID');
  }
});

test('action input: one action per call, closed vocabulary, points inside the display, canonical defaults', () => {
  const parse = (input) => contract.parseAction(input, { width: 640, height: 400 });
  assert.deepEqual(parse({ action: 'screenshot' }).data, { action: 'screenshot', args: {} });
  assert.deepEqual(parse({ action: 'click', x: 10, y: 20 }).data, { action: 'click', args: { x: 10, y: 20, button: 1 } });
  assert.deepEqual(parse({ action: 'click', x: 10, y: 20, button: 3 }).data.args.button, 3);
  assert.deepEqual(parse({ action: 'move', x: 639, y: 399 }).data.args, { x: 639, y: 399 });
  assert.deepEqual(parse({ action: 'double_click', x: 0, y: 0 }).data.args, { x: 0, y: 0 });
  assert.deepEqual(parse({ action: 'type', text: 'héllo' }).data.args, { text: 'héllo' });
  assert.deepEqual(parse({ action: 'key', key: 'ctrl+a' }).data.args, { key: 'ctrl+a' });
  assert.deepEqual(parse({ action: 'scroll', direction: 'down' }).data.args, { direction: 'down', amount: 3 });
  assert.deepEqual(contract.parseAction({ action: 'move', x: 1, y: 1 }).data.args, { x: 1, y: 1 }, 'the default display applies');
  const bad = [
    null,
    [],
    'click',
    { action: 'format_disk' },
    { action: 'screenshot', x: 1 },
    { action: 'move', x: 640, y: 0 },
    { action: 'move', x: 0, y: 400 },
    { action: 'move', x: -1, y: 0 },
    { action: 'move', x: 1.5, y: 0 },
    { action: 'move', x: '1', y: 0 },
    { action: 'click', x: 1, y: 1, button: 4 },
    { action: 'click', x: 700, y: 1 },
    { action: 'double_click', x: 1 },
    { action: 'type', text: '' },
    { action: 'type', text: 'a'.repeat(257) },
    { action: 'type', text: 'a\0' },
    { action: 'type', text: 5 },
    { action: 'key', key: 'ctrl+a; rm -rf /' },
    { action: 'key', key: '' },
    { action: 'scroll', direction: 'left' },
    { action: 'scroll', direction: 'up', amount: 11 },
    { action: 'scroll', direction: 'up', amount: 0 },
    { action: 'scroll', direction: 'up', approve_all: true },
  ];
  for (const input of bad) {
    const result = parse(input);
    assert.equal(result.success, false, JSON.stringify(input));
    assert.equal(result.error.hseos_code, 'ENV_COMPUTER_INPUT_INVALID');
  }
  assert.deepEqual(contract.APPROVED_ACTIONS, ['move', 'click', 'double_click', 'type', 'key', 'scroll'], 'only the screenshot is exempt');
});

test('output schema: only untrusted display data with a traced capture is valid', () => {
  const capture = {
    source_ref: 'r',
    session_id: 's',
    seq: 1,
    retrieved_at: '2026-10-15T00:00:00Z',
    digest: 'a'.repeat(64),
    transform: [{}],
  };
  const media = { source_ref: 'r', origin: 'display', authority: 'data', trust: 'untrusted' };
  const good = { contract: contract.CONTRACT, media: [media], captures: [capture] };
  assert.equal(contract.COMPUTER_OUTPUT_SCHEMA.safeParse(good).success, true);
  assert.equal(contract.COMPUTER_OUTPUT_SCHEMA.safeParse({ contract: contract.CONTRACT }).success, true, 'an action result has no parts');
  for (const broken of [
    { ...good, contract: 'other' },
    { ...good, media: [{ ...media, origin: 'browser' }] },
    { ...good, media: [{ ...media, authority: 'directive' }] },
    { ...good, media: [{ ...media, trust: 'trusted' }] },
    { ...good, media: [{ ...media, source_ref: 'unknown' }] },
    { ...good, captures: [{ ...capture, digest: 'short' }] },
    { ...good, captures: [{ ...capture, session_id: undefined }] },
    { ...good, captures: [{ ...capture, seq: 1.5 }] },
    { ...good, captures: [{ ...capture, transform: 'x' }] },
    undefined,
  ]) {
    const result = contract.COMPUTER_OUTPUT_SCHEMA.safeParse(broken);
    assert.equal(result.success, false);
    assert.equal(result.error.hseos_code, 'ENV_COMPUTER_OUTPUT_INVALID');
  }
  assert.equal(new contract.ComputerError('x', 'ENV_COMPUTER_X').code, 'ENV_COMPUTER_X');
  assert.equal(contract.canonical({ b: [1, { d: 1, c: 2 }], a: null }), '{"a":null,"b":[1,{"c":2,"d":1}]}');
});

// ---------------------------------------------------------------------------------------------------------------
// Approval per action.
// ---------------------------------------------------------------------------------------------------------------

function gate(options = {}) {
  const events = [];
  let clock = Date.parse('2026-10-15T12:00:00Z');
  const approvals = createApprovalGate({ ledger: (event) => events.push(event), now: () => new Date(clock), ttl_ms: 5000, ...options });
  return { approvals, events, advance: (ms) => (clock += ms) };
}

const DIGEST = 'b'.repeat(64);
const binding = (override = {}) => ({
  session_id: 'sess-1',
  seq: 2,
  action: 'click',
  args: { x: 10, y: 20, button: 1 },
  screenshot_digest: DIGEST,
  ...override,
});
const PERSON = { approver: 'operator' };

test('an action without an approval is refused; a request is pending until a person approves it', () => {
  const { approvals, events } = gate();
  const pending = approvals.request(binding());
  assert.equal(pending.status, 'pending');
  assert.match(pending.binding_digest, /^[0-9a-f]{64}$/);
  const early = approvals.consume(pending.request_id, binding());
  assert.equal(early.code, 'ENV_COMPUTER_APPROVAL_NOT_GRANTED', 'a request alone grants nothing');
  assert.equal(approvals.consume('no-such-request', binding()).code, 'ENV_COMPUTER_APPROVAL_MISSING');
  assert.equal(approvals.approve('no-such-request', PERSON).code, 'ENV_COMPUTER_APPROVAL_MISSING');
  assert.equal(approvals.approve(pending.request_id, {}).code, 'ENV_COMPUTER_APPROVER_REQUIRED');
  assert.equal(approvals.approve(pending.request_id, PERSON).status, 'approved');
  assert.equal(approvals.approve(pending.request_id, PERSON).code, 'ENV_COMPUTER_APPROVAL_NOT_PENDING', 'an approval is granted once');
  assert.deepEqual(
    events.map((event) => event.outcome),
    ['requested', 'rejected', 'rejected', 'rejected', 'rejected', 'approved', 'rejected'],
  );
  assert.ok(events.every((event) => event.type === 'environment.computer.approval_outcome'));
  assert.equal(JSON.stringify(events).includes('"args"'), false, 'typed text and coordinates never reach the ledger');
});

test('an approval is single use: the second use is refused, and it is bound to session, sequence, action, arguments and screenshot', () => {
  const { approvals, events } = gate();
  const approve = (request = binding()) => {
    const pending = approvals.request(request);
    approvals.approve(pending.request_id, PERSON);
    return pending.request_id;
  };
  const used = approve();
  assert.equal(approvals.consume(used, binding()).status, 'consumed');
  assert.equal(approvals.consume(used, binding()).code, 'ENV_COMPUTER_APPROVAL_REUSED');

  for (const [field, other] of [
    ['session_id', 'sess-2'],
    ['seq', 3],
    ['action', 'double_click'],
    ['args', { x: 11, y: 20, button: 1 }],
    ['screenshot_digest', 'c'.repeat(64)],
  ]) {
    const id = approve();
    const refused = approvals.consume(id, binding({ [field]: other }));
    assert.equal(refused.code, 'ENV_COMPUTER_APPROVAL_MISMATCH', field);
    assert.equal(approvals.consume(id, binding()).status, 'consumed', `${field}: a refused use does not spend the approval`);
  }
  assert.equal(approvals.consume(approve(), { session_id: 'x' }).code, 'ENV_COMPUTER_APPROVAL_BINDING_INVALID');
  assert.equal(events.filter((event) => event.outcome === 'consumed').length, 6);
});

test('an approval expires, and a late approval is refused', () => {
  const { approvals, advance, events } = gate();
  const first = approvals.request(binding());
  approvals.approve(first.request_id, PERSON);
  advance(4999);
  const stillValid = approvals.request(binding({ seq: 5 }));
  approvals.approve(stillValid.request_id, PERSON);
  assert.equal(approvals.consume(stillValid.request_id, binding({ seq: 5 })).status, 'consumed');
  advance(1);
  assert.equal(approvals.consume(first.request_id, binding()).code, 'ENV_COMPUTER_APPROVAL_EXPIRED');
  assert.equal(approvals.consume(first.request_id, binding()).code, 'ENV_COMPUTER_APPROVAL_EXPIRED', 'expired stays expired');
  const late = approvals.request(binding({ seq: 6 }));
  advance(5000);
  assert.equal(approvals.approve(late.request_id, PERSON).code, 'ENV_COMPUTER_APPROVAL_EXPIRED');
  const lateConsume = approvals.request(binding({ seq: 7 }));
  advance(5000);
  assert.equal(
    approvals.consume(lateConsume.request_id, binding({ seq: 7 })).code,
    'ENV_COMPUTER_APPROVAL_EXPIRED',
    'never approved and expired',
  );
  assert.ok(events.some((event) => event.outcome === 'expired'));
  for (const bad of [999, 300_001, 1.5, '5000'])
    assert.throws(
      () => createApprovalGate({ ttl_ms: bad }),
      (error) => error.code === 'ENV_COMPUTER_APPROVAL_TTL_INVALID',
    );
});

test('approve-all, standing grants and the bypass or plan modes do not apply; a deny rule wins; an allow rule grants nothing', () => {
  const { approvals } = gate();
  const refused = (result) => {
    assert.equal(result.status, 'refused');
    assert.equal(result.code, 'ENV_COMPUTER_APPROVAL_NOT_APPLICABLE');
  };
  refused(approvals.request(binding(), { execution_mode: 'bypass' }));
  refused(approvals.request(binding(), { execution_mode: 'plan' }));
  refused(approvals.request(binding(), { approve_all: true }));
  refused(approvals.request({ ...binding(), approve_all: true }));
  refused(approvals.request({ ...binding(), scope: 'session' }));
  refused(approvals.request(binding({ action: 'approve_all' })));
  refused(approvals.request(binding({ action: 'always-click' })));
  for (const input of [
    null,
    [],
    'click',
    binding({ seq: -1 }),
    binding({ seq: 1.5 }),
    binding({ args: null }),
    binding({ args: [] }),
    binding({ screenshot_digest: 'short' }),
    binding({ session_id: '' }),
  ]) {
    assert.equal(approvals.request(input).code, 'ENV_COMPUTER_APPROVAL_BINDING_INVALID', JSON.stringify(input));
  }
  assert.equal(
    approvals.request(binding({ action: 'screenshot' })).code,
    'ENV_COMPUTER_APPROVAL_BINDING_INVALID',
    'a screenshot is never approved',
  );

  const rule = (extra) => ({ id: 'r1', source: 'project', ...extra });
  const denied = gate({ rules: [rule({ stage: 'deny', decision: 'deny', reason: 'no computer use here' })] }).approvals.request(binding());
  assert.equal(denied.code, 'ENV_COMPUTER_POLICY_DENIED');
  assert.equal(denied.deciding_rule_id, 'r1');
  const allowed = gate({ rules: [rule({ stage: 'allow', decision: 'allow' })] });
  const pending = allowed.approvals.request(binding());
  assert.equal(pending.status, 'pending', 'an allow rule does not turn into a grant');
  assert.equal(allowed.approvals.consume(pending.request_id, binding()).code, 'ENV_COMPUTER_APPROVAL_NOT_GRANTED');
  const denial = allowed.approvals.request(binding({ seq: 9 }));
  assert.equal(allowed.approvals.deny(denial.request_id, PERSON).status, 'denied');
  assert.equal(allowed.approvals.consume(denial.request_id, binding({ seq: 9 })).code, 'ENV_COMPUTER_APPROVAL_NOT_GRANTED');
});

test('open approvals are bounded; spent ones are purged', () => {
  const { approvals } = gate();
  const open = [];
  for (let index = 0; index < 256; index += 1) open.push(approvals.request(binding({ seq: index })));
  const full = approvals.request(binding({ seq: 999 }));
  assert.deepEqual(
    [full.status, full.code],
    ['refused', 'ENV_COMPUTER_APPROVAL_LIMIT'],
    'a full table is a contract refusal, never an exception',
  );
  for (const item of open.slice(0, 10)) {
    approvals.approve(item.request_id, PERSON);
    approvals.consume(item.request_id, binding({ seq: open.indexOf(item) }));
  }
  assert.equal(approvals.request(binding({ seq: 1000 })).status, 'pending');
});

// ---------------------------------------------------------------------------------------------------------------
// The input injector pin: licence read inside the .deb, installed version must match.
// ---------------------------------------------------------------------------------------------------------------

function requireCache() {
  const probe = (() => {
    try {
      return systemPin({ cacheDirectory: CACHE, name: 'xdotool' });
    } catch (error) {
      return error;
    }
  })();
  if (probe instanceof Error && probe.code !== 'ENV_TOOLCHAIN_SYSTEM_MISSING' && probe.code !== 'ENV_TOOLCHAIN_SYSTEM_VERSION') {
    assert.fail(`BLOCKED: the xdotool pin is not available in the toolchain cache (${probe.code}: ${probe.message})`);
  }
  return probe;
}

describe('xdotool system pin', () => {
  before(() => {
    requireCache();
  });

  const query = (version) => () => version;
  const pin = pins.PINS.xdotool;
  const [resolute, noble] = pin.variants;

  test('the .deb is verified by digest and its licence is read inside it; the installed version must equal the pin', () => {
    const verified = pins.verifySystemPin({ cacheDirectory: CACHE, name: 'xdotool', query: query(resolute.version) });
    assert.equal(verified.installed_version, resolute.version);
    // Informational only: the dpkg version decides. On this host the binary equals the one inside the .deb.
    assert.equal(typeof verified.binary_matches_artifact, 'boolean');
    assert.equal(verified.license, 'BSD-3-clause');
    assert.equal(verified.format, 'deb');
    assert.equal(Object.hasOwn(verified, 'bytes'), false, 'the artifact bytes are not handed on');
    assert.equal(pin.system_package, 'xdotool');
    assert.equal(verified.distro, 'ubuntu-resolute');
    assert.equal(verified.sha256, resolute.sha256);
  });

  test('two distro variants, each with its own artifact and digest, both verified inside their .deb; the installed version picks one', () => {
    assert.deepEqual(
      pin.variants.map((item) => item.distro),
      ['ubuntu-resolute', 'ubuntu-noble'],
    );
    assert.notEqual(resolute.sha256, noble.sha256);
    assert.notEqual(resolute.artifact, noble.artifact);
    assert.notEqual(resolute.version, noble.version);
    const verified = pins.verifySystemPin({ cacheDirectory: CACHE, name: 'xdotool', query: query(noble.version) });
    assert.deepEqual(
      [verified.distro, verified.version, verified.sha256, verified.installed_version],
      ['ubuntu-noble', noble.version, noble.sha256, noble.version],
    );
    assert.equal(verified.license, 'BSD-3-clause', 'the licence text was read inside the noble .deb');
    assert.equal(typeof verified.binary_matches_artifact, 'boolean');
    // The version decides: one that names neither variant is BLOCKED even though a sibling variant exists.
    assert.throws(
      () => pins.verifySystemPin({ cacheDirectory: CACHE, name: 'xdotool', query: query('1:3.20160805.1-5build2') }),
      (error) =>
        error.code === 'ENV_TOOLCHAIN_SYSTEM_VERSION' && error.message.includes(noble.version) && error.message.includes(resolute.version),
    );
    // A cache that holds only the other distro's entry cannot satisfy this host.
    const onlyResolute = temp('hseos-computer-cache-');
    fs.mkdirSync(path.join(onlyResolute, 'apt'));
    fs.copyFileSync(path.join(CACHE, resolute.artifact), path.join(onlyResolute, resolute.artifact));
    const manifest = JSON.parse(fs.readFileSync(path.join(CACHE, 'toolchain-manifest.json'), 'utf8'));
    fs.writeFileSync(
      path.join(onlyResolute, 'toolchain-manifest.json'),
      JSON.stringify({ ...manifest, pins: manifest.pins.filter((item) => item.name !== 'xdotool' || item.version === resolute.version) }),
    );
    assert.throws(
      () => pins.verifySystemPin({ cacheDirectory: onlyResolute, name: 'xdotool', query: query(noble.version) }),
      (error) => error.code === 'ENV_TOOLCHAIN_PIN_MISSING',
    );
    assert.equal(
      pins.verifySystemPin({ cacheDirectory: onlyResolute, name: 'xdotool', query: query(resolute.version) }).distro,
      'ubuntu-resolute',
    );
  });

  test('every variant names the archive URL and size the CI provisioner downloads, and a runner cache holding only its own variant is enough', () => {
    for (const variant of pin.variants) {
      assert.match(
        variant.source_url,
        new RegExp(`^https://archive\\.ubuntu\\.com/ubuntu/pool/universe/x/xdotool/${path.basename(variant.artifact)}$`),
      );
      assert.equal(
        variant.size_bytes,
        fs.statSync(path.join(CACHE, variant.artifact)).size,
        'the pinned size is the size of the verified .deb',
      );
    }
    // What the provisioner leaves on a runner is one manifest entry per downloaded variant. A cache with only the noble one:
    const runnerCache = temp('hseos-computer-runner-cache-');
    fs.mkdirSync(path.join(runnerCache, 'apt'));
    fs.copyFileSync(path.join(CACHE, noble.artifact), path.join(runnerCache, noble.artifact));
    const entry = (variant) => ({
      name: 'xdotool',
      version: variant.version,
      artifact: variant.artifact,
      license: pin.license,
      license_file: pin.license_file,
      sha256: variant.sha256,
    });
    fs.writeFileSync(
      path.join(runnerCache, 'toolchain-manifest.json'),
      JSON.stringify({ schema: 'hseos.toolchain-cache.v1', runtime_download: false, pins: [entry(noble)] }),
    );
    assert.equal(systemPin({ cacheDirectory: runnerCache, name: 'xdotool', query: query(noble.version) }).distro, 'ubuntu-noble');
    assert.throws(
      () => systemPin({ cacheDirectory: runnerCache, name: 'xdotool', query: query(resolute.version) }),
      (error) => error.code === 'ENV_TOOLCHAIN_PIN_MISSING' || error.code === 'ENV_TOOLCHAIN_ARTIFACT_MISSING',
    );
    // A downloaded artifact whose bytes are not the pinned ones is refused even if the manifest lists it.
    fs.writeFileSync(path.join(runnerCache, noble.artifact), Buffer.from('a different build'));
    assert.throws(
      () => systemPin({ cacheDirectory: runnerCache, name: 'xdotool', query: query(noble.version) }),
      (error) => error.code === 'ENV_TOOLCHAIN_DIGEST_MISMATCH',
    );
  });

  test('BLOCKED when the package is absent or another version, never an approximation', () => {
    const blocked = (fn, code) => assert.throws(fn, (error) => error instanceof pins.ToolchainBlockedError && error.code === code, code);
    blocked(
      () => pins.verifySystemPin({ cacheDirectory: CACHE, name: 'xdotool', query: query('1:3.20210804.1-1') }),
      'ENV_TOOLCHAIN_SYSTEM_VERSION',
    );
    blocked(
      () =>
        pins.verifySystemPin({
          cacheDirectory: CACHE,
          name: 'xdotool',
          query: () => {
            throw new Error('dpkg-query: no packages found');
          },
        }),
      'ENV_TOOLCHAIN_SYSTEM_MISSING',
    );
    blocked(() => pins.verifySystemPin({ cacheDirectory: CACHE, name: 'typescript' }), 'ENV_TOOLCHAIN_PIN_UNKNOWN');
    blocked(() => pins.verifySystemPin({ cacheDirectory: CACHE, name: 'nope' }), 'ENV_TOOLCHAIN_PIN_UNKNOWN');
    // The cache location is configuration: without HSEOS_TOOLCHAIN_CACHE (and no argument) there is nothing to verify against.
    if (pins.CACHE_ENV in process.env) {
      assert.equal(
        pins.verifySystemPin({ cacheDirectory: undefined, name: 'xdotool', query: query(resolute.version) }).distro,
        'ubuntu-resolute',
      );
    } else {
      blocked(
        () => pins.verifySystemPin({ cacheDirectory: undefined, name: 'xdotool', query: query(resolute.version) }),
        'ENV_TOOLCHAIN_CACHE_UNSET',
      );
    }
    const unset = { ...process.env };
    delete unset[pins.CACHE_ENV];
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        "try { require('./tools/lib/environment-toolchain-pins').verifySystemPin({ name: 'xdotool', query: () => '1:3.20160805.1-5build1' }); } catch (error) { console.log(error.code); }",
      ],
      { cwd: path.join(__dirname, '..'), env: unset, encoding: 'utf8' },
    );
    assert.equal(
      child.stdout.trim(),
      'ENV_TOOLCHAIN_CACHE_UNSET',
      'an unconfigured cache is BLOCKED whatever the environment of the test run',
    );
    blocked(
      () => pins.installToolchain({ cacheDirectory: CACHE, destination: temp('hseos-computer-pin-'), names: ['xdotool'] }),
      'ENV_TOOLCHAIN_PIN_SYSTEM',
    );
    assert.equal(
      Object.keys(pins.PINS)
        .filter((name) => !pins.PINS[name].system_package)
        .includes('xdotool'),
      false,
      'the default install set excludes system pins',
    );
  });

  test('a cache that diverges from the pin is BLOCKED: manifest, digest, licence text, licence path, archive shape', () => {
    const cacheWith = (mutate) => {
      const directory = temp('hseos-computer-cache-');
      fs.mkdirSync(path.join(directory, 'apt'));
      const manifest = JSON.parse(fs.readFileSync(path.join(CACHE, 'toolchain-manifest.json'), 'utf8'));
      const artifact = fs.readFileSync(path.join(CACHE, resolute.artifact));
      const result = mutate({ manifest, artifact });
      fs.writeFileSync(path.join(directory, resolute.artifact), result.artifact ?? artifact);
      fs.writeFileSync(path.join(directory, 'toolchain-manifest.json'), JSON.stringify(result.manifest ?? manifest));
      return { directory, expected: result.expected ?? pins.PINS };
    };
    const code = ({ directory, expected }) => {
      try {
        pins.verifySystemPin({ cacheDirectory: directory, name: 'xdotool', expected, query: query(resolute.version) });
      } catch (error) {
        return error.code;
      }
      return 'verified';
    };
    assert.equal(code(cacheWith(() => ({}))), 'verified');
    const withExpected = (patch, artifact) => ({ expected: { xdotool: { ...pin, ...patch, variants: [resolute] } }, artifact });
    assert.equal(
      code(
        cacheWith(({ manifest }) => ({
          manifest: {
            ...manifest,
            pins: manifest.pins.map((item) =>
              item.name === 'xdotool' && item.version === resolute.version ? { ...item, sha256: '0'.repeat(64) } : item,
            ),
          },
        })),
      ),
      'ENV_TOOLCHAIN_PIN_DIVERGED',
    );
    assert.equal(
      code(
        cacheWith(({ manifest }) => ({
          manifest: { ...manifest, pins: manifest.pins.filter((item) => item.name !== 'xdotool' || item.version !== resolute.version) },
        })),
      ),
      'ENV_TOOLCHAIN_PIN_MISSING',
    );
    assert.equal(
      code(cacheWith(({ artifact }) => ({ artifact: Buffer.concat([artifact, Buffer.from([0])]) }))),
      'ENV_TOOLCHAIN_DIGEST_MISMATCH',
    );
    assert.equal(
      code(cacheWith(() => withExpected({ license_markers: ['a licence text that is not in the artifact'] }))),
      'ENV_TOOLCHAIN_LICENSE_MISMATCH',
    );
    assert.equal(code(cacheWith(() => withExpected({ license_file: './usr/share/doc/xdotool/missing' }))), 'ENV_TOOLCHAIN_LICENSE_MISSING');
    const garbage = Buffer.from('this is not an ar archive at all');
    const unsafe = (artifact) =>
      cacheWith(({ manifest }) => ({
        artifact,
        manifest: {
          ...manifest,
          pins: manifest.pins.map((item) =>
            item.name === 'xdotool' && item.version === resolute.version ? { ...item, sha256: sha256(artifact) } : item,
          ),
        },
        expected: { xdotool: { ...pin, variants: [{ ...resolute, sha256: sha256(artifact) }] } },
      }));
    assert.equal(code(unsafe(garbage)), 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE');
    const header = (name, size) =>
      Buffer.from(
        `${name.padEnd(16)}${'0'.padEnd(12)}${'0'.padEnd(6)}${'0'.padEnd(6)}${'100644'.padEnd(8)}${String(size).padEnd(10)}\`\n`,
        'latin1',
      );
    const magic = Buffer.from('!<arch>\n');
    assert.equal(
      code(unsafe(Buffer.concat([magic, header('debian-binary', 4), Buffer.from('2.0\n')]))),
      'ENV_TOOLCHAIN_ARCHIVE_UNSAFE',
      'no data member',
    );
    assert.equal(code(unsafe(Buffer.concat([magic, Buffer.from('x'.repeat(60))]))), 'ENV_TOOLCHAIN_ARCHIVE_UNSAFE', 'bad member header');
    assert.equal(
      code(unsafe(Buffer.concat([magic, header('data.tar.zst', 9999), Buffer.from('short')]))),
      'ENV_TOOLCHAIN_ARCHIVE_UNSAFE',
      'member beyond the archive',
    );
  });

  test('the computer toolchain is BLOCKED without the pin or a binary, and ready installs only the host files', () => {
    const verifySystemPin = (arguments_) => pins.verifySystemPin({ ...arguments_, query: query(resolute.version) });
    const absent = computer.prepareComputerToolchain({
      verifySystemPin: () => {
        throw Object.assign(new Error('pin is not in the cache'), { code: 'ENV_TOOLCHAIN_ARTIFACT_MISSING' });
      },
      cacheDirectory: CACHE,
      destination: temp('hseos-computer-dest-'),
    });
    assert.deepEqual([absent.status, absent.code], ['blocked', 'ENV_TOOLCHAIN_ARTIFACT_MISSING']);
    const anonymous = computer.prepareComputerToolchain({
      verifySystemPin: () => {
        throw new Error('no code');
      },
      cacheDirectory: CACHE,
      destination: temp('hseos-computer-dest-'),
    });
    assert.equal(anonymous.code, 'ENV_TOOLCHAIN_BLOCKED');
    const noBinary = computer.prepareComputerToolchain({
      verifySystemPin,
      cacheDirectory: CACHE,
      destination: temp('hseos-computer-dest-'),
      binaries: ['/usr/bin/hseos-no-such-binary'],
    });
    assert.deepEqual([noBinary.status, noBinary.code], ['blocked', 'ENV_COMPUTER_UNAVAILABLE']);
    const destination = temp('hseos-computer-dest-');
    const ready = computer.prepareComputerToolchain({ verifySystemPin, cacheDirectory: CACHE, destination, binaries: ['/usr/bin/env'] });
    assert.equal(ready.status, 'ready');
    assert.deepEqual(fs.readdirSync(destination).sort(), ['computer-contract.js', 'computer-host.js']);
    assert.equal(ready.pin.installed_version, resolute.version);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// The sandbox host, driven in-process against a scripted process table.
// ---------------------------------------------------------------------------------------------------------------

test('crc32 matches the reference value and PNG encoding round-trips: indexed for flat screens, RGB for photographic ones', () => {
  assert.equal(host.crc32(Buffer.from('123456789')), 0xcb_f4_39_26);
  const indexed = decodePng(host.encodePng(4, 2, Buffer.from([1, 2, 3, 1, 2, 3, 9, 9, 9, 1, 2, 3, 9, 9, 9, 9, 9, 9, 0, 0, 0, 1, 2, 3])));
  assert.deepEqual([indexed.colorType, indexed.colors, indexed.width, indexed.height], [3, 3, 4, 2]);
  assert.deepEqual(indexed.pixel(2, 0), [9, 9, 9]);
  assert.deepEqual(indexed.pixel(2, 1), [0, 0, 0]);
  const rgb = Buffer.alloc(320 * 240 * 3);
  for (let at = 0; at < rgb.length; at += 3) {
    const index = at / 3;
    rgb[at] = index % 251;
    rgb[at + 1] = (index * 7) % 253;
    rgb[at + 2] = (index * 13) % 255;
  }
  const truecolor = decodePng(host.encodePng(320, 240, rgb));
  assert.equal(truecolor.colorType, 2);
  assert.deepEqual(truecolor.pixel(5, 3), [...rgb.subarray((3 * 320 + 5) * 3, (3 * 320 + 5) * 3 + 3)]);
});

test('xwd decoding: little and big endian, masks applied, anything else refused', () => {
  const marked = (x, y) => (x === 10 && y === 20 ? [200, 100, 50] : [0, 0, 0]);
  for (const order of [0, 1]) {
    const { png, width, height } = host.xwdToPng(xwd({ order, pixel: marked }));
    assert.deepEqual([width, height], [640, 400]);
    const decoded = decodePng(png);
    assert.deepEqual(decoded.pixel(10, 20), [200, 100, 50], `order ${order}`);
    assert.deepEqual(decoded.pixel(11, 20), [0, 0, 0]);
  }
  assert.equal(host.xwdToPng(xwd({ depth: 32, colors: 2 })).width, 640, 'a colormap is skipped, not decoded');
  const refused = (bytes) =>
    assert.throws(
      () => host.xwdToPng(bytes),
      (error) => error.code === 'ENV_COMPUTER_SCREENSHOT_FAILED',
    );
  refused('not a buffer');
  refused(Buffer.alloc(10));
  refused(Buffer.alloc(5_000_000));
  refused(xwd({ version: 6 }));
  refused(xwd({ bpp: 16 }));
  refused(xwd({ depth: 8 }));
  refused(xwd({ width: 320 - 1, height: 240 }));
  refused(xwd({ width: 321, height: 601 }));
  refused(xwd({ width: 801, height: 240 }));
  refused(xwd({ drop: 100 }));
  const short = xwd();
  short.writeUInt32BE(12, 0);
  refused(short);
  const narrow = xwd();
  narrow.writeUInt32BE(100, 12 * 4);
  refused(narrow);
});

test('xdotool command lines are argument vectors built from validated actions only', () => {
  const build = host.xdotoolArguments;
  assert.deepEqual(build('move', { x: 1, y: 2 }), ['mousemove', '1', '2']);
  assert.deepEqual(build('click', { x: 1, y: 2, button: 3 }), ['mousemove', '1', '2', 'click', '3']);
  assert.deepEqual(build('double_click', { x: 1, y: 2 }), ['mousemove', '1', '2', 'click', '--repeat', '2', '--delay', '80', '1']);
  assert.deepEqual(
    build('type', { text: '--delay 9; $(id)' }),
    ['type', '--delay', '12', '--', '--delay 9; $(id)'],
    'text follows a -- and is never a flag or a shell word',
  );
  assert.deepEqual(build('key', { key: 'ctrl+a' }), ['key', '--', 'ctrl+a']);
  assert.deepEqual(build('scroll', { direction: 'up', amount: 4 }), ['click', '--repeat', '4', '--delay', '20', '4']);
  assert.deepEqual(build('scroll', { direction: 'down', amount: 2 }), ['click', '--repeat', '2', '--delay', '20', '5']);
  assert.throws(
    () => build('screenshot', {}),
    (error) => error.code === 'ENV_COMPUTER_ACTION_FAILED',
  );
  assert.equal(host.pickDisplay([]), ':99');
  assert.equal(host.pickDisplay([':99', ':98', 'junk', ':0']), ':97', 'the operator display and its neighbours are never reused as a name');
});

test('host start: private display, no operator DISPLAY in any child, target after the display, ready only with an empty socket directory', async () => {
  const { session, system, lines } = fakeHost({ windowAfter: 2 });
  await session.start(START);
  assert.deepEqual(lines[0], { event: 'ready', display: { width: 640, height: 400 }, sockets: [], target_window: true });
  const [xvfb, target] = system.state.spawned;
  assert.equal(xvfb.binary, host.XVFB);
  assert.deepEqual(xvfb.args, [':99', '-nolisten', 'tcp', '-nolisten', 'unix', '-extension', 'GLX', '-screen', '0', '640x400x24']);
  assert.equal(target.binary, '/usr/bin/xmessage');
  assert.deepEqual(target.args, ['hi']);
  const probes = system.state.calls.filter((call) => call.args[0] === 'getdisplaygeometry' && [':0', ':1'].includes(call.display));
  assert.equal(probes.length, 2, 'every operator display is probed before anything runs');
  // The probes ran before Xvfb was spawned.
  assert.ok(system.state.calls.findIndex((call) => call.display === ':0') < system.state.calls.findIndex((call) => call.display === ':99'));
  session.stop();
  assert.equal(lines.at(-1).event, 'stopped');
  assert.equal(
    system.state.spawned.every((item) => item.child.exitCode !== null),
    true,
    'stop kills both children',
  );
  assert.ok(session.written() > 0);
});

test('host start refuses a reachable operator display, a filesystem socket, an Xvfb that dies and a display that never comes up', async () => {
  const reach = fakeHost({ reachable: new Set([':1']) });
  await assert.rejects(reach.session.start(START), (error) => error.code === 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
  assert.equal(reach.system.state.spawned.length, 0, 'nothing is started on a broken isolation');
  // A display that demands authorization fails the X probe but still accepts a plain connect: that alone must refuse.
  const guarded = fakeHost({ socketReachable: new Set([':0']) });
  await assert.rejects(guarded.session.start(START), (error) => error.code === 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
  assert.equal(guarded.system.state.spawned.length, 0);
  const sockets = fakeHost({ sockets: ['X0'] });
  await assert.rejects(sockets.session.start(START), (error) => error.code === 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
  const dies = fakeHost({ xvfbExits: true, geometryFailures: 3 });
  const exits = dies.system.spawn;
  await assert.rejects(
    (async () => {
      const slow = host.createHost({
        spawn: exits,
        spawnSync: dies.system.spawnSync,
        fsApi: dies.system.fsApi,
        connect: dies.system.connect,
        emit: () => {},
        sleep: () => new Promise((resolve) => setImmediate(resolve)),
      });
      await slow.start(START);
    })(),
    (error) => error.code === 'ENV_COMPUTER_UNAVAILABLE',
  );
  const never = fakeHost({ geometryFailures: 1000 });
  await assert.rejects(
    never.session.start(START),
    (error) => error.code === 'ENV_COMPUTER_UNAVAILABLE' && /did not become ready/.test(error.message),
  );
  const noWindow = fakeHost({ window: false });
  await noWindow.session.start({ ...START, deny_displays: undefined });
  assert.equal(noWindow.lines[0].target_window, false, 'a target without a named window still starts; the report says so');
  noWindow.session.stop();
});

test('host actions: every action reaches xdotool as arguments; failures are results, never crashes', async () => {
  const { session, system, lines } = fakeHost({ failAction: 'Escape' });
  await session.start(START);
  const request = (seq, action, args = {}) => session.handle(JSON.stringify({ seq, action, args }));
  request(1, 'click', { x: 5, y: 6, button: 1 });
  request(2, 'type', { text: 'hello' });
  request(3, 'scroll', { direction: 'down', amount: 2 });
  request(4, 'key', { key: 'Escape' });
  request(5, 'format_disk', {});
  request(6, 'move', { x: 9999, y: 1 });
  session.handle('{not json');
  session.handle(JSON.stringify({ action: 'move', args: { x: 1, y: 1 } }));
  session.handle(JSON.stringify({ seq: 'one', action: 'move', args: { x: 1, y: 1 } }));
  const results = lines.filter((line) => line.event === 'result');
  assert.deepEqual(
    results.map((line) => [line.seq, line.ok, line.code ?? line.action]),
    [
      [1, true, 'click'],
      [2, true, 'type'],
      [3, true, 'scroll'],
      [4, false, 'ENV_COMPUTER_ACTION_FAILED'],
      [5, false, 'ENV_COMPUTER_INPUT_INVALID'],
      [6, false, 'ENV_COMPUTER_INPUT_INVALID'],
      [null, false, 'ENV_COMPUTER_INPUT_INVALID'],
      [null, false, 'ENV_COMPUTER_INPUT_INVALID'],
      [null, false, 'ENV_COMPUTER_INPUT_INVALID'],
    ],
  );
  assert.equal(results[0].target_alive, true);
  const typed = system.state.calls.find((call) => call.args[0] === 'type');
  assert.deepEqual(typed.args, ['type', '--delay', '12', '--', 'hello']);
  assert.equal(typed.display, ':99');
  session.stop();
});

test('host screenshots: PNG with digest, ceilings, quota and the session output budget', async () => {
  const shot = fakeHost();
  await shot.session.start(START);
  shot.session.handle(JSON.stringify({ seq: 1, action: 'screenshot', args: {} }));
  const result = shot.lines.at(-1);
  assert.equal(result.ok, true);
  const png = Buffer.from(result.png_base64, 'base64');
  assert.deepEqual([result.width, result.height, result.bytes, result.sha256], [640, 400, png.length, sha256(png)]);
  assert.equal(decodePng(png).colorType, 3);

  const broken = fakeHost({ xwdStatus: 1 });
  await broken.session.start(START);
  broken.session.handle(JSON.stringify({ seq: 1, action: 'screenshot', args: {} }));
  assert.equal(broken.lines.at(-1).code, 'ENV_COMPUTER_SCREENSHOT_FAILED');
  const garbled = fakeHost({ xwd: 'text' });
  await garbled.session.start(START);
  garbled.session.handle(JSON.stringify({ seq: 1, action: 'screenshot', args: {} }));
  assert.equal(garbled.lines.at(-1).code, 'ENV_COMPUTER_SCREENSHOT_FAILED');

  const big = fakeHost({ xwd: xwd({ pixel: noisy }) });
  await big.session.start(START);
  big.session.handle(JSON.stringify({ seq: 1, action: 'screenshot', args: {} }));
  assert.equal(
    big.lines.at(-1).code,
    'ENV_COMPUTER_SCREENSHOT_TOO_LARGE',
    'a screen that does not fit the output budget is refused, not truncated',
  );

  const quota = fakeHost({}, { ...contract.LIMITS, max_screenshots: 1 });
  await quota.session.start(START);
  quota.session.handle(JSON.stringify({ seq: 1, action: 'screenshot', args: {} }));
  quota.session.handle(JSON.stringify({ seq: 2, action: 'screenshot', args: {} }));
  assert.deepEqual([quota.lines.at(-2).ok, quota.lines.at(-1).code], [true, 'ENV_COMPUTER_SCREENSHOT_QUOTA']);

  const budget = fakeHost({}, { ...contract.LIMITS, max_output_bytes: 4500 });
  await budget.session.start(START);
  budget.session.handle(JSON.stringify({ seq: 1, action: 'screenshot', args: {} }));
  assert.equal(budget.lines.at(-1).code, 'ENV_COMPUTER_OUTPUT_BUDGET');
});

test('host process entry: start failure, request loop, stop line and end of input', async () => {
  const run = async (script, hostOverrides) => {
    const stdin = new EventEmitter();
    const written = [];
    const exits = [];
    const system = fakeSystem(hostOverrides);
    const session = host.createHost({
      spawn: system.spawn,
      spawnSync: system.spawnSync,
      fsApi: system.fsApi,
      connect: system.connect,
      emit: (line) => written.push(JSON.parse(line)),
      sleep: () => Promise.resolve(),
    });
    await host.main({
      argv: ['node', 'host', JSON.stringify(START)],
      stdin,
      stdout: { write: (line) => written.push(JSON.parse(line)) },
      exit: (code) => exits.push(code),
      host: session,
    });
    script(stdin);
    return { written, exits, system };
  };
  const split = await run((stdin) => {
    const second = JSON.stringify({ seq: 2, action: 'move', args: { x: 2, y: 2 } });
    stdin.emit('data', Buffer.from(`${JSON.stringify({ seq: 1, action: 'move', args: { x: 1, y: 1 } })}\n${second.slice(0, 10)}`));
    stdin.emit('data', Buffer.from(`${second.slice(10)}\n`));
    stdin.emit('data', Buffer.from(`${JSON.stringify({ op: 'stop' })}\n`));
  });
  assert.deepEqual(
    split.written.map((line) => line.event),
    ['ready', 'result', 'result', 'stopped'],
  );
  assert.deepEqual(split.exits, [0]);
  const ended = await run((stdin) => stdin.emit('end'));
  assert.equal(ended.written.at(-1).event, 'stopped');
  assert.deepEqual(ended.exits, [0]);

  const failing = [];
  const exits = [];
  await host.main({
    argv: ['node', 'host', JSON.stringify(START)],
    stdin: new EventEmitter(),
    stdout: { write: (line) => failing.push(JSON.parse(line)) },
    exit: (code) => exits.push(code),
    host: {
      start: () => Promise.reject(new host.HostError('no display', 'ENV_COMPUTER_UNAVAILABLE')),
      handle() {},
      stop: () => failing.push({ event: 'stopped' }),
    },
  });
  assert.deepEqual(failing, [{ event: 'error', code: 'ENV_COMPUTER_UNAVAILABLE' }, { event: 'stopped' }]);
  assert.deepEqual(exits, [1]);
  const crashes = [];
  await host.main({
    argv: ['node', 'host', 'not json'],
    stdin: new EventEmitter(),
    stdout: { write: (line) => crashes.push(JSON.parse(line)) },
    exit() {},
    host: { start: () => Promise.reject(new Error('boom')), handle() {}, stop() {} },
  });
  assert.equal(crashes[0].code, 'ENV_COMPUTER_UNAVAILABLE', 'an unexpected failure is reported with a closed code');
});

// ---------------------------------------------------------------------------------------------------------------
// The controller, against a scripted terminal.
// ---------------------------------------------------------------------------------------------------------------

const PNG = host.encodePng(640, 400, Buffer.alloc(640 * 400 * 3));
const GOOD_SHOT = (seq) => ({
  event: 'result',
  seq,
  ok: true,
  action: 'screenshot',
  width: 640,
  height: 400,
  bytes: PNG.length,
  sha256: sha256(PNG),
  png_base64: PNG.toString('base64'),
});

/** A terminal whose host answers from a script. `respond(line)` returns the events to send back for one request line. */
function fakeTerminal(options = {}) {
  const state = { lines: [], terminated: 0, finished: false, ...options };
  const start = (launch) => {
    state.launch = launch;
    let resolveCompletion;
    let rejectCompletion;
    const completion = new Promise((resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    });
    completion.catch(() => {});
    const send = (event) => {
      const text = `${JSON.stringify(event)}\n`;
      for (let at = 0; at < text.length; at += 3000)
        launch.onOutput({ kind: 'output', stream: 'stdout', data: Buffer.from(text.slice(at, at + 3000)).toString('base64') });
    };
    state.send = send;
    state.finish = (result) => {
      state.finished = true;
      resolveCompletion(result ?? { status: 'succeeded', descendants_terminated: true });
    };
    state.crash = () => rejectCompletion(new Error('Terminal outcome uncertain'));
    const terminal = {
      ready: state.readyError ? Promise.reject(state.readyError) : Promise.resolve({}),
      completion,
      group: '/fake/group',
      async command(action, input) {
        const line = JSON.parse(Buffer.from(input.data, 'base64').toString('utf8'));
        state.lines.push(line);
        if (line.op === 'stop') {
          if (!state.ignoreStop) state.finish(state.stopResult);
          return { kind: 'ack' };
        }
        for (const event of state.respond?.(line, state) ?? []) send(event);
        return { kind: 'ack' };
      },
      async terminate() {
        state.terminated += 1;
        state.finish(state.terminateResult);
        return state.terminateResult ?? { status: 'terminated', descendants_terminated: true };
      },
    };
    if (state.startError) throw state.startError;
    if (state.greeting !== null)
      setImmediate(() =>
        send(state.greeting ?? { event: 'ready', display: { width: 640, height: 400 }, sockets: [], target_window: true }),
      );
    return terminal;
  };
  return { state, start };
}

function service(options = {}) {
  const events = [];
  const approvalEvents = [];
  let clock = Date.parse('2026-10-15T12:00:00Z');
  const approvals = createApprovalGate({ ledger: (event) => approvalEvents.push(event), now: () => new Date(clock), ttl_ms: 5000 });
  const terminal = fakeTerminal({
    respond: (line) =>
      line.action === 'screenshot'
        ? [GOOD_SHOT(line.seq)]
        : [{ event: 'result', seq: line.seq, ok: true, action: line.action, target_alive: true }],
    ...options.terminal,
  });
  const timers = [];
  const media = [];
  const instance = computer.createComputerService({
    policy: { profile: 'P1' },
    toolchain: { status: 'ready' },
    approvals,
    mediaStore: {
      put(bytes, meta) {
        media.push({ bytes, meta });
        return { digest: sha256(bytes), bytes: bytes.length, artifact_ref: `artifact://sha256/${sha256(bytes)}` };
      },
    },
    startTerminal: terminal.start,
    ledger: (event) => events.push(event),
    now: () => new Date(clock),
    // The session deadline is captured so a test can fire it; the short waits (start, action, stop) run on real timers.
    schedule: (fn, ms) => {
      if (ms < 5000) return setTimeout(fn, ms);
      const timer = { fn, ms, cleared: false, unref() {} };
      timers.push(timer);
      return timer;
    },
    unschedule: (timer) => {
      if (timer && 'cleared' in timer) timer.cleared = true;
      else clearTimeout(timer);
    },
    newId: () => 'session-1',
    waits: { start: 200, action: 200, stop: 200 },
    containsCredential: (text) => /sk-secret/.test(text),
    denyDisplays: [':0'],
    ...options.service,
  });
  return { instance, events, approvals, approvalEvents, terminal, timers, media, advance: (ms) => (clock += ms) };
}

const TARGET = { target: { command: '/usr/bin/xmessage', args: ['hi'] }, timeout_ms: 10_000 };
const ledgerTypes = (events) => events.map((event) => event.type);

async function opened(options) {
  const fixture = service(options);
  const started = await fixture.instance.start(TARGET);
  assert.equal(started.status, 'started', JSON.stringify(started));
  return { ...fixture, started, id: started.session_id };
}

test('controller start: a session opens with isolation evidence, and its host runs as a sandboxed job with the limits the contract names', async () => {
  const { terminal, started, events } = await opened();
  assert.deepEqual(started.isolation, { profile: 'P1', operator_display_denied: 1, x_sockets: 0 });
  assert.equal(started.expires_at, '2026-10-15T12:00:10.000Z');
  const { launch } = terminal.state;
  assert.equal(launch.mode, 'job');
  assert.equal(launch.host_node, true);
  assert.equal(launch.timeout_ms, 12_000);
  assert.equal(launch.max_output_bytes, 65_536);
  assert.deepEqual(launch.command.slice(0, 2), ['/usr/bin/node', '/workspace/computer-host.js']);
  assert.deepEqual(JSON.parse(launch.command[2]), { ...contract.parseStart(TARGET).data, deny_displays: [':0'] });
  assert.deepEqual(ledgerTypes(events), ['environment.computer.session_opened']);
});

test('controller start refusals and BLOCKED states are explicit and ledgered', async () => {
  const code = async (options, input = TARGET) => {
    const fixture = service(options);
    const result = await fixture.instance.start(input);
    return { result, fixture };
  };
  assert.equal((await code({}, { target: 'x' })).result.code, 'ENV_COMPUTER_INPUT_INVALID');
  const p0 = await code({ service: { policy: { profile: 'P0' } } });
  assert.deepEqual([p0.result.status, p0.result.code], ['blocked', 'ENV_COMPUTER_PROFILE_INSUFFICIENT']);
  assert.equal((await code({ service: { policy: { profile: 'P2' } } })).result.status, 'started');
  const noToolchain = await code({
    service: { toolchain: { status: 'blocked', code: 'ENV_TOOLCHAIN_SYSTEM_MISSING', cause: 'xdotool is not installed' } },
  });
  assert.deepEqual(
    [noToolchain.result.status, noToolchain.result.code, noToolchain.result.cause],
    ['blocked', 'ENV_TOOLCHAIN_SYSTEM_MISSING', 'xdotool is not installed'],
  );
  assert.ok(ledgerTypes(noToolchain.fixture.events).includes('environment.computer.blocked'));
  const launch = await code({ terminal: { startError: new Error('no bwrap') } });
  assert.deepEqual([launch.result.code, launch.result.cause], ['ENV_COMPUTER_LAUNCH_FAILED', 'no bwrap']);
  const notReady = await code({ terminal: { readyError: new Error('terminal closed') } });
  assert.equal(notReady.result.code, 'ENV_COMPUTER_LAUNCH_FAILED');
  assert.equal(notReady.fixture.terminal.state.terminated, 1, 'a launch that never became ready is torn down');
  const unavailable = await code({ terminal: { greeting: { event: 'error', code: 'ENV_COMPUTER_UNAVAILABLE' } } });
  assert.deepEqual([unavailable.result.status, unavailable.result.code], ['blocked', 'ENV_COMPUTER_UNAVAILABLE']);
  const isolation = await code({ terminal: { greeting: { event: 'error', code: 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN' } } });
  assert.deepEqual([isolation.result.status, isolation.result.code], ['refused', 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN']);
  const weird = await code({ terminal: { greeting: { event: 'error', code: 'lowercase' } } });
  assert.equal(weird.result.status, 'blocked', 'an unknown host code collapses to a closed one');
  const silent = await code({ terminal: { greeting: null } });
  assert.equal(silent.result.code, 'ENV_COMPUTER_UNAVAILABLE', 'a host that says nothing is BLOCKED, not waited on forever');
  const socket = await code({ terminal: { greeting: { event: 'ready', display: { width: 640, height: 400 }, sockets: ['X0'] } } });
  assert.equal(socket.result.code, 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
  const noList = await code({ terminal: { greeting: { event: 'ready', display: { width: 640, height: 400 } } } });
  assert.equal(noList.result.code, 'ENV_COMPUTER_DISPLAY_ISOLATION_BROKEN');
  assert.equal(unavailable.fixture.terminal.state.terminated, 1, 'a session that failed to start is torn down');
});

test('only one session at a time; a new one starts after the first is stopped', async () => {
  const { instance, id, events } = await opened();
  const second = await instance.start(TARGET);
  assert.deepEqual([second.status, second.code], ['refused', 'ENV_COMPUTER_SESSION_ACTIVE']);
  assert.equal((await instance.stop(id)).status, 'stopped');
  assert.deepEqual(instance.state(), { active: false, uncertain: false });
  assert.equal((await instance.start(TARGET)).status, 'started');
  assert.ok(ledgerTypes(events).includes('environment.computer.refused'));
});

test('the abstract-socket probe sees a listening display and nothing else, without any X protocol', async () => {
  assert.equal(await host.abstractSocketReachable(':61'), false, 'nothing listens there');
  const server = net.createServer((socket) => socket.destroy());
  await new Promise((resolve) => server.listen({ path: '\0/tmp/.X11-unix/X61' }, resolve));
  try {
    assert.equal(await host.abstractSocketReachable(':61'), true);
    assert.equal(await host.abstractSocketReachable(':61.0'), true, 'the screen suffix is ignored');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(await host.abstractSocketReachable(':61'), false);
});

test('one session at a time holds under concurrent starts: the slot is taken before anything is awaited', async () => {
  const fixture = service();
  const [first, second, third] = await Promise.all([
    fixture.instance.start(TARGET),
    fixture.instance.start(TARGET),
    fixture.instance.start(TARGET),
  ]);
  const outcomes = [first, second, third].map((result) => result.code ?? result.status).sort();
  assert.deepEqual(outcomes, ['ENV_COMPUTER_SESSION_ACTIVE', 'ENV_COMPUTER_SESSION_ACTIVE', 'started']);
  assert.equal(fixture.terminal.state.launch.mode, 'job');
  assert.equal(
    fixture.events.filter((event) => event.type === 'environment.computer.session_opened').length,
    1,
    'one display was launched',
  );
  const winner = [first, second, third].find((result) => result.status === 'started');
  assert.equal(
    (await fixture.instance.stop(winner.session_id)).status,
    'stopped',
    'the one session that started is the one that can be stopped',
  );
});

test('a start that fails releases the slot; a start while another is still launching is refused', async () => {
  const slow = service({ terminal: { greeting: null }, service: { waits: { start: 150, action: 200, stop: 200 } } });
  const launching = slow.instance.start(TARGET);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    (await slow.instance.start(TARGET)).code,
    'ENV_COMPUTER_SESSION_ACTIVE',
    'the slot is held while the first start waits for its host',
  );
  assert.equal((await launching).status, 'blocked');
  assert.deepEqual(slow.instance.state(), { active: false, uncertain: false }, 'the failed launch freed the slot after its teardown');
  const retry = await slow.instance.start(TARGET);
  assert.equal(retry.status, 'blocked', 'a new attempt is allowed (and fails the same way here)');
});

test('no start overlaps the drain of the previous session, and the old timer never closes the new one', async () => {
  let counter = 0;
  const fixture = service({
    terminal: { ignoreStop: true },
    service: { newId: () => `session-${(counter += 1)}`, waits: { start: 200, action: 200, stop: 400 } },
  });
  const first = await fixture.instance.start(TARGET);
  const oldTimer = fixture.timers.find((timer) => timer.ms === 10_000);
  const stopping = fixture.instance.stop(first.session_id);
  await new Promise((resolve) => setImmediate(resolve));
  const during = await fixture.instance.start(TARGET);
  assert.equal(during.code, 'ENV_COMPUTER_SESSION_ACTIVE', 'the slot is still held while the old session drains');
  assert.equal(
    (await fixture.instance.screenshot(first.session_id)).code,
    'ENV_COMPUTER_SESSION_CLOSED',
    'a closing session takes no more actions',
  );
  assert.equal((await stopping).status, 'stopped');
  assert.deepEqual(fixture.instance.state(), { active: false, uncertain: false });
  fixture.terminal.state.ignoreStop = false;
  const second = await fixture.instance.start(TARGET);
  assert.equal(second.status, 'started');
  assert.notEqual(second.session_id, first.session_id);
  oldTimer.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.instance.state().active, true, 'the expiry of the old session did not touch the new one');
  assert.equal((await fixture.instance.screenshot(second.session_id)).status, 'ok');
  assert.equal(fixture.events.filter((event) => event.type === 'environment.computer.session_expired').length, 0);
  assert.equal(fixture.events.filter((event) => event.type === 'environment.computer.session_closed').length, 1);
});

test('a screenshot becomes untrusted display data with provenance, stored by digest, and the controller re-hashes what the host claims', async () => {
  const { instance, id, media, events } = await opened();
  const output = await instance.screenshot(id);
  assert.equal(output.status, 'ok', JSON.stringify(output));
  assert.equal(output.seq, 1);
  const [shot] = output.media;
  assert.equal(MediaSourceSchema.safeParse(shot).success, true, 'a valid media-source');
  assert.deepEqual(
    [shot.origin, shot.authority, shot.trust, shot.media_type, shot.width, shot.height],
    ['display', 'data', 'untrusted', 'image/png', 640, 400],
  );
  assert.equal(shot.digest, sha256(PNG));
  assert.equal(shot.transform[0].id, 'computer-display');
  assert.equal(media[0].meta.source_ref, shot.source_ref);
  assert.match(shot.source_ref, /^environment\.computer\.screenshot\.session-1\.1$/);
  const [capture] = output.captures;
  assert.deepEqual([capture.session_id, capture.seq, capture.digest, capture.source_ref], ['session-1', 1, shot.digest, shot.source_ref]);
  assert.match(capture.retrieved_at, /^2026-10-15T12:00:00/);
  assert.ok(ledgerTypes(events).includes('environment.computer.screenshot'));

  const lies = async (patch) => {
    const fixture = await opened({ terminal: { respond: (line) => [{ ...GOOD_SHOT(line.seq), ...patch(line) }] } });
    return fixture.instance.screenshot(fixture.id);
  };
  assert.equal((await lies(() => ({ sha256: 'f'.repeat(64) }))).code, 'ENV_COMPUTER_RESULT_INVALID');
  assert.equal((await lies(() => ({ bytes: PNG.length + 1 }))).code, 'ENV_COMPUTER_RESULT_INVALID');
  assert.equal((await lies(() => ({ sha256: 'short' }))).code, 'ENV_COMPUTER_RESULT_INVALID');
  assert.equal(
    (
      await lies(() => ({
        png_base64: Buffer.from('not a png at all').toString('base64'),
        bytes: 16,
        sha256: sha256(Buffer.from('not a png at all')),
      }))
    ).code,
    'ENV_COMPUTER_RESULT_INVALID',
  );
  const small = host.encodePng(320, 240, Buffer.alloc(320 * 240 * 3));
  assert.equal(
    (await lies(() => ({ png_base64: small.toString('base64'), bytes: small.length, sha256: sha256(small) }))).code,
    'ENV_COMPUTER_RESULT_INVALID',
    'a picture of another size is not this display',
  );
  assert.equal((await lies(() => ({ png_base64: 'not base64!' }))).code, 'ENV_COMPUTER_OUTPUT_INVALID');
  assert.equal((await lies(() => ({ png_base64: undefined }))).code, 'ENV_COMPUTER_OUTPUT_INVALID');
});

test('an action without an approval is denied, and nothing reaches the host', async () => {
  const { instance, id, terminal } = await opened();
  await instance.screenshot(id);
  const sent = terminal.state.lines.length;
  const denied = await instance.act(id, { action: 'click', x: 10, y: 10 });
  assert.deepEqual([denied.status, denied.code], ['refused', 'ENV_COMPUTER_APPROVAL_REQUIRED']);
  const invented = await instance.act(id, { action: 'click', x: 10, y: 10 }, { approval_id: 'made-up' });
  assert.equal(invented.code, 'ENV_COMPUTER_APPROVAL_MISSING');
  assert.equal((await instance.act(id, { action: 'bogus' })).code, 'ENV_COMPUTER_INPUT_INVALID');
  assert.equal(terminal.state.lines.length, sent, 'no request was forwarded');
});

test('an approved action runs once, bound to session, sequence, action, arguments and the last screenshot', async () => {
  const { instance, approvals, id, terminal, events } = await opened();
  assert.equal(
    instance.requestApproval(id, { action: 'click', x: 10, y: 10 }).code,
    'ENV_COMPUTER_SCREENSHOT_REQUIRED',
    'the approver needs a screenshot to look at',
  );
  assert.equal((await instance.act(id, { action: 'click', x: 10, y: 10 }, { approval_id: 'x' })).code, 'ENV_COMPUTER_SCREENSHOT_REQUIRED');
  await instance.screenshot(id);
  const approve = (action) => {
    const pending = instance.requestApproval(id, action);
    assert.equal(pending.status, 'pending', JSON.stringify(pending));
    approvals.approve(pending.request_id, { approver: 'operator' });
    return pending.request_id;
  };
  const click = { action: 'click', x: 10, y: 40 };
  const approval = approve(click);
  // A different action, other arguments or another sequence do not use this approval.
  assert.equal(
    (await instance.act(id, { action: 'click', x: 11, y: 40 }, { approval_id: approval })).code,
    'ENV_COMPUTER_APPROVAL_MISMATCH',
  );
  assert.equal(
    (await instance.act(id, { action: 'double_click', x: 10, y: 40 }, { approval_id: approval })).code,
    'ENV_COMPUTER_APPROVAL_MISMATCH',
  );
  const done = await instance.act(id, click, { approval_id: approval });
  assert.deepEqual([done.status, done.seq, done.action, done.target_alive], ['ok', 2, 'click', true]);
  assert.deepEqual(terminal.state.lines.at(-1), { seq: 2, action: 'click', args: { x: 10, y: 40, button: 1 } });
  assert.equal((await instance.act(id, click, { approval_id: approval })).code, 'ENV_COMPUTER_APPROVAL_REUSED');
  assert.ok(ledgerTypes(events).includes('environment.computer.action_executed'));

  // A new screenshot changes what the approver saw: an approval taken earlier no longer fits.
  const stale = approve({ action: 'type', text: 'hello' });
  await instance.screenshot(id);
  assert.equal((await instance.act(id, { action: 'type', text: 'hello' }, { approval_id: stale })).code, 'ENV_COMPUTER_APPROVAL_MISMATCH');
  const fresh = approve({ action: 'type', text: 'hello' });
  assert.equal((await instance.act(id, { action: 'type', text: 'hello' }, { approval_id: fresh })).status, 'ok');
  // An approval taken for one session position cannot be moved to another.
  const skipped = approve({ action: 'key', key: 'Return' });
  await instance.screenshot(id);
  assert.equal((await instance.act(id, { action: 'key', key: 'Return' }, { approval_id: skipped })).code, 'ENV_COMPUTER_APPROVAL_MISMATCH');
});

test('approval requests are refused for screenshots, credentials, blanket modes and unknown sessions', async () => {
  const { instance, id } = await opened();
  await instance.screenshot(id);
  assert.equal(instance.requestApproval(id, { action: 'screenshot' }).code, 'ENV_COMPUTER_APPROVAL_NOT_NEEDED');
  assert.equal(instance.requestApproval(id, { action: 'click', x: 9999, y: 1 }).code, 'ENV_COMPUTER_INPUT_INVALID');
  assert.equal(instance.requestApproval(id, { action: 'type', text: 'my sk-secret token' }).code, 'ENV_COMPUTER_CREDENTIAL_DETECTED');
  assert.equal(
    instance.requestApproval(id, { action: 'click', x: 1, y: 1 }, { execution_mode: 'bypass' }).code,
    'ENV_COMPUTER_APPROVAL_NOT_APPLICABLE',
  );
  assert.equal(
    instance.requestApproval(id, { action: 'click', x: 1, y: 1 }, { approve_all: true }).code,
    'ENV_COMPUTER_APPROVAL_NOT_APPLICABLE',
  );
  assert.equal(instance.requestApproval('other-session', { action: 'click', x: 1, y: 1 }).code, 'ENV_COMPUTER_SESSION_CLOSED');
  assert.equal((await instance.screenshot('other-session')).code, 'ENV_COMPUTER_SESSION_CLOSED');
  assert.equal((await instance.act('other-session', { action: 'screenshot' })).code, 'ENV_COMPUTER_SESSION_CLOSED');
});

test('host failures, silence and malformed answers are refusals with closed codes; the session stays usable', async () => {
  const answers = [
    (line) => [{ event: 'result', seq: line.seq, ok: false, code: 'ENV_COMPUTER_ACTION_FAILED' }],
    (line) => [{ event: 'result', seq: line.seq, ok: false, code: 'whatever the host felt like' }],
    (line) => [{ event: 'result', seq: line.seq + 1, ok: true }],
    () => [],
    (line) => [{ event: 'result', seq: line.seq, ok: false, code: 'ENV_COMPUTER_OUTPUT_BUDGET' }],
  ];
  const codes = [];
  for (const respond of answers) {
    const { instance, id } = await opened({ terminal: { respond } });
    const shot = await instance.screenshot(id);
    codes.push(shot.code);
    assert.equal(instance.state().active, true);
  }
  assert.deepEqual(codes, [
    'ENV_COMPUTER_ACTION_FAILED',
    'ENV_COMPUTER_ACTION_FAILED',
    'ENV_COMPUTER_OUTPUT_INVALID',
    'ENV_COMPUTER_TIMEOUT',
    'ENV_COMPUTER_OUTPUT_BUDGET',
  ]);
  const failing = await opened({
    terminal: {
      respond: (line) =>
        line.action === 'screenshot'
          ? [GOOD_SHOT(line.seq)]
          : [{ event: 'result', seq: line.seq, ok: false, code: 'ENV_COMPUTER_ACTION_FAILED' }],
    },
  });
  await failing.instance.screenshot(failing.id);
  const pending = failing.instance.requestApproval(failing.id, { action: 'move', x: 1, y: 1 });
  failing.approvals.approve(pending.request_id, { approver: 'operator' });
  const failed = await failing.instance.act(failing.id, { action: 'move', x: 1, y: 1 }, { approval_id: pending.request_id });
  assert.equal(failed.code, 'ENV_COMPUTER_ACTION_FAILED');
  const again = await failing.instance.act(failing.id, { action: 'move', x: 1, y: 1 }, { approval_id: pending.request_id });
  assert.equal(again.code, 'ENV_COMPUTER_APPROVAL_REUSED', 'a failed action still spent its approval');

  const broken = await opened({ terminal: { respond: (line) => [{ ...GOOD_SHOT(line.seq), png_base64: 'x'.repeat(200_000) }] } });
  assert.equal((await broken.instance.screenshot(broken.id)).code, 'ENV_COMPUTER_OUTPUT_INVALID', 'an oversize line is refused');
  const garbled = await opened({
    terminal: {
      respond: (line, state) => {
        state.launch.onOutput({ kind: 'output', stream: 'stdout', data: Buffer.from('{not json}\n').toString('base64') });
        return [GOOD_SHOT(line.seq)];
      },
    },
  });
  assert.equal((await garbled.instance.screenshot(garbled.id)).code, 'ENV_COMPUTER_OUTPUT_INVALID');
});

test('one action in flight, an action quota and a screenshot quota bound the session', async () => {
  let release;
  const gateway = new Promise((resolve) => {
    release = resolve;
  });
  const slow = await opened({
    terminal: {
      respond: (line, state) => {
        gateway.then(() => state.send(GOOD_SHOT(line.seq)));
        return [];
      },
    },
    service: { waits: { start: 200, action: 2000, stop: 200 } },
  });
  const first = slow.instance.screenshot(slow.id);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await slow.instance.screenshot(slow.id)).code, 'ENV_COMPUTER_SESSION_BUSY');
  release();
  assert.equal((await first).status, 'ok');

  const { instance, id } = await opened();
  for (let index = 0; index < contract.LIMITS.max_screenshots; index += 1) assert.equal((await instance.screenshot(id)).status, 'ok');
  assert.equal((await instance.screenshot(id)).code, 'ENV_COMPUTER_SCREENSHOT_QUOTA');
});

test('the action quota counts every request, approved or not', async () => {
  const { instance, id, approvals } = await opened({
    terminal: {
      respond: (line) =>
        line.action === 'screenshot'
          ? [GOOD_SHOT(line.seq)]
          : [{ event: 'result', seq: line.seq, ok: true, action: line.action, target_alive: true }],
    },
  });
  await instance.screenshot(id);
  let refused;
  for (let index = 0; index < contract.LIMITS.max_actions + 1; index += 1) {
    const pending = instance.requestApproval(id, { action: 'move', x: 1, y: 1 });
    if (pending.status !== 'pending') {
      refused = pending;
      break;
    }
    approvals.approve(pending.request_id, { approver: 'operator' });
    const result = await instance.act(id, { action: 'move', x: 1, y: 1 }, { approval_id: pending.request_id });
    if (result.status !== 'ok') {
      refused = result;
      break;
    }
  }
  assert.equal(refused.code, 'ENV_COMPUTER_ACTION_QUOTA');
});

test('a session expires on its deadline: it is closed and drained, later calls are refused and the expiry is ledgered', async () => {
  const fixture = await opened();
  const { instance, id, timers, terminal, events, advance } = fixture;
  const deadline = timers.find((timer) => timer.ms === 10_000);
  assert.ok(deadline, 'the session deadline is scheduled for its timeout');
  advance(10_000);
  deadline.fn();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(instance.state().active, false);
  const expired = events.find((event) => event.type === 'environment.computer.session_expired');
  assert.deepEqual([expired.reason, expired.descendants_terminated], ['expired', true]);
  assert.equal(terminal.state.finished, true, 'the host job is gone');
  assert.equal((await instance.screenshot(id)).code, 'ENV_COMPUTER_SESSION_CLOSED');
  assert.equal(deadline.cleared, true);

  // Between the deadline and the timer firing, the clock alone refuses the call.
  const late = await opened();
  late.advance(10_001);
  assert.equal((await late.instance.screenshot(late.id)).code, 'ENV_COMPUTER_SESSION_EXPIRED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(late.instance.state().active, false);
});

test('stop drains the session; a host that ignores stop is terminated; an unprovable drain blocks the next session', async () => {
  const clean = await opened();
  const stopped = await clean.instance.stop(clean.id);
  assert.deepEqual([stopped.status, stopped.descendants_terminated], ['stopped', true]);
  assert.deepEqual(clean.terminal.state.lines.at(-1), { op: 'stop' });
  assert.equal((await clean.instance.stop(clean.id)).code, 'ENV_COMPUTER_SESSION_CLOSED');
  const closed = clean.events.find((event) => event.type === 'environment.computer.session_closed');
  assert.deepEqual([closed.reason, closed.actions, closed.descendants_terminated], ['stopped', 0, true]);

  const stubborn = await opened({ terminal: { ignoreStop: true } });
  const killed = await stubborn.instance.stop(stubborn.id);
  assert.equal(killed.status, 'stopped');
  assert.equal(stubborn.terminal.state.terminated, 1, 'the cgroup kill is the fallback');

  const unproven = await opened({ terminal: { stopResult: { status: 'succeeded', descendants_terminated: false } } });
  const uncertain = await unproven.instance.stop(unproven.id);
  assert.deepEqual([uncertain.status, uncertain.descendants_terminated], ['uncertain', false]);
  assert.deepEqual(unproven.instance.state(), { active: false, uncertain: true });
  const blocked = await unproven.instance.start(TARGET);
  assert.equal(blocked.code, 'ENV_COMPUTER_SESSION_UNCERTAIN', 'uncertainty is observable and blocking, never a pass');

  const broken = await opened({ terminal: { stopResult: undefined } });
  broken.terminal.state.finish = () => broken.terminal.state.crash();
  assert.equal((await broken.instance.stop(broken.id)).status, 'uncertain');

  const unkillable = await opened({
    terminal: { ignoreStop: true, terminateResult: { status: 'terminated', descendants_terminated: false } },
  });
  assert.equal((await unkillable.instance.stop(unkillable.id)).status, 'uncertain');
});

test('a session whose host ends on its own is closed; one that cannot be proved drained is uncertain', async () => {
  const ended = await opened();
  ended.terminal.state.finish({ status: 'timed_out', descendants_terminated: true });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(ended.instance.state().active, false);
  assert.equal(ended.events.find((event) => event.reason === 'terminated').descendants_terminated, true);
  assert.equal((await ended.instance.screenshot(ended.id)).code, 'ENV_COMPUTER_SESSION_CLOSED');

  const crashed = await opened();
  crashed.terminal.state.crash();
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(crashed.instance.state(), { active: false, uncertain: true });
});

test('the event channel assembles frames, bounds a line and reports closure and silence', async () => {
  const channel = computer.createEventChannel();
  channel.feed('{"event":"a"');
  channel.feed('}\n{"event":"b"}\n');
  assert.equal((await channel.next(50)).event, 'a');
  assert.equal((await channel.next(50)).event, 'b');
  assert.equal((await channel.next(10)).event, 'timeout');
  const waiting = channel.next(1000);
  channel.feed('{"event":"late"}\n');
  assert.equal((await waiting).event, 'late');
  const parked = channel.next(1000);
  channel.close();
  assert.equal((await parked).event, 'closed');
  assert.equal((await channel.next(10)).event, 'closed');
  const bounded = computer.createEventChannel();
  bounded.feed('x'.repeat(200_000));
  assert.equal((await bounded.next(10)).code, 'ENV_COMPUTER_OUTPUT_INVALID');
});

test('the package entry loads computer-use lazily and exposes the same contract', () => {
  assert.equal(environment.COMPUTER_CONTRACT, 'environment.computer.v1');
  assert.equal(environment.createComputerService, computer.createComputerService);
  assert.equal(environment.prepareComputerToolchain, computer.prepareComputerToolchain);
  assert.equal(environment.parseComputerStart, contract.parseStart);
  assert.equal(environment.parseComputerAction, contract.parseAction);
  assert.equal(environment.COMPUTER_INPUT_SCHEMA, contract.COMPUTER_INPUT_SCHEMA);
  assert.equal(environment.COMPUTER_OUTPUT_SCHEMA, contract.COMPUTER_OUTPUT_SCHEMA);
  assert.equal(environment.ComputerError, contract.ComputerError);
  assert.equal(typeof environment.createDefaultComputerService, 'function');
});

// ---------------------------------------------------------------------------------------------------------------
// Real display session: Xvfb, xdotool, xwd and a real GUI target (xmessage) in the P1 sandbox.
// A missing binary or pin is BLOCKED and fails these tests; they never pass on a mock.
// ---------------------------------------------------------------------------------------------------------------

describe('real display session in the P1 sandbox', () => {
  before(() => {
    const probe = computer.prepareComputerToolchain({
      verifySystemPin: systemPin,
      cacheDirectory: CACHE,
      destination: temp('hseos-computer-probe-'),
      binaries: ['/usr/bin/Xvfb', '/usr/bin/xwd', '/usr/bin/xdotool', '/usr/bin/xmessage'],
    });
    assert.equal(probe.status, 'ready', `BLOCKED: computer-use cannot run here (${probe.code}: ${probe.cause})`);
  });

  function real(overrides = {}) {
    const workspaceRoot = temp('hseos-computer-main-');
    const workspace = path.join(workspaceRoot, 'workspace');
    fs.mkdirSync(workspace);
    fs.writeFileSync(path.join(workspaceRoot, 'protected'), 'protected');
    const ready = computer.prepareComputerToolchain({
      verifySystemPin: systemPin,
      cacheDirectory: CACHE,
      destination: workspace,
    });
    assert.equal(ready.status, 'ready', `BLOCKED: ${ready.code}: ${ready.cause}`);
    const policy = createIsolationPolicy({
      backend: 'bwrap',
      host_workspace: workspace,
      main_checkout: workspaceRoot,
      protected_paths: [path.join(workspaceRoot, 'protected')],
      profile: 'P1',
    });
    const events = [];
    const approvals = createApprovalGate({ ledger: (event) => events.push(event) });
    const mediaStore = new ContextMediaStore({ root: temp('hseos-computer-media-') });
    const instance = environment.createDefaultComputerService({
      policy,
      toolchain: ready,
      approvals,
      mediaStore,
      ledger: (event) => events.push(event),
      ...overrides,
    });
    return { instance, approvals, mediaStore, events };
  }

  const dialog = { target: { command: '/usr/bin/xmessage', args: ['-buttons', 'ok:0,cancel:1', 'hello hseos'] }, timeout_ms: 60_000 };
  const approveAndAct = async ({ instance, approvals }, id, action) => {
    const pending = instance.requestApproval(id, action);
    assert.equal(pending.status, 'pending', JSON.stringify(pending));
    approvals.approve(pending.request_id, { approver: 'operator' });
    return instance.act(id, action, { approval_id: pending.request_id });
  };

  test('start, screenshot, approved click, screenshot and stop: the target reacts, provenance holds and nothing survives', async () => {
    const fixture = real();
    const { instance, mediaStore, events } = fixture;
    const started = await instance.start(dialog);
    assert.equal(started.status, 'started', JSON.stringify(started));
    const id = started.session_id;
    try {
      assert.equal(started.isolation.x_sockets, 0);
      const before = await instance.screenshot(id);
      assert.equal(before.status, 'ok', JSON.stringify(before));
      const [shot] = before.media;
      assert.deepEqual([shot.origin, shot.authority, shot.trust, shot.width, shot.height], ['display', 'data', 'untrusted', 640, 400]);
      assert.equal(MediaSourceSchema.safeParse(shot).success, true);
      const png = mediaStore.load(shot);
      assert.equal(sha256(png), shot.digest);
      const seen = decodePng(png);
      assert.ok(seen.colors >= 2, 'the dialog is drawn: more than the empty black root');
      assert.deepEqual(seen.pixel(630, 390), [0, 0, 0], 'the rest of the display is the empty root');
      assert.ok(
        seen.pixel(2, 2).some((channel) => channel > 0),
        'the dialog sits in the top-left corner',
      );

      // Exercise every kind of action on the real display; the dialog stays up through all of them but the click.
      for (const action of [
        { action: 'move', x: 100, y: 100 },
        { action: 'scroll', direction: 'down', amount: 2 },
        { action: 'key', key: 'shift' },
        { action: 'type', text: 'abc' },
      ]) {
        const done = await approveAndAct(fixture, id, action);
        assert.equal(done.status, 'ok', JSON.stringify(done));
        assert.equal(done.target_alive, true);
        assert.equal((await instance.screenshot(id)).status, 'ok');
      }
      const clicked = await approveAndAct(fixture, id, { action: 'click', x: 15, y: 40 });
      assert.equal(clicked.status, 'ok', JSON.stringify(clicked));
      const afterwards = await instance.screenshot(id);
      assert.equal(afterwards.status, 'ok', JSON.stringify(afterwards));
      assert.notEqual(afterwards.media[0].digest, shot.digest, 'the click reached the target: the dialog closed');
      assert.equal(decodePng(mediaStore.load(afterwards.media[0])).colors, 1, 'only the empty root is left');
    } finally {
      const stopped = await instance.stop(id);
      assert.equal(stopped.status, 'stopped');
      assert.equal(stopped.descendants_terminated, true);
    }
    const closed = events.find((event) => event.type === 'environment.computer.session_closed');
    assert.equal(closed.descendants_terminated, true);
    assert.deepEqual(sessionProcesses(), [], 'the kernel sees no Xvfb or target left after stop');
    assert.deepEqual(
      events.filter((event) => event.outcome).map((event) => event.outcome),
      [
        'requested',
        'approved',
        'consumed',
        'requested',
        'approved',
        'consumed',
        'requested',
        'approved',
        'consumed',
        'requested',
        'approved',
        'consumed',
        'requested',
        'approved',
        'consumed',
      ],
    );
  });

  test('an unapproved action never reaches the display; the approval of one action is not the approval of another', async () => {
    const fixture = real();
    const { instance, approvals } = fixture;
    const { session_id: id } = await instance.start(dialog);
    try {
      const first = await instance.screenshot(id);
      const denied = await instance.act(id, { action: 'click', x: 15, y: 40 });
      assert.equal(denied.code, 'ENV_COMPUTER_APPROVAL_REQUIRED');
      const pending = instance.requestApproval(id, { action: 'click', x: 15, y: 40 });
      approvals.approve(pending.request_id, { approver: 'operator' });
      const other = await instance.act(id, { action: 'click', x: 58, y: 40 }, { approval_id: pending.request_id });
      assert.equal(other.code, 'ENV_COMPUTER_APPROVAL_MISMATCH');
      const second = await instance.screenshot(id);
      assert.equal(second.media[0].digest, first.media[0].digest, 'the display did not change');
      // The screenshot moved the sequence on, so the old approval is spent as far as this position goes.
      const reused = await instance.act(id, { action: 'click', x: 15, y: 40 }, { approval_id: pending.request_id });
      assert.equal(reused.code, 'ENV_COMPUTER_APPROVAL_MISMATCH');
    } finally {
      await instance.stop(id);
    }
  });

  test("the operator's display is unreachable: even with DISPLAY set to it, the session sees only its own private one", async () => {
    const operator = process.env.DISPLAY ?? ':0';
    const fixture = real({ operatorDisplay: operator });
    const started = await fixture.instance.start(dialog);
    try {
      assert.equal(
        started.status,
        'started',
        `the host proved it cannot reach the operator display ${operator}: ${JSON.stringify(started)}`,
      );
      assert.ok(started.isolation.operator_display_denied >= 1);
      assert.equal(started.isolation.x_sockets, 0, 'no filesystem X socket exists in the sandbox');
    } finally {
      if (started.session_id) await fixture.instance.stop(started.session_id);
    }
  });

  test('a session is exclusive, closes on stop, and expires on its deadline with every descendant drained', async () => {
    const fixture = real();
    const { instance, events } = fixture;
    const first = await instance.start({ ...dialog, timeout_ms: 5000 });
    assert.equal(first.status, 'started', JSON.stringify(first));
    const second = await instance.start(dialog);
    assert.equal(second.code, 'ENV_COMPUTER_SESSION_ACTIVE', 'a second session is refused while the first is open');
    assert.equal((await instance.screenshot(first.session_id)).status, 'ok');
    await new Promise((resolve) => setTimeout(resolve, 5600));
    const late = await instance.screenshot(first.session_id);
    assert.ok(['ENV_COMPUTER_SESSION_CLOSED', 'ENV_COMPUTER_SESSION_EXPIRED'].includes(late.code), JSON.stringify(late));
    const expired = events.find((event) => event.type === 'environment.computer.session_expired');
    assert.deepEqual([expired.reason, expired.descendants_terminated], ['expired', true]);
    assert.deepEqual(sessionProcesses(), [], 'the kernel sees no Xvfb or target left after expiry');
    assert.deepEqual(fixture.instance.state(), { active: false, uncertain: false });
    const next = await instance.start(dialog);
    assert.equal(next.status, 'started', 'the next session starts once the first is drained');
    assert.equal((await instance.stop(next.session_id)).status, 'stopped');
  });

  test('a target that cannot start leaves an empty display: the session is valid, the screenshot shows nothing and the call does not hang', async () => {
    const fixture = real();
    const started = await fixture.instance.start({ target: { command: '/usr/bin/hseos-no-such-gui' }, timeout_ms: 20_000 });
    assert.equal(started.status, 'started', JSON.stringify(started));
    try {
      const shot = await fixture.instance.screenshot(started.session_id);
      assert.equal(shot.status, 'ok', JSON.stringify(shot));
      assert.equal(decodePng(fixture.mediaStore.load(shot.media[0])).colors, 1, 'only the empty root is on the display');
    } finally {
      assert.equal((await fixture.instance.stop(started.session_id)).status, 'stopped');
    }
  });
  test('two concurrent starts launch exactly one display; the loser is refused with a contract code and nothing is left over', async () => {
    const { instance } = real();
    const [first, second] = await Promise.all([instance.start(dialog), instance.start(dialog)]);
    const started = [first, second].filter((result) => result.status === 'started');
    const refused = [first, second].find((result) => result.status === 'refused');
    assert.equal(started.length, 1, JSON.stringify([first, second]));
    assert.equal(refused.code, 'ENV_COMPUTER_SESSION_ACTIVE');
    try {
      assert.equal(processesMentioning('Xvfb\0:99\0').length, 1, 'one Xvfb for the one session');
      assert.equal((await instance.screenshot(started[0].session_id)).status, 'ok', 'the winner is a usable, stoppable session');
    } finally {
      assert.equal((await instance.stop(started[0].session_id)).status, 'stopped');
    }
    assert.deepEqual(sessionProcesses(), []);
  });

  test("positive control: a display that is reachable from the host is refused from the sandbox's point of view only because of the isolation", async () => {
    // An open display (no authorization, abstract socket only) in the host's own network namespace, like the operator's.
    const display = ':58';
    const control = spawn(
      '/usr/bin/Xvfb',
      [display, '-nolisten', 'tcp', '-nolisten', 'unix', '-extension', 'GLX', '-screen', '0', '320x240x24'],
      {
        stdio: 'ignore',
        env: { PATH: '/usr/bin:/bin' },
      },
    );
    try {
      const host = require('../packages/agent-environment/computer-host');
      let reachable = false;
      for (let attempt = 0; attempt < 50 && !reachable; attempt += 1) {
        reachable = await host.abstractSocketReachable(display);
        if (!reachable) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(reachable, true, 'the control display is reachable from the host: the probe can see a display at all');
      assert.equal(
        spawnSync('/usr/bin/xdotool', ['getdisplaygeometry'], { env: { PATH: '/usr/bin:/bin', DISPLAY: display } }).status,
        0,
        'and the X client works against it from the host',
      );
      const fixture = real({ operatorDisplay: display });
      const started = await fixture.instance.start(dialog);
      try {
        assert.equal(started.status, 'started', `the same display is unreachable from inside the sandbox: ${JSON.stringify(started)}`);
      } finally {
        if (started.session_id) await fixture.instance.stop(started.session_id);
      }
    } finally {
      control.kill('SIGKILL');
    }
  });
});
