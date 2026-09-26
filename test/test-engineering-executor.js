'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createIsolationPolicy } = require('../packages/agent-isolation-attestation');
const { executeIsolatedCommand } = require('../packages/agent-isolation-attestation/executor');

async function fixture(run) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-executor-test-'));
  const workspace = path.join(main, 'workspace');
  fs.mkdirSync(workspace);
  const marker = path.join(main, 'private-control');
  fs.writeFileSync(marker, 'protected');
  fs.writeFileSync(path.join(workspace, 'source.txt'), 'initial');
  const policy = createIsolationPolicy({ backend: 'bwrap', host_workspace: workspace, main_checkout: main, protected_paths: [marker] });
  const execute = (command, options = {}) =>
    executeIsolatedCommand({ policy, command, timeout_ms: 3000, max_output_bytes: 4096, ...options });
  try {
    await run({ execute, marker, policy });
  } finally {
    fs.rmSync(main, { recursive: true, force: true });
  }
}

test('Node command executes with read-only workspace, hidden controls and bounded resources', () =>
  fixture(async ({ execute, marker }) => {
    const result = await execute([
      '/usr/bin/node',
      '-e',
      `
    const fs = require('fs');
    let readonly = false;
    try { fs.writeFileSync('source.txt', 'changed'); } catch (e) { readonly = e.code === 'EROFS'; }
    console.log(JSON.stringify({ readonly, source: fs.readFileSync('source.txt','utf8'), hidden: !fs.existsSync(${JSON.stringify(marker)}), env: Object.keys(process.env) }));
  `,
    ]);
    assert.equal(result.status, 'succeeded', result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { readonly: true, source: 'initial', hidden: true, env: ['PATH', 'PWD'] });
    assert.equal(result.descendants_terminated, true);
    assert.equal(result.limits.processes, 32);
  }));

test('Python cannot create Internet or Unix sockets', () =>
  fixture(async ({ execute }) => {
    const result = await execute([
      '/usr/bin/python3',
      '-I',
      '-c',
      `
import socket, errno
for kind in [socket.AF_INET, socket.AF_UNIX]:
    try:
        socket.socket(kind)
        raise Exception('socket unexpectedly allowed')
    except OSError as error:
        assert error.errno == errno.EPERM
print('denied')
`,
    ]);
    assert.equal(result.status, 'succeeded', result.stderr);
    assert.equal(result.stdout.trim(), 'denied');
  }));

test('output flooding is bounded and every descendant is drained', () =>
  fixture(async ({ execute }) => {
    const result = await execute(['/usr/bin/python3', '-I', '-c', "import os;\nwhile True: os.write(1, b'x'*8192)"], {
      max_output_bytes: 1024,
    });
    assert.equal(result.status, 'output_limit');
    assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1024);
    assert.equal(result.descendants_terminated, true);
  }));

test('cancellation eliminates a detached descendant holding output pipes', () =>
  fixture(async ({ execute }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 300);
    try {
      const result = await execute(
        [
          '/usr/bin/python3',
          '-I',
          '-c',
          `
import os,time
if os.fork() == 0:
    os.setsid()
time.sleep(60)
`,
        ],
        { signal: controller.signal },
      );
      assert.equal(result.status, 'cancelled');
      assert.equal(result.descendants_terminated, true);
    } finally {
      clearTimeout(timer);
    }
  }));

test('parent exit drains detached descendants without waiting for their sleep', () =>
  fixture(async ({ execute }) => {
    const result = await execute(
      [
        '/usr/bin/python3',
        '-I',
        '-c',
        `
import os,time
if os.fork() == 0:
    os.setsid()
    time.sleep(60)
`,
      ],
      { timeout_ms: 300 },
    );
    assert.equal(result.status, 'succeeded');
    assert.equal(result.descendants_terminated, true);
  }));

test('forged policies and invalid budgets fail before launch', () =>
  fixture(async ({ execute, policy }) => {
    await assert.rejects(
      executeIsolatedCommand({ policy: structuredClone(policy), command: ['/usr/bin/true'], timeout_ms: 100, max_output_bytes: 1 }),
    );
    await assert.rejects(execute(['/usr/bin/true'], { timeout_ms: Infinity }));
  }));

test('a running command cannot exceed its wall-clock budget', () =>
  fixture(async ({ execute }) => {
    const result = await execute(['/usr/bin/python3', '-I', '-c', 'import time;time.sleep(60)'], { timeout_ms: 200 });
    assert.equal(result.status, 'timed_out');
    assert.equal(result.descendants_terminated, true);
  }));

test('the process limit applies to the complete descendant group', () =>
  fixture(async ({ execute }) => {
    const result = await execute([
      '/usr/bin/python3',
      '-I',
      '-c',
      `
import os,time,signal
children=[]
limited=False
try:
    for i in range(64):
        pid=os.fork()
        if pid == 0:
            time.sleep(60)
            os._exit(0)
        children.append(pid)
except BlockingIOError:
    limited=True
finally:
    for pid in children: os.kill(pid,signal.SIGKILL)
    for pid in children: os.waitpid(pid,0)
assert limited and len(children)<32
print('bounded')
`,
    ]);
    assert.equal(result.status, 'succeeded', result.stderr);
    assert.equal(result.stdout.trim(), 'bounded');
  }));

test('invalid UTF-8 cannot expand captured output beyond its byte budget', () =>
  fixture(async ({ execute }) => {
    const result = await execute(['/usr/bin/python3', '-I', '-c', String.raw`import os;os.write(1,b'\xff'*1024)`], {
      max_output_bytes: 1024,
    });
    assert.equal(result.status, 'invalid_output');
    assert.equal(result.stdout, '');
    assert.equal(result.descendants_terminated, true);
  }));

test('memory exhaustion remains confined to the executor group', () =>
  fixture(async ({ execute }) => {
    const result = await execute(['/usr/bin/python3', '-I', '-c', 'value=bytearray(300*1024*1024);print(len(value))']);
    assert.notEqual(result.status, 'succeeded');
    assert.equal(result.descendants_terminated, true);
    assert.equal(result.limits.memory_bytes, 268_435_456);
  }));

test('resource cleanup retries a busy empty group before confirming completion', () =>
  fixture(async ({ execute }) => {
    const original = fs.rmdirSync;
    let retriedGroup;
    fs.rmdirSync = function (directory, ...args) {
      if (!retriedGroup && String(directory).startsWith('/sys/fs/cgroup/') && path.basename(directory).startsWith('hseos-executor-')) {
        assert.match(fs.readFileSync(path.join(directory, 'cgroup.events'), 'utf8'), /populated 0/);
        retriedGroup = directory;
        throw Object.assign(new Error('busy resource group'), { code: 'EBUSY' });
      }
      return original.call(fs, directory, ...args);
    };
    try {
      const result = await execute(['/usr/bin/python3', '-I', '-c', 'print("done")']);
      assert.equal(result.status, 'succeeded');
      assert.equal(result.descendants_terminated, true);
      assert.ok(retriedGroup);
      assert.equal(fs.existsSync(retriedGroup), false);
    } finally {
      fs.rmdirSync = original;
    }
  }));

test('persistent busy cleanup is uncertain and never confirms completion', () =>
  fixture(async ({ execute }) => {
    const original = fs.rmdirSync;
    let blockedGroup;
    fs.rmdirSync = function (directory, ...args) {
      if (String(directory).startsWith('/sys/fs/cgroup/') && path.basename(directory).startsWith('hseos-executor-')) {
        blockedGroup = directory;
        throw Object.assign(new Error('busy resource group'), { code: 'EBUSY' });
      }
      return original.call(fs, directory, ...args);
    };
    try {
      await assert.rejects(execute(['/usr/bin/python3', '-I', '-c', 'pass']), { code: 'ENGINEERING_TEARDOWN_UNCERTAIN' });
      assert.ok(blockedGroup);
      assert.match(fs.readFileSync(path.join(blockedGroup, 'cgroup.events'), 'utf8'), /populated 0/);
    } finally {
      fs.rmdirSync = original;
      if (blockedGroup) original(blockedGroup);
    }
  }));

test('project runtime mounts only the controller executable read-only without inheriting its environment', () =>
  fixture(async ({ execute }) => {
    const result = await execute(
      [
        '/usr/bin/node',
        '-e',
        `
      const fs = require('node:fs');
      let denied = false;
      try { fs.writeFileSync(process.execPath, 'replace'); } catch(e) { denied = e.code === 'EROFS'; }
      console.log(JSON.stringify({ version:process.version, denied, hostDirectory:fs.existsSync(${JSON.stringify(path.dirname(process.execPath))}), env:Object.keys(process.env) }));
    `,
      ],
      { host_node: true },
    );
    assert.equal(result.status, 'succeeded', result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.version, process.version);
    assert.equal(output.denied, true);
    assert.equal(output.hostDirectory, path.dirname(process.execPath) === '/usr/bin');
    assert.deepEqual(output.env, ['PATH', 'PWD']);
    assert.equal(result.runtime_source, 'controller-executable-readonly');
    await assert.rejects(execute(['/usr/bin/python3', '-V'], { host_node: true }), /runtime selection/);
  }));
