'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createIsolationPolicy } = require('../packages/agent-isolation-attestation');
const { startIsolatedTerminal } = require('../packages/agent-isolation-attestation/terminal-executor');

async function fixture(t, script, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-terminal-test-'));
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(root, 'private'), 'protected');
  fs.writeFileSync(path.join(workspace, 'main.py'), script);
  const policy = createIsolationPolicy({
    backend: 'bwrap',
    host_workspace: workspace,
    main_checkout: root,
    protected_paths: [path.join(root, 'private')],
  });
  const frames = [];
  const terminal = startIsolatedTerminal({
    policy,
    command: ['/usr/bin/python3', '-I', '-u', 'main.py'],
    mode: 'job',
    timeout_ms: 3000,
    max_output_bytes: 4096,
    onOutput: (f) => frames.push(f),
    ...options,
  });
  t.after(async () => {
    await terminal.terminate().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  await terminal.ready;
  return { terminal, frames, text: () => frames.map((f) => Buffer.from(f.data, 'base64').toString()).join('') };
}
async function until(predicate) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('observation timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('job pipes accept input and EOF; output has bounded binary frames', async (t) => {
  const { terminal, text } = await fixture(t, 'import sys\nprint(sys.stdin.read().upper(), flush=True)\n');
  assert.equal((await terminal.command('input', { data: Buffer.from('hello').toString('base64') })).bytes, 5);
  await terminal.command('eof');
  assert.equal((await terminal.completion).status, 'succeeded');
  assert.equal(text(), 'HELLO\n');
  assert.equal(fs.existsSync(terminal.group), false);
});
test('PTY exposes tty, resize and input without a host shell', async (t) => {
  const { terminal, text } = await fixture(
    t,
    `import os,sys\nprint(os.isatty(0), flush=True)\nwith open('/dev/tty','w') as tty: tty.write('controlling-tty\\n'); tty.flush()\nsys.stdin.readline()\nprint(os.get_terminal_size(0), flush=True)\n`,
    { mode: 'pty' },
  );
  await until(() => text().includes('True'));
  await terminal.command('resize', { rows: 40, cols: 100 });
  await terminal.command('input', { data: Buffer.from('go\n').toString('base64') });
  assert.equal((await terminal.completion).status, 'succeeded');
  assert.match(text(), /columns=100, lines=40/);
  assert.match(text(), /controlling-tty/);
});
test('pause freezes all descendants and continue resumes; interrupt settles', async (t) => {
  const { terminal, text } = await fixture(t, 'import time\nwhile True:\n print("tick",flush=True)\n time.sleep(.05)\n');
  await until(() => text().includes('tick'));
  await terminal.command('pause');
  await until(() => /frozen 1/.test(fs.readFileSync(path.join(terminal.group, 'cgroup.events'), 'utf8')));
  const size = text().length;
  await new Promise((r) => setTimeout(r, 130));
  assert.equal(text().length, size);
  await terminal.command('continue');
  await until(() => text().length > size);
  await terminal.command('interrupt').catch(() => {});
  assert.equal((await terminal.completion).descendants_terminated, true);
});
test('deadline includes paused time and drains detached descendants', async (t) => {
  const { terminal, text } = await fixture(
    t,
    'import os,time\npid=os.fork()\nif pid == 0: os.setsid()\nprint("alive",flush=True)\ntime.sleep(30)\n',
    { timeout_ms: 350 },
  );
  await until(() => text().includes('alive'));
  await terminal.command('pause');
  assert.equal((await terminal.completion).status, 'timed_out');
  assert.equal(fs.existsSync(terminal.group), false);
});
test('output cap stops producers; parent EOF terminates a live tree', async (t) => {
  const first = await fixture(t, 'while True: print("x"*1000,flush=True)', { max_output_bytes: 100 });
  assert.equal((await first.terminal.completion).status, 'output_limit');
  assert.equal(Buffer.byteLength(first.text()), 100);
  const second = await fixture(t, 'import time\ntime.sleep(30)');
  assert.equal((await second.terminal.terminate()).descendants_terminated, true);
});

test('invalid limits and non-nominal policies cannot reach process creation', () => {
  for (const options of [
    { mode: 'shell' },
    { rows: 0 },
    { cols: 501 },
    { timeout_ms: 0 },
    { timeout_ms: 300_001 },
    { max_output_bytes: 0 },
    { max_output_bytes: 65_537 },
  ])
    assert.throws(() =>
      startIsolatedTerminal({
        policy: {},
        command: ['invalid'],
        mode: 'job',
        timeout_ms: 10,
        max_output_bytes: 10,
        onOutput() {},
        ...options,
      }),
    );
  assert.throws(() =>
    startIsolatedTerminal({ policy: {}, command: ['/bin/true'], mode: 'job', timeout_ms: 10, max_output_bytes: 10, onOutput() {} }),
  );
});
test('failed preparation or durable output persistence tears down instead of retrying', async (t) => {
  let createdGroup;
  await assert.rejects(
    fixture(t, 'print("effect",flush=True)', {
      onPrepared: (group) => {
        createdGroup = group;
        throw new Error('intent persistence lost');
      },
    }),
    /intent persistence lost/,
  );
  await until(() => !fs.existsSync(createdGroup));
  const failed = await fixture(t, 'print("effect",flush=True)', {
    onOutput: () => {
      throw new Error('output persistence lost');
    },
  });
  await assert.rejects(failed.terminal.completion, { code: 'ENGINEERING_TERMINAL_UNCERTAIN' });
  assert.equal(fs.existsSync(failed.terminal.group), false);
});
test('host Node descriptor is readonly and invalid control dispatch is uncertain', async (t) => {
  const { terminal, text } = await fixture(t, '', { host_node: true, command: ['/usr/bin/node', '-e', 'console.log(process.version)'] });
  assert.equal((await terminal.completion).status, 'succeeded');
  assert.match(text(), new RegExp(process.version.replaceAll('.', String.raw`\.`)));
  const bad = await fixture(t, 'import time\ntime.sleep(30)');
  await assert.rejects(bad.terminal.command('unsupported'));
  await assert.rejects(bad.terminal.completion, { code: 'ENGINEERING_TERMINAL_UNCERTAIN' });
});
