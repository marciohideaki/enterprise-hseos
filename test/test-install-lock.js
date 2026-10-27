'use strict';

// Concurrent `hseos install` in the same directory (M-8).
//
// Policy: the second install is REFUSED (exit 75, EX_TEMPFAIL) while the first
// holds `<dir>/.hseos-install.lock`. A lock left by a dead process is taken over.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawn, spawnSync } = require('node:child_process');
const yaml = require('yaml');

const CLI = path.join(__dirname, '..', 'tools', 'cli', 'hseos-cli.js');
const { Installer } = require('../tools/cli/installers/lib/core/installer');

const LOCK_NAME = '.hseos-install.lock';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hseos-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(dir) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, 'install', '--yes', '--tools', 'none', '--directory', dir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: '' },
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('close', (status) => resolve({ status, output }));
  });
}

function deadPid() {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
  return Number(result.stdout);
}

test('two simultaneous installs in the same directory: one installs, the other is refused with exit 75', async (t) => {
  const dir = scratch(t);
  const first = run(dir);
  const deadline = Date.now() + 60_000;
  while (!fs.existsSync(path.join(dir, LOCK_NAME))) {
    assert.ok(Date.now() < deadline, 'first install never took the lock');
    await new Promise((r) => setTimeout(r, 5));
  }
  const second = await run(dir);
  const firstResult = await first;

  assert.equal(second.status, 75, second.output);
  assert.match(second.output, /another hseos install is already running/i);
  assert.equal(firstResult.status, 0, firstResult.output);
  const manifest = yaml.parse(fs.readFileSync(path.join(dir, '.hseos', '_config', 'manifest.yaml'), 'utf8'));
  assert.ok(manifest.installation.version, 'manifest must be valid after the race');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'lock must be released after success');
});

test('a single install leaves no lock behind and a second sequential install works', async (t) => {
  const dir = scratch(t);
  assert.equal((await run(dir)).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
  assert.equal((await run(dir)).status, 0);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('a lock left by a dead process is taken over', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
  const result = await run(dir);
  assert.equal(result.status, 0, result.output);
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('a lock held by a live process refuses with code EHSEOS_INSTALL_LOCKED naming the pid', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  await assert.rejects(
    new Installer()._withInstallLock(dir, async () => 'never'),
    (error) => error.code === 'EHSEOS_INSTALL_LOCKED' && error.message.includes(String(process.pid)),
  );
  assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)), 'a refused install must not remove the holder lock');
});

test('the lock is released when the guarded work throws', async (t) => {
  const dir = scratch(t);
  await assert.rejects(
    new Installer()._withInstallLock(dir, async () => {
      assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)), 'lock held while working');
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'lock must be released after an error');
});

test('the lock is re-entrant within one installer (quickUpdate delegating to install)', async (t) => {
  const dir = scratch(t);
  const installer = new Installer();
  const result = await installer._withInstallLock(dir, () => installer._withInstallLock(dir, async () => 'inner'));
  assert.equal(result, 'inner');
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)));
});

test('the lock is released when the process is terminated by a signal', async (t) => {
  const dir = scratch(t);
  const script = `
    const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
    new Installer()._withInstallLock(${JSON.stringify(dir)}, () => { console.log('held'); return new Promise(() => setInterval(() => {}, 1000)); });
  `;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  assert.ok(fs.existsSync(path.join(dir, LOCK_NAME)));
  const closed = new Promise((resolve) => child.on('close', (code, signal) => resolve({ code, signal })));
  child.kill('SIGTERM');
  await closed;
  assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'SIGTERM must release the lock');
});

for (const signal of ['SIGINT', 'SIGHUP']) {
  test(`the lock is released when the process is terminated by ${signal}`, async (t) => {
    const dir = scratch(t);
    const script = `
      const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
      new Installer()._withInstallLock(${JSON.stringify(dir)}, () => { console.log('held'); return new Promise(() => setInterval(() => {}, 1000)); });
    `;
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise((resolve) => child.stdout.once('data', resolve));
    const closed = new Promise((resolve) => child.on('close', (code, sig) => resolve(sig)));
    child.kill(signal);
    assert.equal(await closed, signal, 'the signal still terminates the process after the lock is released');
    assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), `${signal} must release the lock`);
  });
}

test('a refusal tells the user how to remove a lock held by a recycled pid', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: process.pid }));
  await assert.rejects(
    new Installer()._withInstallLock(dir, async () => 'never'),
    (error) => error.code === 'EHSEOS_INSTALL_LOCKED' && error.message.includes(path.join(dir, LOCK_NAME)) && /remove/.test(error.message),
  );
});

// Several processes race to take over the same dead holder's lock. The critical section is a file created with 'wx':
// if two processes are ever inside at once, the second create fails and the child reports a violation.
test('racing takeovers of a dead holder lock never put two processes in the critical section', async (t) => {
  const worker = `
    const fs = require('node:fs');
    const path = require('node:path');
    const { Installer } = require(${JSON.stringify(path.join(__dirname, '..', 'tools', 'cli', 'installers', 'lib', 'core', 'installer'))});
    const dir = process.argv[1];
    const inside = path.join(dir, 'inside.flag');
    new Installer()._withInstallLock(dir, async () => {
      fs.writeFileSync(inside, String(process.pid), { flag: 'wx' });
      await new Promise((r) => setTimeout(r, 40));
      fs.unlinkSync(inside);
      console.log('ran');
    }).catch((e) => console.log(e.code === 'EHSEOS_INSTALL_LOCKED' ? 'refused' : 'violation:' + e.message));
  `;
  for (let round = 0; round < 12; round += 1) {
    const dir = scratch(t);
    fs.writeFileSync(path.join(dir, LOCK_NAME), JSON.stringify({ pid: deadPid(), startedAt: new Date().toISOString() }));
    const outputs = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise((resolve) => {
            const child = spawn(process.execPath, ['-e', worker, dir], { stdio: ['ignore', 'pipe', 'inherit'] });
            let out = '';
            child.stdout.on('data', (d) => (out += d));
            child.on('close', () => resolve(out.trim()));
          }),
      ),
    );
    assert.ok(!outputs.some((o) => o.startsWith('violation')), `round ${round}: ${outputs.join(' | ')}`);
    assert.ok(outputs.includes('ran'), `round ${round}: someone must have taken the lock over: ${outputs.join(' | ')}`);
    assert.ok(
      !fs.existsSync(path.join(dir, LOCK_NAME)) && !fs.existsSync(`${path.join(dir, LOCK_NAME)}.takeover`),
      `round ${round}: nothing left behind`,
    );
  }
});

test('release leaves a lock that another install took over after a manual removal', async (t) => {
  const dir = scratch(t);
  const other = JSON.stringify({ pid: process.pid + 1, startedAt: new Date().toISOString() });
  await new Installer()._withInstallLock(dir, async () => {
    fs.writeFileSync(path.join(dir, LOCK_NAME), other); // removed by hand and re-created by someone else
  });
  assert.equal(fs.readFileSync(path.join(dir, LOCK_NAME), 'utf8'), other, 'a lock that is not ours must survive our release');
});

test('a filesystem without hard links still gets a lock (link() fails with EPERM)', async (t) => {
  const dir = scratch(t);
  const fsExtra = require('fs-extra');
  const realLink = fsExtra.link;
  fsExtra.link = async () => {
    throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
  };
  try {
    const held = await new Installer()._withInstallLock(
      dir,
      async () => JSON.parse(fs.readFileSync(path.join(dir, LOCK_NAME), 'utf8')).pid,
    );
    assert.equal(held, process.pid);
    assert.ok(!fs.existsSync(path.join(dir, LOCK_NAME)), 'released after the work');
  } finally {
    fsExtra.link = realLink;
  }
});
